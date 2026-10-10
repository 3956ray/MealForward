"""Normalize frozen design targets and browser captures into paired QA inputs.

Run with the bundled Python (Pillow) and the explicit CP29 design directory.
Only comparison images are resized/cropped; shipped product assets are untouched.
"""
import argparse
from pathlib import Path
from PIL import Image, ImageDraw

parser = argparse.ArgumentParser()
parser.add_argument("design_root", type=Path)
parser.add_argument("--round", default="final")
args = parser.parse_args()
evidence = Path("evidence")
targets = [
    ("supporter", "cp29-ui02/SUPPORTER-DESKTOP-B2.png", "supporter-1440.png", (1440, 1024)),
    ("owner-desktop", "cp29-ui01/OPTION-B2-WARM-COUNTER.png", "owner-1440.png", (1440, 1024)),
    ("recipient-mobile", "cp29-ui02/RECIPIENT-MOBILE-B2.png", "recipient-390.png", (390, 844)),
    ("owner-mobile", "cp29-ui02/OWNER-MOBILE-B2.png", "owner-390.png", (390, 844)),
]
def paired(name, source, rendered):
    gap, top = 24, 36
    result = Image.new("RGB", (source.width + rendered.width + gap, max(source.height, rendered.height) + top), "#ece7de")
    draw = ImageDraw.Draw(result)
    draw.text((8, 10), "FROZEN SOURCE", fill="black")
    draw.text((source.width + gap + 8, 10), "BROWSER IMPLEMENTATION", fill="black")
    result.paste(source, (0, top))
    result.paste(rendered, (source.width + gap, top))
    result.save(evidence / f"compare-{name}-{args.round}.png")
for name, reference, screenshot, size in targets:
    source = Image.open(args.design_root / reference).convert("RGB").resize(size, Image.Resampling.LANCZOS)
    rendered = Image.open(evidence / screenshot).convert("RGB").crop((0, 0, *size))
    paired(name, source, rendered)
    if size[0] > 1000:
        crop = (240, 290, 960, 850) if name == "owner-desktop" else (80, 280, 860, 760)
        paired(f"{name}-focus", source.crop(crop), rendered.crop(crop))
