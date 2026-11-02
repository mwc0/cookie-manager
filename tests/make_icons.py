"""
Makes the extension's icons.

    python make_icons.py

Writes src/icons/icon-{16,32,48,128}.png from the SVG below. The SVG is kept
here, not in src/, so it doesn't end up in the store zip. It also writes the
website's two copies, docs/images/favicon-32.png and docs/images/icon-128.png,
so they can't fall out of step with the extension's.

The icon is a keycap Z, not a cookie. Most cookie extensions use a cookie. A
keycap looks like a developer tool, and it stops "cookieZ" looking like a
typo for "cookies".

It's drawn as a real key seen from just above: four sloped walls round a top
face, with the tall wall at the front. The walls are what make it look like a
key, so they stay at every size. It has to work at 16 pixels wide in the
toolbar, on a light toolbar and on a dark one, so the small sizes leave out the
gradient and the dish in the top face. The Z is one shape, not typed in a font,
so the result doesn't depend on which fonts are installed.
"""

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "icons"
SITE_OUT = ROOT / "docs" / "images"
SIZES = [16, 32, 48, 128]

# The website's copies: which size goes where.
SITE_COPIES = {32: "favicon-32.png", 128: "icon-128.png"}

# The colours: the website's navy key, with the walls lit from above.
FACE = "#26304f"
FACE_TOP = "#36426f"
FACE_BOTTOM = "#1c2445"
WALL_TOP = "#93adf7"
WALL_LEFT = "#4560b8"
WALL_RIGHT = "#334a95"
WALL_FRONT = "#141b3d"
EDGE_LIGHT = "#7f9cf0"
LETTER = "#ffffff"

# The walls run on under the top face, or gaps would show at its rounded
# corners. Each join runs from the middle of the outer rounded corner through
# the middle of the top face's, so it meets both curves squarely. Those points
# depend on the rx values here and on the top face, so change them together.
WALLS = f"""
  <defs>
    <clipPath id="key"><rect x="4" y="4" width="120" height="120" rx="18"/></clipPath>
  </defs>
  <g clip-path="url(#key)">
    <polygon points="0,0 128,0 130.9,3.1 99.2,19.2 28.8,19.2 -2.9,3.1" fill="{WALL_TOP}"/>
    <polygon points="-2.9,3.1 28.8,19.2 28.8,73.6 -2.9,146.9" fill="{WALL_LEFT}"/>
    <polygon points="130.9,3.1 99.2,19.2 99.2,73.6 130.9,146.9" fill="{WALL_RIGHT}"/>
    <polygon points="-2.9,146.9 28.8,73.6 99.2,73.6 130.9,146.9" fill="{WALL_FRONT}"/>
  </g>"""

# The Z, as one shape, so there's no seam where its parts meet. It's centred on
# the top face (x 18 to 110, y 12 to 94), not the whole icon.
LETTER_SHAPE = (
    '<polygon fill="' + LETTER + '" points="36,29 92,29 92,41 56,66 92,66 92,78 36,78 36,66 72,41 36,41"/>'
)

# For 16 and 32 pixels: flat shapes only.
SMALL = f"""
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  {WALLS}
  <rect x="18" y="12" width="92" height="82" rx="12" fill="{FACE}"/>
  {LETTER_SHAPE}
</svg>
"""

# For 48 and 128 pixels: the same key, with a lit top face, a dish in it, and
# a thin light round its edge.
LARGE = f"""
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <defs>
    <linearGradient id="face" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="{FACE_TOP}"/>
      <stop offset="1" stop-color="{FACE_BOTTOM}"/>
    </linearGradient>
    <radialGradient id="dish">
      <stop offset="0" stop-color="#0c1124" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#0c1124" stop-opacity="0"/>
    </radialGradient>
  </defs>
  {WALLS}
  <rect x="18" y="12" width="92" height="82" rx="12" fill="url(#face)"/>
  <rect x="22" y="16" width="84" height="74" rx="9" fill="url(#dish)"/>
  <rect x="18.75" y="12.75" width="90.5" height="80.5" rx="11.25" fill="none"
        stroke="{EDGE_LIGHT}" stroke-opacity="0.55" stroke-width="1.5"/>
  {LETTER_SHAPE}
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
            page = browser.new_page(
                viewport={"width": size, "height": size},
                device_scale_factor=1,
            )
            page.set_content(PAGE.format(size=size, svg=SMALL if size <= 32 else LARGE))
            page.wait_for_timeout(120)
            path = OUT / f"icon-{size}.png"
            page.screenshot(path=str(path), omit_background=True)
            page.close()
            print(f"  wrote icon-{size}.png")

            if size in SITE_COPIES:
                (SITE_OUT / SITE_COPIES[size]).write_bytes(path.read_bytes())
                print(f"  wrote docs/images/{SITE_COPIES[size]}")
        browser.close()

    print(f"\n{len(SIZES)} icons in {OUT}")
    print("Check icon-16.png at actual size, on a light toolbar and a dark one:")
    print("that's the one that has to work.")


if __name__ == "__main__":
    sys.exit(main())
