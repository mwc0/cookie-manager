"""
Makes the extension's icons.

    python make_icons.py

Writes src/icons/icon-{16,32,48,128}.png from the SVG below. The SVG is kept
here, not in src/, so it doesn't end up in the store zip. It also writes the
website's two copies, docs/images/favicon-32.png and docs/images/icon-128.png,
so they can't fall out of step with the extension's.

The icon is the keycap Z from the website's logo, not a cookie. Most cookie
extensions use a cookie. A keycap looks like a developer tool, and it stops
"cookieZ" looking like a typo for "cookies".

It's the dark key from the website: a navy key with a pale Z. It has to
work at 16 pixels wide in the toolbar, on a light toolbar and on a dark one,
so the small sizes are flat shapes with no thin lines, gradients or text.
The Z is drawn as shapes too, not typed in a font, so the result doesn't
depend on which fonts are installed.

What makes it look like a key is the band along the bottom, where the face
sits further in from the edge. That still shows at 16px. The band is lighter
than the face, so the key's outline can still be seen on a dark toolbar.

The two big sizes (48 and 128) also get what the website's key has: a face
that's lighter at the top, and a soft glow underneath.
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

# The colours. They're the website's dark-theme key (docs/style.css), with
# the edge a little lighter, because the website's 1px border doesn't show
# at 16px.
EDGE = "#5b6796"
FACE = "#232a45"
FACE_TOP = "#343e63"
FACE_BOTTOM = "#1b2136"
LETTER = "#eef1fb"
GLOW = "#8aa8ff"

# The Z: two bars and a slanted piece between them. It fills most of the
# face, so it can still be read at 16px.
#
# The numbers depend on each other, so change them together. The bars are 14
# high, and the slanted piece fills the gap between them (y 42 to 66). The Z
# is centred on the face (y 14 to 94), not the whole icon, or it looks too
# low.
LETTER_SHAPES = f"""
  <g fill="{LETTER}">
    <rect x="38" y="28" width="52" height="14"/>
    <polygon points="90,42 70,42 38,66 58,66"/>
    <rect x="38" y="66" width="52" height="14"/>
  </g>"""

# For 16 and 32 pixels: flat shapes only.
#
# The face is 26 in from the bottom but only 6 from the top, which leaves a
# band showing along the bottom. That band is what makes it look like a
# raised key, and at 16px it's still one row of pixels.
SMALL = f"""
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <rect x="8" y="8" width="112" height="112" rx="24" fill="{EDGE}"/>
  <rect x="18" y="14" width="92" height="80" rx="16" fill="{FACE}"/>
  {LETTER_SHAPES}
</svg>
"""

# For 48 and 128 pixels: the same key, with the lit face and the glow.
LARGE = f"""
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <defs>
    <linearGradient id="face" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="{FACE_TOP}"/>
      <stop offset="1" stop-color="{FACE_BOTTOM}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="{GLOW}" stop-opacity="0.55"/>
      <stop offset="1" stop-color="{GLOW}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <!-- The glow, behind the key and showing below it. -->
  <ellipse cx="64" cy="108" rx="62" ry="20" fill="url(#glow)"/>
  <rect x="8" y="8" width="112" height="112" rx="24" fill="{EDGE}"/>
  <rect x="18" y="14" width="92" height="80" rx="16" fill="url(#face)"/>
  {LETTER_SHAPES}
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
