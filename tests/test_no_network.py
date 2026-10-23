"""
The extension never makes a network request.

This is the product's main promise, so it's tested on every run, not just
checked in DevTools now and then.

Two checks, because they catch different things:
  - a search of the source for things that make requests (fetch, CDN links,
    web fonts), which also catches code that no test reaches
  - a record of every request the browser makes while the popup is used
"""

import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

from helpers import EXTENSION, Results, extension_id, launch, open_popup

SITE = "https://network.test/"

# Anything that makes, or could make, a network request.
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

    # The one web address cookieZ's code may hold is the store's review
    # page, opened in a tab only when "Leave a review" is clicked. Any other
    # https:// address in a string is a new place the extension could reach.
    # Only code is read, so licence files don't count. The bundled lists
    # name their sources, so they're left out too, and so are
    # .invalid and .example addresses, which can't exist (rules.js tests
    # with one, and a comment in cookies.js quotes one), and
    # "https://" + something, which only builds a cookie's address.
    review = re.search(
        r'STORE_REVIEWS_URL =\s*"([^"]+)"',
        (EXTENSION / "lib" / "review.js").read_text(encoding="utf-8"),
    ).group(1)
    addresses = []
    for path in files:
        if path.suffix not in {".js", ".html"} or "lists" in path.relative_to(EXTENSION).parts:
            continue
        text = path.read_text(encoding="utf-8")
        for match in re.finditer(r"""["'`](https://[^"'`\s]+)["'`]""", text):
            if match.group(1) != "https://" and not re.match(r"https://[^/]*\.(invalid|example)(/|$)", match.group(1)):
                addresses.append(f"{path.relative_to(EXTENSION).as_posix()}: {match.group(1)}")
    r.check("the only web address in src/ is the store's review page",
            addresses == [f"lib/review.js: {review}"],
            str(addresses))


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

        # Use the parts that could possibly make a request.
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
