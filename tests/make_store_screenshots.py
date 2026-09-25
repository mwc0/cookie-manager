"""
Generate the Chrome Web Store screenshots.

    python make_store_screenshots.py

Writes 1280x800 PNGs into store/screenshots/. Re-run it whenever the UI
changes -- that's the point of it being a script rather than a folder of
hand-taken captures that quietly go stale.

Two deliberate choices, both explained in store/README.md:

  - Everything is shown on example.com and friends. example.com is reserved
    for documentation, so no real service's branding ends up in the listing.
  - Every cookie value is obviously fake. Anything legible in a store
    screenshot is public forever.

The whole browser runs at 2x. The website gets each popup capture twice,
popup-NAME.png at 780px and popup-NAME@2x.png at 1560px, so high-resolution
screens get sharp text without ordinary screens downloading three times the
data. The store images are taken with scale="css", which gives exactly
1280x800 however dense the browser is, with the popup at its natural 780px.

The first store image also goes to docs/images/01-overview.png, which is the
picture every page of the website shows when a link to it is shared.
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

# The bare popup captures, without the caption and canvas, for the website.
# On a web page the popup should fill the image, not sit in a grey box.
SITE_OUT = Path(__file__).resolve().parent.parent / "docs" / "images"
SITE = "https://example.com/"

# Obviously fake values. Nothing here resembles a real token.
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

# The frame the popup sits on. System fonts only, in keeping with the
# extension itself making no network requests of any kind.
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
  /* Only added when the popup's content genuinely scrolls. It says "there is
     more below" instead of letting the frame end on a sliced-through row,
     which reads as a broken screenshot rather than a scrollable list. */
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
    # scale="css": one image pixel per CSS pixel, so the store gets the exact
    # 1280x800 it requires even though the browser is running at 2x.
    frame.screenshot(path=str(out_path), scale="css")
    frame.close()


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        # 2x for the whole browser. This has to be set here: the profile is a
        # persistent context, which has no separate browser to open a 2x
        # context from. (An earlier version tried that, got None, and quietly
        # captured everything at 1x.)
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

            # The website gets both sizes and each browser downloads only the
            # one it needs (srcset in docs/index.html): 1x for ordinary
            # screens, 2x for high-resolution screens and phones.
            (SITE_OUT / f"popup-{name}.png").write_bytes(body.screenshot(scale="css"))
            (SITE_OUT / f"popup-{name}@2x.png").write_bytes(png)
            if name == SHOTS[0][0]:
                # The website's link-preview image. Written here so it can't
                # fall behind the store copy again.
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
        # Drop focus, or the capture shows a focus ring and the blue
        # text-selection left behind by fill() -- artefacts of automation that
        # would look like UI defects in the listing.
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
        # Reopen the popup before capturing. The "Keeping session_id" message
        # stays until then, and its extra line pushed the kept row into the
        # faded bottom edge, so the screenshot's subject was the hardest thing
        # to see. Reopening is a real state too: it shows the cookie is still
        # kept after the popup was closed.
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
