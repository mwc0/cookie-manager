"""
Makes the Chrome Web Store screenshots.

    python make_store_screenshots.py

Writes 1280x800 PNGs to store/screenshots/. Run it again whenever the popup
changes, so the screenshots never go out of date.

Two rules, explained in store/README.md:

  - Every site shown is example.com or similar. Those domains are reserved
    for examples, so no real company's name ends up in the listing.
  - Every cookie value is clearly fake. Anything in a store screenshot is
    public forever.

The browser runs at 2x. The website gets two copies of each popup capture,
popup-NAME.webp at 780px wide and popup-NAME@2x.webp at 1560px, so sharp
screens get sharp text and other screens don't download the bigger file.
The store images are always exactly 1280x800 PNGs.

The first store image is also copied to docs/images/01-overview.png, the
preview image shown when someone shares a link to the website.

The five captures are taken twice, once with the browser set to light and
once set to dark, which the popup follows. The website gets both:
popup-NAME.webp and popup-NAME-dark.webp, each also at 2x. It shows the one
that matches the page's theme.

The store images lead with the dark look, like the website. One of the
five, the editor, is the light one, to show both themes exist. STORE_LIGHT
below says which.

The captions use the typeface bundled with the extension. It's read from
src/popup/fonts and put inside the page, so nothing is fetched.
"""

import base64
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

from helpers import (
    extension_id,
    grant_host_permission,
    launch,
    popup_url,
    stub_active_tab,
)

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "store" / "screenshots"
FONT = ROOT / "src" / "popup" / "fonts" / "hanken-grotesk.woff2"

# Popup captures for the website, without the caption and grey background,
# so the popup fills the image.
SITE_OUT = Path(__file__).resolve().parent.parent / "docs" / "images"
SITE = "https://example.com/"

# Clearly fake values. None of them look like a real token.
COOKIES = [
    {"url": SITE, "name": "session_id",
     "value": "s%3AEXAMPLE-NOT-A-REAL-SESSION.0000", "secure": True, "httpOnly": True},
    {"url": SITE, "name": "csrf_token", "value": "example-csrf-000000", "secure": True},
    {"url": SITE, "name": "locale", "value": "en-GB"},
    {"url": SITE, "name": "cart_id", "value": "example-cart-42", "domain": ".example.com"},
    # A few other sites, so the "All sites" scope has something to show.
    {"url": "https://example.org/", "name": "prefs", "value": "example-only"},
    {"url": "https://example.net/", "name": "visits", "value": "3"},
    {"url": "https://docs.example.net/", "name": "sidebar", "value": "open"},
]

SHOTS = [
    ("01-overview", "See every cookie on the site you're on"),
    ("02-delete-scope", "Delete all of them, and see exactly what that means first"),
    ("03-edit", "Create and edit any field of a cookie"),
    ("04-search", "Search or filter, then delete only what you're looking at"),
    ("05-keep", "Keep the cookies you don't want to lose"),
]

# The store images are the dark captures, except these, which are light.
STORE_LIGHT = {"03-edit"}

# What differs between the two frames the popup is shown on. `fade` is the
# popup's own background colour, for the fade at the bottom of a capture
# that scrolls.
FRAME_THEMES = {
    "dark": {
        "page": "#05070f", "ink": "#eef1fb", "light": "138, 168, 255", "beam": "0.34",
        "edge": "rgba(170, 190, 255, 0.34)", "plate": "#0b0f1d", "dot": "rgba(200, 212, 255, 0.75)",
        "shadow": "0 30px 60px -30px rgba(138, 168, 255, 0.45)", "fade": "5, 7, 15",
    },
    "light": {
        "page": "#f2f4fa", "ink": "#121829", "light": "44, 92, 214", "beam": "0.14",
        "edge": "rgba(18, 24, 41, 0.26)", "plate": "#ffffff", "dot": "rgba(18, 24, 41, 0.5)",
        "shadow": "0 2px 4px rgba(20, 30, 60, 0.06), 0 26px 44px -26px rgba(20, 30, 60, 0.35)", "fade": "242, 244, 250",
    },
}

