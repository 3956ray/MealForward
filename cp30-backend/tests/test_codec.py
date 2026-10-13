"""Synthetic-only codec and strict parser checks; HTTPS browser proof is separate."""
import io
import json
import os
from pathlib import Path
import random
import socket
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch

from PIL import Image, PngImagePlugin
from c1 import codec
from c1.http import InputRejected, _Handler, decode_json


class CodecTests(unittest.TestCase):
    def image(self, format="PNG", **options):
        stream = io.BytesIO()
        image = Image.new("RGB", (12, 8), (30, 90, 150))
        image.save(stream, format=format, **options)
        return stream.getvalue()

    def test_three_real_formats_and_corrupt(self):
        for format, mime in (("PNG", "image/png"), ("JPEG", "image/jpeg"), ("WEBP", "image/webp")):
            with self.subTest(format=format):
                result = codec.normalize_image(self.image(format), mime)
                with Image.open(io.BytesIO(result)) as clean:
                    self.assertEqual(clean.format, "PNG")
                    self.assertEqual(clean.size, (12, 8))
                    self.assertEqual(clean.info, {})
                with self.assertRaises(codec.ImageRejected):
                    codec.normalize_image(self.image(format)[:20], mime)

    def test_format_animation_limits_and_metadata(self):
        with self.assertRaises(codec.ImageRejected):
            codec.normalize_image(self.image(), "image/jpeg")
        metadata = PngImagePlugin.PngInfo()
        metadata.add_text("comment", "synthetic metadata")
        result = codec.normalize_image(self.image(pnginfo=metadata), "image/png")
        self.assertNotIn(b"synthetic metadata", result)
        self.assertEqual(result, codec.normalize_image(self.image(pnginfo=metadata), "image/png"))
        exif = Image.Exif()
        exif[274] = 6
        result = codec.normalize_image(self.image("JPEG", exif=exif), "image/jpeg")
        with Image.open(io.BytesIO(result)) as image:
            self.assertEqual(image.size, (8, 12))
            self.assertEqual(dict(image.getexif()), {})
        stream = io.BytesIO()
        Image.new("RGB", (3, 3), "red").save(stream, format="PNG", save_all=True, append_images=[Image.new("RGB", (3, 3), "blue")])
        with self.assertRaises(codec.ImageRejected):
            codec.normalize_image(stream.getvalue(), "image/png")
        for data in (b"", b"x" * (codec.MAX_UPLOAD + 1), b"<svg></svg>"):
            with self.assertRaises(codec.ImageRejected):
                codec.normalize_image(data, "image/png")
        stream = io.BytesIO()
        Image.new("RGB", (4097, 1)).save(stream, format="PNG")
        with self.assertRaises(codec.ImageRejected):
            codec.normalize_image(stream.getvalue(), "image/png")

    def test_worker_output_bound(self):
        with patch.object(codec, "MAX_PNG", 1):
            with self.assertRaises(codec.ImageRejected):
                codec._normalize(self.image(), "image/png")

    def test_monitor_rejects_observed_rss_and_cpu(self):
        for stdout in (b"262145 0:00.01\n", b"100 0:02.00\n", b"unparseable\n"):
            with self.subTest(kind=stdout.split()[0]):
                with patch.object(codec.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, stdout=stdout)):
                    with self.assertRaises(codec.ImageRejected):
                        codec.normalize_image(self.image(), "image/png")

    def test_wall_deadline_and_single_decoder(self):
        with patch.object(codec.time, "monotonic", side_effect=[0, 6]):
            with self.assertRaises(codec.ImageRejected):
                codec.normalize_image(self.image(), "image/png")
        codec._decoder_slot.acquire()
        try:
            with self.assertRaises(codec.ImageRejected):
                codec.normalize_image(self.image(), "image/png")
        finally:
            codec._decoder_slot.release()


class JsonTests(unittest.TestCase):
    def test_strict_json(self):
        self.assertEqual(decode_json(b'{"a":1}'), {"a": 1})
        for body in (b'{"a":1,"a":2}', b'{"a":{"x":1,"x":2}}', b'{"a":NaN}', b'{"a":Infinity}', b'{"a":1e1000}', b'{"a":"\\ud800"}', b'[]', b'\xff', b'{} trailing', b'x' * 65537):
            with self.subTest(size=len(body)):
                with self.assertRaises(InputRejected):
                    decode_json(body)


