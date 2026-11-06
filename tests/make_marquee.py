"""
Makes the Chrome Web Store marquee promo image.

    python make_marquee.py

Writes store/marquee-1400x560.png. The store only shows it if cookieZ is
picked for a featured spot, at the top of a category or collection.

The small tile's look (make_promo_tile.py), made wide: the name, the line
and a few words on the left, and the popup from the first store
screenshot on the right. Drawn at exactly 1400x560 so the text
stays sharp.
"""

import base64
import sys

from playwright.sync_api import sync_playwright

from make_promo_tile import FONT, ROOT

OUT = ROOT / "store" / "marquee-1400x560.png"
SHOT = ROOT / "store" / "screenshots" / "01-overview.png"

# The popup inside 01-overview.png: left, top, right, bottom.
CROP = (241, 207, 1039, 662)
SHOT_WIDTH = 780

WIDTH = 1400
HEIGHT = 560

PAGE = """<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  @font-face {{
    font-family: "Hanken Grotesk";
    src: url("data:font/woff2;base64,{font}") format("woff2");
    font-weight: 100 900;
  }}
  html, body {{ margin: 0; width: {w}px; height: {h}px; overflow: hidden; }}
  body {{
    display: flex; align-items: center; gap: 72px;
    /* The store can crop the edges, so keep 56px clear. */
    padding: 56px 0 56px 88px; box-sizing: border-box;
    background:
      radial-gradient(ellipse 700px 260px at 72% 100%, rgba(138, 168, 255, 0.22), transparent 72%),
      radial-gradient(ellipse 420px 220px at 18% 0%, rgba(138, 168, 255, 0.10), transparent 72%),
      #05070f;
    font-family: "Hanken Grotesk", sans-serif;
    color: #eef1fb;
  }}
  .text {{ flex: none; }}
  .wordmark {{
    display: flex; align-items: center; gap: 9px;
    font-size: 104px; font-weight: 600; letter-spacing: -0.02em; line-height: 1;
  }}
  /* The same raised keycap as the small tile, scaled up. */
  .key {{
    width: 96px; height: 96px; box-sizing: border-box; border-radius: 20px;
    background: linear-gradient(180deg, #343e63 0%, #1b2136 100%);
    border: 2px solid #5b6796;
    box-shadow: 0 6px 0 #5b6796, 0 18px 52px 8px rgba(138, 168, 255, 0.5);
    font-size: 66px; font-weight: 600; letter-spacing: 0;
    display: flex; align-items: center; justify-content: center;
    position: relative; top: 13px;
  }}
  .rule {{
    position: relative; width: 400px; height: 1px;
    background: rgba(170, 190, 255, 0.34); margin: 44px 0 24px;
  }}
  .rule::before, .rule::after {{
    content: ""; position: absolute; top: -1.5px;
    width: 4px; height: 4px; border-radius: 50%;
    background: rgba(200, 212, 255, 0.8);
  }}
  .rule::before {{ left: -2px; }}
  .rule::after {{ right: -2px; }}
  .line {{ margin: 0; font-size: 34px; font-weight: 600; }}
  .sub {{ margin: 10px 0 0; font-size: 24px; font-weight: 500; color: #aab3cf; }}
  /* Just the popup, cut out of the store screenshot (which has a caption
     and space around it), and shown big enough to read. CROP is the part
     of the 1280x800 screenshot kept; it's scaled to fit SHOT_WIDTH. */
  .shot {{
    flex: none; width: {sw}px; height: {sh}px; overflow: hidden;
    border-radius: 12px;
    box-shadow: 0 30px 60px -20px rgba(0, 0, 0, 0.8), 0 0 80px rgba(138, 168, 255, 0.12);
  }}
  .shot img {{ display: block; width: {iw}px; margin: {mt}px 0 0 {ml}px; }}
</style></head>
<body>
  <div class="text">
    <div class="wordmark">cookie<span class="key">Z</span></div>
    <div class="rule"></div>
    <p class="line">Cookie editor &amp; blocker</p>
    <p class="sub">No ads. Nothing leaves your computer.</p>
  </div>
  <div class="shot"><img src="data:image/png;base64,{shot}" alt=""></div>
</body></html>"""


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        scale = SHOT_WIDTH / (CROP[2] - CROP[0])
        page = browser.new_page(viewport={"width": WIDTH, "height": HEIGHT}, device_scale_factor=1)
        page.set_content(PAGE.format(
            w=WIDTH, h=HEIGHT,
            font=base64.b64encode(FONT.read_bytes()).decode("ascii"),
            shot=base64.b64encode(SHOT.read_bytes()).decode("ascii"),
            sw=SHOT_WIDTH, sh=round((CROP[3] - CROP[1]) * scale),
            iw=round(1280 * scale), ml=-round(CROP[0] * scale), mt=-round(CROP[1] * scale),
        ))
        page.evaluate("() => document.fonts.ready")
        page.wait_for_timeout(200)
        page.screenshot(path=str(OUT))
        browser.close()
    print(f"wrote {OUT.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
