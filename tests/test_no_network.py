"""
The extension makes no network requests. Ever.

This is the product's entire positioning rather than a nice-to-have, so it is
worth a test that runs every time and not just an occasional look at the
DevTools Network tab.

Two checks, because they fail differently:
  - a static grep for the things that cause requests (fetch, CDN links, web
    fonts), which catches them even on code paths a test never reaches
  - a live capture of every request the browser makes while the popup is used
"""

import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

from helpers import EXTENSION, Results, extension_id, launch, open_popup

SITE = "https://network.test/"

# Things that would mean a network request, or make one possible.
FORBIDDEN = [
    (r"\bfetch\s*\(", "fetch() call"),
    (r"XMLHttpRequest", "XMLHttpRequest"),
    (r"\bnavigator\.sendBeacon", "sendBeacon"),
    (r"\bnew\s+WebSocket", "WebSocket"),
    (r"\bnew\s+EventSource", "EventSource"),
    (r"""(?:src|href)\s*=\s*["']https?://""", "external src/href"),
    (r"@import\s+url\(\s*['\"]?https?://", "remote @import"),
    (r"fonts\.googleapis|fonts\.gstatic|cdnjs|jsdelivr|unpkg", "CDN or web font"),
]


def scan_source(r):
    files = [
        p for p in EXTENSION.rglob("*")
        if p.suffix in {".js", ".html", ".css", ".json"} and p.is_file()
    ]
    r.note("files scanned", f"{len(files)} under src/")

    hits = []
    for path in files:
        text = path.read_text(encoding="utf-8")
        for pattern, label in FORBIDDEN:
            for match in re.finditer(pattern, text):
                line = text[: match.start()].count("\n") + 1
                hits.append(f"{path.relative_to(EXTENSION)}:{line} {label}")

    r.check("no network-capable code anywhere in src/", not hits, str(hits) if hits else "clean")


def watch_requests(r):
    with sync_playwright() as p:
        context = launch(p, "network")
        ext_id = extension_id(context)

        requests = []
        context.on("request", lambda req: requests.append(req.url))

        page, errors = open_popup(context, ext_id, SITE)
        page.evaluate(
            "async () => { await chrome.cookies.set({url:'https://network.test/', name:'n', value:'1'}); }"
        )
        page.reload()
        page.wait_for_timeout(1000)

        # Exercise the parts that could plausibly reach out.
        page.locator("#add-button").click()
        page.wait_for_timeout(300)
        page.fill("#field-name", "made_here")
        page.fill("#field-value", "z")
        page.locator("#edit-save").click()
        page.wait_for_timeout(900)
        page.locator('input[name="scope"][value="all"]').check()
        page.wait_for_timeout(900)

        outbound = [
            u for u in requests
            if not u.startswith(("chrome-extension://", "chrome://", "devtools://", "about:"))
        ]
        r.check("the extension made no outbound requests", not outbound,
                f"{len(requests)} total, all local" if not outbound else str(outbound))
        r.check("no console errors", not errors, str(errors[:3]))

        context.close()


def main():
    r = Results("No network requests")
    scan_source(r)
    watch_requests(r)
    return r.summarise()


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
