"""
Makes the extension's icons.

    python make_icons.py

Writes src/icons/icon-{16,32,48,128}.png from the SVG below. The SVG is kept
here, not in src/, so it doesn't end up in the store zip.

The icon is the keycap Z from the promo tile, not a cookie. Most cookie
extensions use a cookie. A keycap looks like a developer tool, and it stops
"cookieZ" looking like a typo for "cookies".

It has to work at 16 pixels wide in the toolbar, so there are no thin lines,
gradients or text, just flat shapes. The Z is drawn as shapes too, not typed
in a font, so the result doesn't depend on which fonts are installed.

What makes it look like a key is the darker band along the bottom, where the
light face sits further in from the edge. That still shows at 16px.

The colours are the promo tile's. The edge is a bit darker here than on the
tile, because the tile's border and shadow don't show up at 16px.
"""

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

OUT = Path(__file__).resolve().parent.parent / "src" / "icons"
SIZES = [16, 32, 48, 128]

SVG = """
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <!-- The whole key. The lighter face is drawn on top of it. -->
  <rect x="8" y="8" width="112" height="112" rx="24" fill="#b3bccb"/>

  <!-- The face. It's 26 in from the bottom but only 6 from the top, which
       leaves a darker band showing along the bottom. That band is what makes
       it look like a raised key, and at 16px it's still one row of pixels. -->
  <rect x="18" y="14" width="92" height="80" rx="16" fill="#f5f8fc"/>

  <!-- The Z: two bars and a slanted piece between them. It fills most of the
       face, so it can still be read at 16px.

       The numbers depend on each other, so change them together. The bars
       are 14 high, and the slanted piece fills the gap between them (y 42 to
       66). The Z is centred on the face (y 14 to 94), not the whole icon, or
       it looks too low. -->
  <g fill="#1f2633">
    <rect x="38" y="28" width="52" height="14"/>
    <polygon points="90,42 70,42 38,66 58,66"/>
    <rect x="38" y="66" width="52" height="14"/>
  </g>
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
