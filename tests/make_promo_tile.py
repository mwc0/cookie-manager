"""
Generate the Chrome Web Store small promo tile.

    python make_promo_tile.py

Writes store/promo-tile-440x280.png. The store requires that size exactly,
so the page is rendered at 440x280 at 1x rather than captured large and
scaled -- a resized tile has soft text, and text is nearly all this is.

Design notes:

The layout follows the sketch: wordmark, a rule under it, then the three
verbs, centred, with nothing else on the tile. That is the right instinct
for this slot. The tile appears in search results at well under half this
size with the extension's name and icon already printed beside it, so
anything more than a mark and a promise turns to grey mush. Three words
that say what it does beats a sentence.

The Z is drawn as a keyboard keycap. It does the job the sketch's oversized
Z was doing -- stopping the name reading as a typo for "cookies" -- and it
says developer tool without a word of explanation. Because it is a raised
object rather than a coloured letter, it also survives being shrunk, where
a colour difference alone would flatten out.

With no logo the text carries the tile alone, so it is set as large as it
can go: the wordmark is sized to the widest line it can be without coming
within the 28px margin the store's cropping wants left clear.

System fonts only, matching the rest of this project: nothing here loads
from a CDN, build scripts included.
"""

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

OUT = Path(__file__).resolve().parent.parent / "store" / "promo-tile-440x280.png"

WIDTH = 440
HEIGHT = 280

PAGE = """<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  html, body {{
    margin: 0; padding: 0;
    width: {w}px; height: {h}px; overflow: hidden;
  }}
  body {{
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    background: linear-gradient(160deg, #f4f6fb 0%, #e8ecf5 100%);
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #1f2633;
    /* The store crops a few pixels off some tiles. Nothing important
       within 28px of an edge. */
    padding: 28px; box-sizing: border-box;
  }}
  /* A row rather than one line of text, so the keycap can be centred
     against the x-height instead of sitting on the baseline, where a
     square would look like it had fallen off the word. */
  .wordmark {{
    display: flex; align-items: center; gap: 6px;
    font-size: 84px; font-weight: 600; letter-spacing: -0.02em;
    line-height: 1;
  }}
  .key {{
    /* A key, not a letter in a box: the face is lighter at the top, and
       the bottom edge is a solid block rather than a blur, which is what
       makes a keycap read as raised at small sizes. */
    width: 78px; height: 78px; box-sizing: border-box;
    border-radius: 16px;
    background: linear-gradient(180deg, #ffffff 0%, #eaeef5 100%);
    border: 2px solid #c2cad8;
    box-shadow: 0 5px 0 #c2cad8, 0 8px 12px rgba(20, 30, 60, 0.16);
    font-size: 54px; font-weight: 600; letter-spacing: 0;
    display: flex; align-items: center; justify-content: center;
    /* Dropped to centre the key on the x-height of "cookie" rather than on
       the line box. Flex centring puts it 13px too high, because the line
       box includes the ascender of the k and the descender space under the
       baseline, neither of which is where the eye finds the middle of a word
       made almost entirely of round lowercase letters. Positioned rather
       than margined so it does not push the rule down with it. */
    position: relative; top: 13px;
  }}
  .rule {{
    width: 320px; height: 2px; background: #c9d0de;
    /* Clears the dropped key and its bottom edge. */
    margin: 34px 0 18px;
  }}
  .verbs {{
    font-size: 26px; font-weight: 500; color: #4a5568;
    letter-spacing: 0.02em;
  }}
  /* The separators are lighter than the words so the three verbs read as
     three things rather than one string. */
  .dot {{ color: #a9b2c4; padding: 0 9px; }}
</style></head>
<body>
  <div class="wordmark">cookie<span class="key">Z</span></div>
  <div class="rule"></div>
  <div class="verbs">delete<span class="dot">&bull;</span>edit<span
    class="dot">&bull;</span>create</div>
</body></html>"""


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(
            viewport={"width": WIDTH, "height": HEIGHT},
            device_scale_factor=1,
        )
        page.set_content(PAGE.format(w=WIDTH, h=HEIGHT))
        page.wait_for_timeout(200)
        page.screenshot(path=str(OUT))
        page.close()
        browser.close()

    print(f"wrote {OUT.name}")
    print("Look at it shrunk to about 180px wide before accepting it: that is")
    print("roughly how it appears in a search result.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
