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
popup-NAME.png at 780px wide and popup-NAME@2x.png at 1560px, so sharp
screens get sharp text and other screens don't download the bigger file.
The store images are always exactly 1280x800.

The first store image is also copied to docs/images/01-overview.png, the
preview image shown when someone shares a link to the website.
"""

import base64
import json
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

OUT = Path(__file__).resolve().parent.parent / "store" / "screenshots"

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
    ("04-search", "Search, then delete only what you're looking at"),
    ("05-keep", "Keep the cookies you don't want to lose"),
]

# The background the popup sits on. System fonts only, like the extension.
FRAME = """<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; width: 1280px; height: 800px; }
  body {
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 30px;
    background: linear-gradient(160deg, #f4f6fb 0%, #e8ecf5 100%);
    font: 500 27px/1.3 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #1f2633;
  }
  h1 { margin: 0; padding: 0 60px; font-size: 29px; font-weight: 600;
       letter-spacing: -0.01em; text-align: center; }
  .shot { position: relative; width: 780px; border-radius: 10px;
          box-shadow: 0 16px 40px rgba(20, 30, 60, 0.18),
                      0 2px 6px rgba(20, 30, 60, 0.10); }
  img { width: 780px; display: block; border-radius: 10px; }
  /* Only added when the popup's content scrolls. The fade shows there's more
     below, instead of the image ending halfway through a row, which looks
     broken. */
  .shot.clipped::after {
    content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 72px;
    border-radius: 0 0 10px 10px;
    background: linear-gradient(to bottom, rgba(255,255,255,0) 0%, rgba(255,255,255,0.92) 85%);
  }
</style></head>
<body><h1>__CAPTION__</h1><div class="shot __CLIPPED__"><img src="__IMAGE__"></div></body></html>"""


def compose(context, png_bytes, caption, out_path, clipped=False):
    """Put a popup capture on a 1280x800 canvas with a caption."""
    data_uri = "data:image/png;base64," + base64.b64encode(png_bytes).decode("ascii")
    frame = context.new_page()
    frame.set_viewport_size({"width": 1280, "height": 800})
    frame.set_content(
        FRAME.replace("__CAPTION__", caption)
        .replace("__IMAGE__", data_uri)
        .replace("__CLIPPED__", "clipped" if clipped else "")
    )
    frame.wait_for_timeout(300)
    # scale="css" keeps the image at exactly 1280x800, which the store needs,
    # even though the browser runs at 2x.
    frame.screenshot(path=str(out_path), scale="css")
    frame.close()


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        # The whole browser runs at 2x. It has to be set here, when the
        # browser starts. An earlier version tried to open a separate 2x
        # window later, which failed without an error and gave 1x images.
        context = launch(p, "screenshots", device_scale_factor=2)
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
            compose(context, png, caption, OUT / f"{name}.png", clipped)

            # The website gets both sizes, and each browser only downloads the
            # one it needs (see srcset in docs/index.html).
            (SITE_OUT / f"popup-{name}.png").write_bytes(body.screenshot(scale="css"))
            (SITE_OUT / f"popup-{name}@2x.png").write_bytes(png)
            if name == SHOTS[0][0]:
                # The website's link preview image. Written here so it always
                # matches the store copy.
                (SITE_OUT / "01-overview.png").write_bytes((OUT / f"{name}.png").read_bytes())
            print(f"  wrote {name}.png" + ("  (content scrolls; faded)" if clipped else ""))

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

        # 4. search, with its own delete scope selected
        page.fill("#search-input", "token")
        page.wait_for_timeout(700)
        page.locator('input[name="scope"][value="matches"]').check()
        page.wait_for_timeout(800)
        capture(*SHOTS[3])
        page.fill("#search-input", "")
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

    print(f"\n{len(SHOTS)} screenshots in {OUT}")
    print("Check each one before uploading: no real values, nothing cut off.")


if __name__ == "__main__":
    sys.exit(main())