class TransportParserTests(unittest.TestCase):
    def request(self, method="POST", path="/v1/auth/pre-session", headers=None, body=b"{}"):
        values = [("Host", "127.0.0.1:12345"), ("Origin", "https://127.0.0.1:12345"), ("Content-Type", "application/json"), ("Content-Length", str(len(body)))]
        if headers is not None:
            values = headers
        request = f"{method} {path} HTTP/1.1\r\n".encode() + b"".join(f"{k}: {v}\r\n".encode() for k,v in values) + b"\r\n" + body
        left, right = socket.socketpair()
        called = []
        class App:
            def handle(self, *args):
                called.append(args)
                return 200, {"ok": True}, {}
        class Server:
            application = App()
            host = "127.0.0.1:12345"
            origin = "https://127.0.0.1:12345"
        def handle():
            try:
                _Handler(right, ("127.0.0.1", 1), Server())
            finally:
                right.close()
        thread = threading.Thread(target=handle)
        thread.start()
        left.sendall(request)
        left.shutdown(socket.SHUT_WR)
        response = b""
        while True:
            part = left.recv(65536)
            if not part:
                break
            response += part
        left.close()
        thread.join(10)
        self.assertFalse(thread.is_alive())
        status = int(response.split(b" ", 2)[1])
        return status, called

    def test_valid_and_negative_framing(self):
        self.assertEqual(self.request()[0], 200)
        base = [("Host", "127.0.0.1:12345"), ("Origin", "https://127.0.0.1:12345"), ("Content-Type", "application/json")]
        variants = [base + [("Content-Length", "2"), ("Content-Length", "2")], base + [("Content-Length", "2"), ("Transfer-Encoding", "chunked")], base + [("Content-Length", "-1")], base + [("Content-Length", "02")], base + [("Content-Length", "1")], base + [("Content-Length", "3")], base + [("Content-Length", "65537")], base + [("Content-Length", "2"), ("X-Forwarded-Host", "elsewhere")], base + [("Content-Length", "2"), ("Forwarded", "for=127.0.0.1")], base + [("Content-Length", "2"), ("Expect", "100-continue")]]
        for headers in variants:
            with self.subTest(headers=[k for k,_ in headers]):
                status, called = self.request(headers=headers)
                self.assertIn(status, (413, 422))
                self.assertEqual(called, [])
        for headers in ([item for item in base if item[0] != "Origin"] + [("Content-Length", "2")], [("Host", "localhost:12345"), *base[1:], ("Content-Length", "2")]):
            self.assertEqual(self.request(headers=headers)[0], 403)
        self.assertEqual(self.request(method="PATCH")[0], 405)
        self.assertEqual(self.request(path="//evil.test/x")[0], 422)
        self.assertEqual(self.request(body=b'{"x":1,"x":2}')[0], 422)