# The page the popup sits on: the website's look. A dark (or light) field
# with the beam falling from the top centre, the caption, and the popup in a
# plate with a dot in each corner.
FRAME = """<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  @font-face {
    font-family: "Hanken Grotesk";
    src: url("data:font/woff2;base64,__FONT__") format("woff2");
    font-weight: 100 900;
  }
  html, body { margin: 0; padding: 0; width: 1280px; height: 800px; }
  body {
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 26px;
    background:
      radial-gradient(ellipse 420px 260px at 50% 0, rgba(__LIGHT__, __BEAM__), transparent 72%),
      conic-gradient(from 180deg at 50% -40px,
        rgba(__LIGHT__, calc(__BEAM__ * 0.8)) 0deg, transparent 30deg,
        transparent 330deg, rgba(__LIGHT__, calc(__BEAM__ * 0.8)) 360deg),
      __PAGE__;
    font-family: "Hanken Grotesk", sans-serif;
    color: __INK__;
  }
  h1 { margin: 0; padding: 0 60px; font-size: 31px; font-weight: 600;
       letter-spacing: -0.025em; text-align: center; }
  .shot { position: relative; width: 780px; padding: 8px; border-radius: 18px;
          border: 1px solid __EDGE__; background: __PLATE__;
          box-shadow: __SHADOW__; }
  img { width: 780px; display: block; border-radius: 10px; }
  /* The four dots in the plate's corners. */
  .shot::before {
    content: ""; position: absolute; inset: 3px; pointer-events: none;
    background:
      radial-gradient(circle, __DOT__ 0 1.2px, transparent 1.7px) left top / 4px 4px no-repeat,
      radial-gradient(circle, __DOT__ 0 1.2px, transparent 1.7px) right top / 4px 4px no-repeat,
      radial-gradient(circle, __DOT__ 0 1.2px, transparent 1.7px) left bottom / 4px 4px no-repeat,
      radial-gradient(circle, __DOT__ 0 1.2px, transparent 1.7px) right bottom / 4px 4px no-repeat;
  }
  /* Only added when the popup's content scrolls. The fade shows there's more
     below, instead of the image ending halfway through a row, which looks
     broken. */
  .shot.clipped::after {
    content: ""; position: absolute; left: 8px; right: 8px; bottom: 8px; height: 72px;
    border-radius: 0 0 10px 10px;
    background: linear-gradient(to bottom, rgba(__FADE__, 0) 0%, rgba(__FADE__, 0.94) 85%);
  }
</style></head>
<body><h1>__CAPTION__</h1><div class="shot __CLIPPED__"><img src="__IMAGE__"></div></body></html>"""


def to_webp(context, png_bytes):
    """
    Converts a PNG to WebP, using Chrome so no image library is needed.

    Quality 90 is about 40% smaller than the PNG and looks the same, text
    included. Lossless WebP came out bigger than the PNG.
    """
    page = context.new_page()
    webp = page.evaluate(
        """async (png) => {
            const img = new Image();
            img.src = "data:image/png;base64," + png;
            await img.decode();
            const canvas = document.createElement("canvas");
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            canvas.getContext("2d").drawImage(img, 0, 0);
            return canvas.toDataURL("image/webp", 0.9).split(",")[1];
        }""",
        base64.b64encode(png_bytes).decode("ascii"),
    )
    page.close()
    return base64.b64decode(webp)


def compose(context, png_bytes, caption, out_path, theme, clipped=False):
    """Put a popup capture on a 1280x800 canvas with a caption."""
    data_uri = "data:image/png;base64," + base64.b64encode(png_bytes).decode("ascii")
    html = (
        FRAME.replace("__CAPTION__", caption)
        .replace("__IMAGE__", data_uri)
        .replace("__CLIPPED__", "clipped" if clipped else "")
        .replace("__FONT__", base64.b64encode(FONT.read_bytes()).decode("ascii"))
    )
    for name, value in FRAME_THEMES[theme].items():
        html = html.replace("__" + name.upper() + "__", value)

    frame = context.new_page()
    frame.set_viewport_size({"width": 1280, "height": 800})
    frame.set_content(html)
    # Waits for the font, or the caption can be drawn in a fallback.
    frame.evaluate("() => document.fonts.ready")
    frame.wait_for_timeout(300)
    # scale="css" keeps the image at exactly 1280x800, which the store needs,
    # even though the browser runs at 2x.
    frame.screenshot(path=str(out_path), scale="css")
    frame.close()


