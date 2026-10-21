#!/usr/bin/env python3
"""Rasterise the preview SVG written by scripts/wireframe-preview.js.

Development aid only: draws rectangles and text boxes into a PPM, which
ImageMagick converts to PNG. Text is drawn as its measured box (with a darker
baseline bar) because this is a check of geometry and tones, not typography.
"""
import re
import sys

def parse_colour(value, default=(255, 255, 255)):
    if not value or value in ("none", "transparent"):
        return None if value == "none" else default
    value = value.strip()
    if value.startswith("#"):
        hexv = value[1:]
        if len(hexv) in (3, 4):
            hexv = "".join(c * 2 for c in hexv[:3])
        if len(hexv) >= 6:
            return (int(hexv[0:2], 16), int(hexv[2:4], 16), int(hexv[4:6], 16))
    match = re.match(r"rgba?\(([^)]+)\)", value)
    if match:
        parts = [float(p) for p in re.split(r"[,\s/]+", match.group(1).strip()) if p]
        return (int(parts[0]), int(parts[1]), int(parts[2]))
    return default

def main(src_path, out_path, scale=1.0):
    svg = open(src_path, encoding="utf8").read()
    W = int(int(re.search(r'width="(\d+)"', svg).group(1)) * scale)
    H = int(int(re.search(r'height="(\d+)"', svg).group(1)) * scale)
    buffer = bytearray(b"\xff" * (W * H * 3))

    def fill_rect(x, y, w, h, colour):
        if not colour or w <= 0 or h <= 0:
            return
        x0, y0 = max(0, int(x * scale)), max(0, int(y * scale))
        x1, y1 = min(W, int((x + w) * scale)), min(H, int((y + h) * scale))
        row = bytes(colour) * max(0, x1 - x0)
        for yy in range(y0, y1):
            start = (yy * W + x0) * 3
            buffer[start:start + len(row)] = row

    for match in re.finditer(r"<rect\b([^>]*)/>", svg):
        attrs = dict(re.findall(r'([a-z-]+)="([^"]*)"', match.group(1)))
        x, y = float(attrs.get("x", 0)), float(attrs.get("y", 0))
        w, h = float(attrs.get("width", 0)), float(attrs.get("height", 0))
        fill = parse_colour(attrs.get("fill"), None)
        stroke = attrs.get("stroke", "none")
        fill_rect(x, y, w, h, fill)
        if stroke and stroke != "none":
            colour = parse_colour(stroke, (200, 200, 200))
            width = max(1.0, float(attrs.get("stroke-width", 1)))
            fill_rect(x, y, w, width, colour)
            fill_rect(x, y + h - width, w, width, colour)
            fill_rect(x, y, width, h, colour)
            fill_rect(x + w - width, y, width, h, colour)

    for match in re.finditer(r"<text\b([^>]*)>(.*?)</text>", svg, re.S):
        attrs = dict(re.findall(r'([a-z-]+)="([^"]*)"', match.group(1)))
        body = match.group(2)
        if "monospace" in attrs.get("font-family", ""):
            continue
        x, y = float(attrs.get("x", 0)), float(attrs.get("y", 0))
        size = float(attrs.get("font-size", 14))
        colour = parse_colour(attrs.get("fill"), (60, 60, 60))
        weight = attrs.get("font-weight", "400")
        text = re.sub(r"&[a-z]+;", " ", body)
        width = min(1600, max(4, len(text) * size * 0.52))
        height = max(1.5, size * (0.16 if weight in ("500", "600", "700") else 0.12))
        # A single bar per line stands in for the text run: enough to check tone,
        # weight and position without shipping a font.
        fill_rect(x, y - size * 0.72, width * 0.94, height * 1.6, colour)

    with open(out_path, "wb") as handle:
        handle.write(b"P6\n%d %d\n255\n" % (W, H))
        handle.write(bytes(buffer))
    print(out_path, W, H)

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], float(sys.argv[3]) if len(sys.argv) > 3 else 1.0)
