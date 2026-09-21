"""
Partitioned (CHIPS) cookies.

Why this one matters more than it looks: a plain getAll() does not return
partitioned cookies, so a "delete everything" built on it alone leaves some
behind -- which is the exact complaint this extension exists to fix. The code
queries a second time with `partitionKey: {}` and merges. These tests pin down
that `{}` really does mean "any partition", because if that assumption ever
stops holding, the failure is silent.

Caveat worth keeping in mind: the partition key here is set directly via
chrome.cookies.set, not by a real cross-site embed. See README.md.
"""

import json
import sys

from playwright.sync_api import sync_playwright

from helpers import Results, extension_id, launch, open_popup, visible_state

SITE = "https://partitioned.test/"
TOP_LEVEL = "https://embedder.test"


def main():
    r = Results("Partitioned (CHIPS) cookies")

    with sync_playwright() as p:
        context = launch(p, "partitioned")
        ext_id = extension_id(context)
        page, errors = open_popup(context, ext_id, SITE)

        created = page.evaluate(
            """async ({url, topLevelSite}) => await chrome.cookies.set({
                url, name: 'chips_test', value: 'v1',
                partitionKey: { topLevelSite },
                sameSite: 'no_restriction', secure: true
            })""",
            {"url": SITE, "topLevelSite": TOP_LEVEL},
        )
        r.check("seeded a partitioned cookie", created is not None,
                json.dumps(created.get("partitionKey") if created else None))

        plain = page.evaluate("async (url) => await chrome.cookies.getAll({url})", SITE)
        r.check("a plain getAll() does NOT see it (this is the trap)",
                len(plain) == 0, f"{len(plain)} returned")

        any_partition = page.evaluate(
            "async (url) => await chrome.cookies.getAll({url, partitionKey: {}})", SITE
        )
        r.check("getAll({partitionKey: {}}) DOES see it, i.e. {} means 'any partition'",
                len(any_partition) == 1, f"{len(any_partition)} returned")

        exact = page.evaluate(
            """async ({url, topLevelSite}) => await chrome.cookies.getAll(
                {url, partitionKey: {topLevelSite}})""",
            {"url": SITE, "topLevelSite": TOP_LEVEL},
        )
        r.check("an exact partitionKey query also finds it (sanity check)", len(exact) == 1)

        # --- and now the thing that actually matters: the popup's own path ---
        page.reload()
        page.wait_for_timeout(1200)
        rows = page.evaluate("() => document.getElementById('cookie-rows').children.length")
        r.check("the popup lists the partitioned cookie",
                visible_state(page) == "state-main" and rows == 1,
                f"state={visible_state(page)}, rows={rows}")

        page.locator("#delete-button").click()
        page.wait_for_timeout(300)
        page.locator("#confirm-yes").click()
        page.wait_for_timeout(1000)

        left = page.evaluate(
            """async ({url, topLevelSite}) => (await chrome.cookies.getAll(
                {url, partitionKey: {topLevelSite}})).length""",
            {"url": SITE, "topLevelSite": TOP_LEVEL},
        )
        r.check("deleting at 'this page' scope really removes it", left == 0,
                f"{left} remaining, result: {page.locator('#delete-result').text_content().strip()!r}")
        r.check("no console errors", not errors, str(errors[:3]))

        context.close()

    return r.summarise()


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
