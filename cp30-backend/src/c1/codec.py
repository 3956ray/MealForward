"""Fresh, bounded single-frame image normalization; never runs in a DB transaction."""
import io
import os
from pathlib import Path
import resource
import subprocess
import sys
import threading
import time
import warnings

MAX_UPLOAD = 5 * 1024 * 1024
MAX_PNG = 8 * 1024 * 1024
MAX_RSS_KIB = 256 * 1024
MIMES = {"image/png": "PNG", "image/jpeg": "JPEG", "image/webp": "WEBP"}
_decoder_slot = threading.BoundedSemaphore(1)


class ImageRejected(ValueError):
    """Fixed failure code; contains no upload data or local path."""


def _normalize(data, content_type):
    from PIL import Image, ImageOps
    if content_type not in MIMES or not 0 < len(data) <= MAX_UPLOAD:
        raise ImageRejected("IMAGE_REJECTED")
    Image.MAX_IMAGE_PIXELS = 16_777_216
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(io.BytesIO(data)) as image:
            if image.format != MIMES[content_type] or getattr(image, "n_frames", 1) != 1:
                raise ImageRejected("IMAGE_REJECTED")
            width, height = image.size
            if not (1 <= width <= 4096 and 1 <= height <= 4096 and width * height <= 16_777_216):
                raise ImageRejected("IMAGE_REJECTED")
            image.verify()
        with Image.open(io.BytesIO(data)) as image:
            image.load()
            oriented = ImageOps.exif_transpose(image)
            mode = "RGBA" if "A" in oriented.getbands() or "transparency" in oriented.info else "RGB"
            converted = oriented.convert(mode)
            clean = Image.new(mode, converted.size)
            clean.paste(converted)
            output = io.BytesIO()
            clean.save(output, format="PNG", compress_level=6, optimize=False)
            result = output.getvalue()
            if len(result) > MAX_PNG:
                raise ImageRejected("IMAGE_REJECTED")
            return result


def _cpu_seconds(value):
    days = 0
    if "-" in value:
        day, value = value.split("-", 1)
        days = int(day)
    parts = value.split(":")
    return days * 86400 + sum(float(part) * 60 ** index for index, part in enumerate(reversed(parts)))


def normalize_image(data, content_type):
    """Return exact metadata-free PNG, with CPU/RSS/wall monitoring of our child."""
    if not isinstance(data, bytes) or content_type not in MIMES or not 0 < len(data) <= MAX_UPLOAD:
        raise ImageRejected("IMAGE_REJECTED")
    if not _decoder_slot.acquire(blocking=False):
        raise ImageRejected("IMAGE_BUSY")
    child = None
    try:
        child = subprocess.Popen([sys.executable, "-I", str(Path(__file__).resolve()), "--decode", content_type],
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env={})
        result = []
        def transfer():
            result.append(child.communicate(data))
        transfer_thread = threading.Thread(target=transfer, daemon=True)
        transfer_thread.start()
        deadline = time.monotonic() + 5
        while child.poll() is None:
            if time.monotonic() >= deadline:
                raise ImageRejected("IMAGE_LIMIT")
            observed = subprocess.run(["/bin/ps", "-p", str(child.pid), "-o", "rss=", "-o", "time="],
                                      capture_output=True, timeout=.3, env={}, check=False)
            fields = observed.stdout.decode("ascii", "strict").strip().split()
            if not fields:
                if child.poll() is None:
                    raise ImageRejected("IMAGE_MONITOR")
                break
            if len(fields) != 2 or int(fields[0]) > MAX_RSS_KIB or _cpu_seconds(fields[1]) >= 2:
                raise ImageRejected("IMAGE_LIMIT")
            time.sleep(.015)
        transfer_thread.join(timeout=max(0, deadline - time.monotonic()))
        if time.monotonic() > deadline or transfer_thread.is_alive() or child.returncode != 0 or not result or not 0 < len(result[0][0]) <= MAX_PNG:
            raise ImageRejected("IMAGE_REJECTED")
        return result[0][0]
    except (OSError, subprocess.SubprocessError, ValueError) as exc:
        if isinstance(exc, ImageRejected):
            raise
        raise ImageRejected("IMAGE_MONITOR") from None
    finally:
        if child is not None:
            if child.poll() is None:
                child.kill()
            child.wait()
        _decoder_slot.release()


if __name__ == "__main__":
    try:
        if len(sys.argv) != 3 or sys.argv[1] != "--decode":
            raise ImageRejected("IMAGE_REJECTED")
        resource.setrlimit(resource.RLIMIT_CPU, (2, 2))
        data = sys.stdin.buffer.read(MAX_UPLOAD + 1)
        sys.stdout.buffer.write(_normalize(data, sys.argv[2]))
    except Exception:
        sys.exit(1)