def shoot(p, dark=False):
    """
    Takes the five screenshots once.

    Each pass writes the website's captures for its theme, and the store
    images that use that theme (see STORE_LIGHT). The dark pass (dark=True)
    starts the browser with a dark system theme, which the popup follows.
    """
    # The whole browser runs at 2x. It has to be set here, when the
    # browser starts. An earlier version tried to open a separate 2x
    # window later, which failed without an error and gave 1x images.
    context = launch(
        p,
        "screenshots-dark" if dark else "screenshots",
        device_scale_factor=2,
        color_scheme="dark" if dark else "light",
    )
    ext_id = extension_id(context)

    shot_page = context.new_page()
    shot_page.set_viewport_size({"width": 800, "height": 700})
    stub_active_tab(shot_page, SITE)
    shot_page.goto(popup_url(ext_id))
    shot_page.wait_for_timeout(400)
    grant_host_permission(shot_page)
    shot_page.evaluate(
        "async (cookies) => { for (const c of cookies) await chrome.cookies.set(c); }",
        COOKIES,
    )
    shot_page.close()

    page = context.new_page()
    stub_active_tab(page, SITE)
    page.goto(popup_url(ext_id))
    page.wait_for_timeout(1400)

    def capture(name, caption):
        page.mouse.move(0, 0)  # no stray hover states
        page.wait_for_timeout(250)
        clipped = page.evaluate(
            "() => document.body.scrollHeight > document.body.clientHeight + 2"
        )
        body = page.locator("body")
        png = body.screenshot()  # 2x, 1560px wide

        # The website gets both sizes, and each browser only downloads the
        # one it needs (see srcset in docs/index.html).
        suffix = "-dark" if dark else ""
        (SITE_OUT / f"popup-{name}{suffix}.webp").write_bytes(to_webp(context, body.screenshot(scale="css")))
        (SITE_OUT / f"popup-{name}{suffix}@2x.webp").write_bytes(to_webp(context, png))
        theme = "dark" if dark else "light"
        if (name in STORE_LIGHT) != (theme == "light"):
            print(f"  wrote popup-{name}{suffix}.webp")
            return

        compose(context, png, caption, OUT / f"{name}.png", theme, clipped)
        if name == SHOTS[0][0]:
            # The website's link preview image. Written here so it always
            # matches the store copy.
            (SITE_OUT / "01-overview.png").write_bytes((OUT / f"{name}.png").read_bytes())
        print(f"  wrote {name}.png ({theme})" + ("  (content scrolls; faded)" if clipped else ""))

    # 1. overview
    capture(*SHOTS[0])

    # 2. the delete scope indicator, all sites, domains expanded
    page.locator('input[name="scope"][value="all"]').check()
    page.wait_for_timeout(900)
    page.evaluate("() => { const d = document.getElementById('scope-domains'); if (d) d.open = true; }")
    page.wait_for_timeout(300)
    capture(*SHOTS[1])
    page.evaluate("() => { const d = document.getElementById('scope-domains'); if (d) d.open = false; }")
    page.locator('input[name="scope"][value="page"]').check()
    page.wait_for_timeout(700)

    # 3. the editor, mid-edit
    page.locator("#add-button").click()
    page.wait_for_timeout(400)
    page.fill("#field-name", "feature_flag")
    page.fill("#field-value", "beta-enabled")
    page.uncheck("#field-session")
    page.fill("#field-expiry", "2027-06-30T12:00")
    # Remove focus, or the screenshot shows a focus ring and selected
    # text left behind by fill(), which would look like bugs.
    page.evaluate("() => document.activeElement && document.activeElement.blur()")
    page.wait_for_timeout(300)
    capture(*SHOTS[2])
    page.locator("#edit-cancel").click()
    page.wait_for_timeout(600)

    # 4. a filter switched on, with its own delete scope selected
    page.locator('#filters .chip[data-filter="secure"]').click()
    page.wait_for_timeout(700)
    page.locator('input[name="scope"][value="matches"]').check()
    page.wait_for_timeout(800)
    capture(*SHOTS[3])
    page.locator("#search-clear").click()
    page.wait_for_timeout(700)

    # 5. a kept cookie
    row = page.locator("tr", has=page.locator("td.name", has_text="session_id"))
    row.locator("button.row-button.keep").first.click()
    page.wait_for_timeout(900)
    # Reopen the popup first. Otherwise the "Keeping session_id" message
    # is still showing, and it pushes the kept row down into the faded
    # bottom edge where it's hard to see.
    page.reload()
    page.wait_for_timeout(1400)
    page.locator('input[name="scope"][value="page"]').check()
    page.wait_for_timeout(800)
    capture(*SHOTS[4])

    page.close()
    context.close()


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        shoot(p)
        shoot(p, dark=True)

    print(f"\n{len(SHOTS)} screenshots in {OUT}")
    print("Check each one before uploading: no real values, nothing cut off.")


if __name__ == "__main__":
    sys.exit(main())
