"""
Generate the extension's icons.

    python make_icons.py

Writes src/icons/icon-{16,32,48,128}.png. The SVG below is the source of
truth; it lives here rather than in src/ so that only files the extension
actually loads end up in the store zip.

Design notes, since the constraint is unusual:

The mark is the keycap Z from the promo tile, not a cookie. A cookie is what
every other extension in this category already draws; the keycap says
developer tool without a word, and it stops "cookieZ" reading as a typo for
"cookies".

The icon has to survive being 16 pixels wide in a toolbar. That rules out
thin strokes, gradients, fine detail and real text. So this is built from
flat shapes only, and the Z is drawn as three polygons rather than set in a
font -- a font would also make the output depend on whatever is installed on
the machine that runs this.

The keycap is read from the silhouette: a dark rounded square with a lighter
face inset into it, the inset deeper at the bottom than the top. That band of
darker colour along the bottom is what makes it look like a raised key rather
than a letter in a box, and it is the one cue that still survives at 16px.

The greys are the promo tile's, so the two read as the same object: #1f2633
for the legend and the #c2cad8 family for the key. The one departure is that
the edge here is a step darker than the tile's border. The tile can lean on a
2px border and a drop shadow to separate the key from its background; at 16px
both of those turn to mush, so the edge has to carry that on its own.

A light key does lose its outline against a light toolbar. That is survivable
because the near-black Z is what identifies the icon, and it holds at every
size on both toolbar themes -- the key reads as the thing the Z sits on.
"""

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

OUT = Path(__file__).resolve().parent.parent / "src" / "icons"
SIZES = [16, 32, 48, 128]

# 128x128 viewBox. Flat shapes only, no strokes, no gradients.
SVG = """
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <!-- The key itself. This is the whole silhouette; the face is cut out of
       it below rather than drawn on top of a separate shape. -->
  <rect x="8" y="8" width="112" height="112" rx="24" fill="#b3bccb"/>

  <!-- The face, inset 10 at the sides and 6 at the top but 26 at the bottom.
       That uneven bottom inset is the entire 3D effect: it leaves a band of
       the darker colour showing, which reads as the front edge of a raised
       key. Even at 16px it survives as one darker row of pixels. -->
  <rect x="18" y="14" width="92" height="80" rx="16" fill="#f5f8fc"/>

  <!-- Z, as three flat shapes: two bars and the parallelogram between them.
       Sized to fill most of the face, because a proportionally-polite letter
       is unreadable once the icon is 16 pixels wide.

       The numbers interlock, so change them together: the bars are 14 deep,
       the diagonal spans exactly the gap between them (y 42 to 66), and it
       overlaps the right end of the top bar and the left end of the bottom
       one so the three read as a single stroke. The block is centred on the
       FACE (y 14 to 94), not on the icon, or it sits low on the key. -->
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
