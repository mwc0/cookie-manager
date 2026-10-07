"""
Makes the Chrome Web Store small promo tile.

    python make_promo_tile.py

Writes store/promo-tile-440x280.png. The store needs exactly that size, so
the page is drawn at 440x280 instead of being made bigger and shrunk, which
would blur the text.

The tile is just the name, a line, and three words. In search results it's
shown at less than half size, next to the name and icon, so anything more
detailed can't be read.

It's the website's look: a dark page lit from above, with the Z as a dark
keycap that gives off light. The keycap stops the name looking like a typo
for "cookies". Because it's a raised shape and not just a different colour,
it still stands out when the tile is small.

The text is as big as it can be while staying 28px from the edges.

The typeface is the one bundled with the extension (src/popup/fonts). It's
read from that file and put inside the page, so nothing is fetched.
"""

import base64
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "store" / "promo-tile-440x280.png"
FONT = ROOT / "src" / "popup" / "fonts" / "hanken-grotesk.woff2"

WIDTH = 440
HEIGHT = 280

PAGE = """<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  @font-face {{
    font-family: "Hanken Grotesk";
    src: url("data:font/woff2;base64,{font}") format("woff2");
    font-weight: 100 900;
  }}
  html, body {{
    margin: 0; padding: 0;
    width: {w}px; height: {h}px; overflow: hidden;
  }}
  body {{
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    /* The dark page, with the beam falling from the top centre. */
    background:
      radial-gradient(ellipse 260px 150px at 50% 0, rgba(138, 168, 255, 0.34), transparent 72%),
      conic-gradient(from 180deg at 50% -30px,
        rgba(138, 168, 255, 0.26) 0deg, transparent 34deg,
        transparent 326deg, rgba(138, 168, 255, 0.26) 360deg),
      #05070f;
    font-family: "Hanken Grotesk", sans-serif;
    color: #eef1fb;
    /* The store can crop a few pixels off the edges, so keep 28px clear. */
    padding: 28px; box-sizing: border-box;
  }}
  /* A flex row, so the keycap can be centred on the letters instead of
     sitting on the baseline. */
  .wordmark {{
    display: flex; align-items: center; gap: 7px;
    font-size: 84px; font-weight: 600; letter-spacing: -0.02em;
    line-height: 1;
  }}
  .key {{
    /* Lighter at the top, with a solid edge at the bottom. That's what makes
       it look like a raised key when small. The wide soft shadow is the
       light it gives off. */
    width: 78px; height: 78px; box-sizing: border-box;
    border-radius: 16px;
    background: linear-gradient(180deg, #343e63 0%, #1b2136 100%);
    border: 2px solid #5b6796;
    box-shadow: 0 5px 0 #5b6796, 0 16px 44px 6px rgba(138, 168, 255, 0.5);
    font-size: 54px; font-weight: 600; letter-spacing: 0;
    display: flex; align-items: center; justify-content: center;
    /* Moved down to line up with the middle of the lowercase letters. Flex
       centring puts it too high, because the line includes the tall k and
       the space below the text. It uses top, not a margin, so the line
       under the name doesn't move with it. */
    position: relative; top: {key_top}px;
  }}
  /* The line under the name, with a dot at each end like the website's
     guide lines. */
  .rule {{
    position: relative;
    width: 320px; height: 1px; background: rgba(170, 190, 255, 0.34);
    /* Leaves room for the lowered key. */
    margin: 36px 0 18px;
  }}
  .rule::before, .rule::after {{
    content: ""; position: absolute; top: -1.5px;
    width: 4px; height: 4px; border-radius: 50%;
    background: rgba(200, 212, 255, 0.8);
  }}
  .rule::before {{ left: -2px; }}
  .rule::after {{ right: -2px; }}
  .verbs {{
    font-size: 26px; font-weight: 500; color: #aab3cf;
    letter-spacing: 0.02em;
  }}
  /* The dots are dimmer than the words, so the three words read as
     separate. */
  .dot {{ color: #5b6796; padding: 0 9px; }}
</style></head>
<body>
  <div class="wordmark">cookie<span class="key">Z</span></div>
  <div class="rule"></div>
  <div class="verbs">delete<span class="dot">&bull;</span>edit<span
    class="dot">&bull;</span>create</div>
</body></html>"""

# How far the key is moved down to sit level with the lowercase letters.
KEY_TOP = 11


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(
            viewport={"width": WIDTH, "height": HEIGHT},
            device_scale_factor=1,
        )
        font = base64.b64encode(FONT.read_bytes()).decode("ascii")
        page.set_content(PAGE.format(w=WIDTH, h=HEIGHT, font=font, key_top=KEY_TOP))
        # Waits for the font, or the first capture can be in a fallback.
        page.evaluate("() => document.fonts.ready")
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
