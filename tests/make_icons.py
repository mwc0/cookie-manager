"""
Generate the extension's icons.

    python make_icons.py

Writes src/icons/icon-{16,32,48,128}.png. The SVG below is the source of
truth; it lives here rather than in src/ so that only files the extension
actually loads end up in the store zip.

Design notes, since the constraint is unusual:

The icon has to survive being 16 pixels wide in a toolbar. That rules out
thin strokes, gradients, fine detail and anything that depends on reading
text. What is left is a silhouette and two or three colours, so this is a
plain cookie disc with chunky chips -- the chips are deliberately oversized
relative to a real cookie, because at 16px a proportionally-correct chip is
one pixel and disappears.

Warm brown rather than the UI's blue: developer-tool listings are a sea of
blue icons, and a cookie is the one shape this product can own outright.
"""

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

OUT = Path(__file__).resolve().parent.parent / "src" / "icons"
SIZES = [16, 32, 48, 128]

# 128x128 viewBox. Flat shapes only, no strokes, no gradients.
SVG = """
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <!-- Body. Slightly off-centre chips keep it from reading as a clock face. -->
  <circle cx="64" cy="64" r="58" fill="#c8813a"/>
  <circle cx="64" cy="64" r="58" fill="none"/>
  <!-- A lighter inner disc gives the edge definition without a stroke,
       which would thin out to nothing at 16px. -->
  <circle cx="64" cy="64" r="50" fill="#e0a05a"/>
  <!-- Chips: oversized on purpose so they still register at 16px. -->
  <circle cx="45" cy="44" r="11" fill="#5b3418"/>
  <circle cx="84" cy="52" r="9"  fill="#5b3418"/>
  <circle cx="54" cy="80" r="10" fill="#5b3418"/>
  <circle cx="86" cy="86" r="8"  fill="#5b3418"/>
</svg>
"""

PAGE = """<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  html,body{{margin:0;padding:0;background:transparent}}
  svg{{display:block;width:{size}px;height:{size}px}}
</style></head><body>{svg}</body></html>"""


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        for size in SIZES:
            # Render at 4x and let the screenshot scale down, so the curves
            # come out antialiased rather than stair-stepped at 16px.
            page = browser.new_page(
                viewport={"width": size, "height": size},
                device_scale_factor=1,
            )
            page.set_content(PAGE.format(size=size, svg=SVG))
            page.wait_for_timeout(120)
            page.screenshot(
                path=str(OUT / f"icon-{size}.png"),
                omit_background=True,
            )
            page.close()
            print(f"  wrote icon-{size}.png")
        browser.close()

    print(f"\n{len(SIZES)} icons in {OUT}")
    print("Check icon-16.png at actual size: that's the one that has to work.")


if __name__ == "__main__":
    sys.exit(main())
