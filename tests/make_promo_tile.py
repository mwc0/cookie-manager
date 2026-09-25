"""
Makes the Chrome Web Store small promo tile.

    python make_promo_tile.py

Writes store/promo-tile-440x280.png. The store needs exactly that size, so
the page is drawn at 440x280 instead of being made bigger and shrunk, which
would blur the text.

The tile is just the name, a line, and three words. In search results it's
shown at less than half size, next to the name and icon, so anything more
detailed can't be read.

The Z is a keycap, which stops the name looking like a typo for "cookies".
Because it's a raised shape and not just a different colour, it still
stands out when the tile is small.

The text is as big as it can be while staying 28px from the edges.

System fonts only, like the rest of the project.
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
    /* The store can crop a few pixels off the edges, so keep 28px clear. */
    padding: 28px; box-sizing: border-box;
  }}
  /* A flex row, so the keycap can be centred on the letters instead of
     sitting on the baseline. */
  .wordmark {{
    display: flex; align-items: center; gap: 6px;
    font-size: 84px; font-weight: 600; letter-spacing: -0.02em;
    line-height: 1;
  }}
  .key {{
    /* Lighter at the top, with a solid edge at the bottom instead of a soft
       shadow. That's what makes it look like a raised key when small. */
    width: 78px; height: 78px; box-sizing: border-box;
    border-radius: 16px;
    background: linear-gradient(180deg, #ffffff 0%, #eaeef5 100%);
    border: 2px solid #c2cad8;
    box-shadow: 0 5px 0 #c2cad8, 0 8px 12px rgba(20, 30, 60, 0.16);
    font-size: 54px; font-weight: 600; letter-spacing: 0;
    display: flex; align-items: center; justify-content: center;
    /* Moved down 13px to line up with the middle of the lowercase letters.
       Flex centring puts it too high, because the line includes the tall k
       and the space below the text. It uses top, not a margin, so the line
       under the name doesn't move with it. */
    position: relative; top: 13px;
  }}
  .rule {{
    width: 320px; height: 2px; background: #c9d0de;
    /* Leaves room for the lowered key. */
    margin: 34px 0 18px;
  }}
  .verbs {{
    font-size: 26px; font-weight: 500; color: #4a5568;
    letter-spacing: 0.02em;
  }}
  /* The dots are lighter than the words, so the three words read as
     separate. */
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