class HashTests(unittest.TestCase):
    NODE = "/Users/mili/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
    HELPER = str(Path(__file__).resolve().parents[1] / "tools/hash-helper.mjs")
    OWNED_RUN = None  # The harness assigns its newly created run explicitly.

    def hash(self, request, descriptor=None):
        payload = request if isinstance(request, bytes) else json.dumps(request).encode()
        command = [self.NODE, self.HELPER]
        if descriptor is not None:
            command.append(str(descriptor))
        result = subprocess.run(command, input=payload, capture_output=True, timeout=2, env={},
                                pass_fds=() if descriptor is None else (descriptor,))
        self.assertEqual(result.stderr, b"")
        return result.returncode, json.loads(result.stdout)

    def test_exact_keccak_and_body(self):
        code, result = self.hash({"op": "keccak", "hex": "0x"})
        self.assertEqual(code, 0)
        self.assertEqual(result["digest"], "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470")
        code, result = self.hash({"op": "body", "name": "合成午餐", "description": "synthetic\nexact LF"})
        self.assertEqual(code, 0)
        self.assertEqual(result["bodyDigest"], "0xde19804a67ac6aee8fec9f50913754262fe858da4cdc831c17cc1e2b06c1ddff")
        for request in (b'{"op":"keccak","hex":"0x","hex":"0x01"}', {"op":"body","name":"x","description":"a\r\nb"}, {"op":"image","length":8388609}, {"op":"image","length":1,"path":"/tmp/image"}, {"op":"image","length":1,"fd":3}, b" "*65537):
            self.assertEqual(self.hash(request)[0], 1)

    def test_s0b_terms_voucher_and_operation_vectors(self):
        # Public synthetic constants from the bound immutable S0b vector.
        escrow = "0x0000000000000000000000000000000000003000"
        meal = "0xf6ae23d9c645946a75b7b62ffca8fcda402a88da357fe6622a3d2ca134526491"
        terms = "0x054753af4fbf6d3b7200cfb427a94b9e0380de7211401091f5e4c76edcab9eac"
        request = {"op":"terms","escrow":escrow,"storeId":"0x"+format(44,"064x"),"asset":"0x0000000000000000000000000000000000004000","mealId":meal,"version":"1","unitPrice":"3","bodyDigest":"0xde19804a67ac6aee8fec9f50913754262fe858da4cdc831c17cc1e2b06c1ddff","imageDigest":"0xda21a391bb3b3167b89dbadce797f5b6137d48008a3de8705e597ff97cd52a48","windowCount":2,"startMinute0":540,"endMinute0":600,"startMinute1":780,"endMinute1":1440}
        code,result=self.hash(request)
        self.assertEqual(code,0)
        self.assertEqual(result["termsHash"],terms)
        code,result=self.hash({"op":"voucher","escrow":escrow,"unitSeq":0,"generation":"1"})
        self.assertEqual(code,0)
        self.assertEqual(result["voucherId"],"0x9cf2e929c263024c1a13b206d84bcea56c9c6b0164fd3232cda2e3e0f77bf40c")
        code,result=self.hash({"op":"operation","escrow":escrow,"caller":"0x0000000000000000000000000000000000000402","opId":"0x"+format(7,"064x"),"kind":5,"parameters":[meal,0,"1",terms,"1800000600"]})
        self.assertEqual(code,0)
        self.assertEqual(result["parametersHash"],"0x1da6048ee7bb231da54a95e1d6dd6f67a09c6b8e950d31e4084cddd229202319")
        self.assertEqual(result["payloadHash"],"0x0b64f7b8072e519a8d3133db08eb48683cde088e60e33504b1653276f6db3400")
        for value in ("01","+1","1.5","1e2",str(2**256)):
            self.assertEqual(self.hash({**request,"unitPrice":value})[0],1)
        self.assertEqual(self.hash({**request,"unitPrice":str(2**256-1)})[0],0)

    def test_owned_readonly_large_final_png_descriptor(self):
        if self.OWNED_RUN is None:
            self.skipTest("Fresh owned run must be explicitly assigned by harness")
        run = Path(self.OWNED_RUN)
        info = run.stat()
        self.assertEqual(info.st_uid, os.getuid())
        self.assertEqual(info.st_mode & 0o777, 0o700)
        with tempfile.TemporaryDirectory(prefix="hash-check-", dir=run) as owned:
            target = Path(owned) / "normalized.png"
            data = random.Random(0xc13001).randbytes(1536*1536*3)
            image = Image.frombytes("RGB", (1536,1536), data)
            stream = io.BytesIO()
            image.save(stream, format="PNG", compress_level=6, optimize=False)
            png = stream.getvalue()
            self.assertGreater(len(png), 65536)
            self.assertLessEqual(len(png), codec.MAX_PNG)
            target.write_bytes(png)
            target.chmod(0o400)
            descriptor = os.open(target, os.O_RDONLY | os.O_NOFOLLOW)
            try:
                code, result = self.hash({"op":"image","length":len(png)}, descriptor)
                self.assertEqual(code, 0)
                self.assertEqual(result["imageDigest"], "0x53c4941de935d4bba76381db9da8a6451e2e5255dd99cb897ee121e3bf4dd769")
                os.lseek(descriptor, 0, os.SEEK_SET)
                self.assertEqual(self.hash({"op":"image","length":len(png)-1}, descriptor)[0], 1)
                os.link(target, Path(owned) / "second-link.png")
                self.assertEqual(self.hash({"op":"image","length":len(png)}, descriptor)[0], 1)
                (Path(owned) / "second-link.png").unlink()
            finally:
                os.close(descriptor)
            target.chmod(0o644)
            descriptor = os.open(target, os.O_RDONLY | os.O_NOFOLLOW)
            try:
                self.assertEqual(self.hash({"op":"image","length":len(png)}, descriptor)[0], 1)
            finally:
                os.close(descriptor)
            link = Path(owned) / "link.png"
            link.symlink_to(target)
            with self.assertRaises(OSError):
                os.open(link, os.O_RDONLY | os.O_NOFOLLOW)


if __name__ == "__main__":
    unittest.main()
