#!/usr/bin/env python3
"""Unpack a "saved page" bundle (.html) into the standalone pages it hides.

Some exported/saved HTML files are not a page: they are a *wrapper* whose whole
design lives inside `<iframe src="about:blank#<uuid>">` frames that a small
runtime mounts from gzip+base64 payloads at DOMContentLoaded:

    <script type="__bundler/manifest">   { uuid: { mime, compressed, data } }
    <script type="__bundler/page_order"> [ uuid, uuid, ... ]
    <script type="__bundler/template">   "<html>...<iframe src=about:blank#uuid>..."

Such a file cannot be captured by a page-capture extension: the visible design
is one nesting level down, inside frames the top document cannot read (and that
the extension never injects into). This script writes each embedded page out as
a normal .html file, which can then be opened — or served — and captured.

Usage:
    python3 scripts/unpack-saved-page.py "AI Medicine Reminder.html" out/

Writes one file per embedded page, named `<order>-<title-slug>.html`, and
recurses when an embedded page is itself a bundle. Python 3.8+, stdlib only.
"""
from __future__ import annotations

import base64
import gzip
import json
import re
import sys
import unicodedata
from pathlib import Path

# Each of these appears at most once per bundle wrapper.
MANIFEST = re.compile(r'<script type="__bundler/manifest">\s*(\{.*?\})\s*</script>', re.S)
PAGE_ORDER = re.compile(r'<script type="__bundler/page_order">\s*(\[.*?\])\s*</script>', re.S)
TEMPLATE = re.compile(r'<script type="__bundler/template">\s*(".*?")\s*</script>', re.S)
IFRAME = re.compile(r"<iframe\b[^>]*>", re.I)
ATTR = re.compile(r'([\w:-]+)\s*=\s*"([^"]*)"')
FRAME_SRC = re.compile(r"about:blank#([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})")
TITLE = re.compile(r"<title[^>]*>(.*?)</title>", re.S | re.I)


def is_bundle(text: str) -> bool:
    return bool(MANIFEST.search(text) and TEMPLATE.search(text))


def frame_titles(template: str) -> dict[str, str]:
    """uuid -> the iframe's title attribute, used for readable file names."""
    names: dict[str, str] = {}
    for tag in IFRAME.findall(template):
        attrs = {name.lower(): value for name, value in ATTR.findall(tag)}
        found = FRAME_SRC.search(attrs.get("src", ""))
        if found and attrs.get("title"):
            names[found.group(1)] = attrs["title"]
    return names


def payloads(text: str) -> list[tuple[str, str, bytes]]:
    """[(uuid, mime, bytes)] in page order, decoded from the manifest."""
    manifest = json.loads(MANIFEST.search(text).group(1))
    order_match = PAGE_ORDER.search(text)
    order = json.loads(order_match.group(1)) if order_match else list(manifest)
    ordered = [uuid for uuid in order if uuid in manifest]
    ordered += [uuid for uuid in manifest if uuid not in ordered]
    decoded = []
    for uuid in ordered:
        entry = manifest[uuid]
        data = base64.b64decode(entry.get("data", ""))
        if entry.get("compressed"):
            data = gzip.decompress(data)
        decoded.append((uuid, entry.get("mime", ""), data))
    return decoded


def slug(value: str) -> str:
    value = re.sub(r"^\s*\d+\s*[·.:–-]\s*", "", value)  # "01 · Today" -> "Today"
    value = unicodedata.normalize("NFKD", value)
    value = re.sub(r"[^\w\s-]", "", value, flags=re.UNICODE).strip().lower()
    return re.sub(r"[\s_]+", "-", value) or "page"


def unpack_file(source: Path, out_dir: Path, prefix: str = "") -> list[Path]:
    text = source.read_text(encoding="utf-8", errors="replace")
    if not is_bundle(text):
        print(f"  skip  {source.name}: not a __bundler page")
        return []

    names = {}
    template = TEMPLATE.search(text)
    if template:
        try:
            names = frame_titles(json.loads(template.group(1)))
        except json.JSONDecodeError:
            names = {}

    written: list[Path] = []
    html_pages = [(uuid, data) for uuid, mime, data in payloads(text) if "html" in mime]
    for index, (uuid, data) in enumerate(html_pages, start=1):
        page = data.decode("utf-8", errors="replace")
        title_match = TITLE.search(page)
        label = names.get(uuid) or (title_match.group(1).strip() if title_match else uuid)
        name = f"{prefix}{index:02d}-{slug(label)}.html"
        target = out_dir / name
        target.write_text(page, encoding="utf-8")
        written.append(target)
        print(f"  write {target} ({len(data):,} bytes)")

        if is_bundle(page):
            order = PAGE_ORDER.search(page)
            if order and json.loads(order.group(1)):
                nested = out_dir / f"{target.stem}-parts"
                nested.mkdir(parents=True, exist_ok=True)
                written += unpack_file(target, nested)
    return written


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__.strip().splitlines()[0])
        print(f"usage: {Path(argv[0]).name} <bundle.html | directory> [out_dir]")
        return 2
    source = Path(argv[1])
    out_dir = Path(argv[2]) if len(argv) > 2 else Path("unpacked") / slug(source.stem)
    out_dir.mkdir(parents=True, exist_ok=True)

    sources = sorted(source.glob("*.html")) if source.is_dir() else [source]
    total = []
    for item in sources:
        print(f"\n{item}")
        prefix = f"{slug(item.stem)}--" if len(sources) > 1 else ""
        total += unpack_file(item, out_dir, prefix)
    print(f"\n{len(total)} page(s) written to {out_dir}")
    return 0 if total else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
