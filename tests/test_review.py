"""
The review ask: one small box, at most twice ever.

It shows, as a box over the popup, after the 3rd delete, import or Save
that went well. "Not now"
brings it back once, after the 25th. "Leave a review" or "No thanks" ends it
for good. It never shows on the same open as What's new or the welcome line.

The count is seeded in storage to get near 3 or 25, then one real delete
does the last job, so the popup's own code decides. chrome.tabs.create is
the one thing faked: it records the address instead of opening a tab, so
the test can check it's exactly the store's review page.
"""

import re
import sys

from playwright.sync_api import sync_playwright

from helpers import EXTENSION, HAS_WHATS_NEW, Results, delete_button, extension_id, launch, open_popup, row_for

SITE = "https://review.test/"

STORE_REVIEWS_URL = re.search(
    r'STORE_REVIEWS_URL =\s*"([^"]+)"',
    (EXTENSION / "lib" / "review.js").read_text(encoding="utf-8"),
).group(1)

# Records what chrome.tabs.create was asked to open, instead of opening it.
FAKE_CREATE = """
    (() => {
        window.createdTabs = [];
        chrome.tabs.create = (options) => {
            window.createdTabs.push(options.url);
            return Promise.resolve({ id: 99 });
        };
    })();
"""


def prepare(page, ask, seen="current"):
    """
    Seeds a cookie to delete, the saved review count (None for none), and
    the version last seen (None for a fresh install), then reloads.
    """
    page.evaluate(
        """async ([ask, seen]) => {
            await chrome.cookies.set({url: 'https://review.test/', name: 'to_delete', value: '1'});
            if (ask === null) { await chrome.storage.local.remove('reviewAsk'); }
            else { await chrome.storage.local.set({reviewAsk: ask}); }
            if (seen === null) { await chrome.storage.local.remove('seenVersion'); return; }
            const version = seen === 'current' ? chrome.runtime.getManifest().version : seen;
            await chrome.storage.local.set({seenVersion: version});
        }""",
        [ask, seen],
    )
    page.reload()
    page.wait_for_function(
        "() => !document.getElementById('scope-summary').textContent.includes('Counting')"
    )
    page.wait_for_timeout(300)


def delete_one(page):
    """One real job: deletes the seeded cookie, with its "Sure?" step."""
    row = row_for(page, "to_delete")
    delete_button(row).click()
    delete_button(row).click()
    page.wait_for_timeout(900)


def stored(page):
    return page.evaluate("async () => (await chrome.storage.local.get('reviewAsk')).reviewAsk || null")


def shown(page):
    return page.locator("#review-ask").is_visible()


def main():
    r = Results("Review ask")

    with sync_playwright() as p:
        context = launch(p, "review")
        ext_id = extension_id(context)
        page, errors = open_popup(context, ext_id, SITE)
        page.add_init_script(FAKE_CREATE)

        # --- before 3 jobs ---
        prepare(page, None)
        delete_one(page)
        r.check("no box after the first job", not shown(page), str(stored(page)))
        r.check("the job is counted", (stored(page) or {}).get("jobs") == 1, str(stored(page)))

        prepare(page, {"jobs": 1})
        delete_one(page)
        r.check("no box after the 2nd job", not shown(page), str(stored(page)))

        # --- the 3rd job, then Not now ---
        prepare(page, {"jobs": 2})
        delete_one(page)
        r.check("the box shows after the 3rd job, with Not now",
                shown(page) and page.locator("#review-later").text_content() == "Not now",
                page.locator("#review-ask").text_content().strip())
        r.check("its buttons are at least 24px tall",
                page.evaluate("""() => ['review-open', 'review-later'].every(
                    id => document.getElementById(id).getBoundingClientRect().height >= 24)"""))
        page.locator("#review-later").click()
        page.wait_for_timeout(300)
        r.check("Not now hides it and saves 'later'",
                not shown(page) and stored(page) == {"jobs": 3, "state": "later"}, str(stored(page)))

        prepare(page, {"jobs": 23, "state": "later"})
        delete_one(page)
        r.check("after Not now, nothing at the 24th job", not shown(page), str(stored(page)))
        prepare(page, {"jobs": 24, "state": "later"})
        delete_one(page)
        r.check("it comes back once at the 25th, with No thanks",
                shown(page) and page.locator("#review-later").text_content() == "No thanks",
                page.locator("#review-ask").text_content().strip())

        # --- No thanks ---
        page.locator("#review-later").click()
        page.wait_for_timeout(300)
        r.check("No thanks hides it and saves 'done'",
                not shown(page) and (stored(page) or {}).get("state") == "done", str(stored(page)))
        prepare(page, {"jobs": 4, "state": "done"})
        delete_one(page)
        r.check("once done, it never asks and stops counting",
                not shown(page) and stored(page) == {"jobs": 4, "state": "done"}, str(stored(page)))

        # --- Leave a review ---
        prepare(page, {"jobs": 2})
        delete_one(page)
        page.locator("#review-open").click()
        page.wait_for_timeout(300)
        created = page.evaluate("() => window.createdTabs")
        r.check("Leave a review opens exactly the store's review page",
                created == [STORE_REVIEWS_URL], str(created))
        r.check("and closes the box and saves 'done'",
                not shown(page) and (stored(page) or {}).get("state") == "done", str(stored(page)))

        # --- it sits over the popup, and Escape counts as Not now ---
        prepare(page, {"jobs": 2})
        delete_one(page)
        r.check("the box is a dialog over the popup",
                page.evaluate("() => document.getElementById('review-ask').matches(':modal')"))
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        r.check("Escape closes it and saves 'later'",
                not shown(page) and stored(page) == {"jobs": 3, "state": "later"}, str(stored(page)))

        # --- the Help screen's button ---
        prepare(page, {"jobs": 7, "state": "later"})
        page.locator("#help-button").click()
        page.wait_for_timeout(300)
        page.locator("#help-review").click()
        page.wait_for_timeout(300)
        created = page.evaluate("() => window.createdTabs")
        r.check("Help's Leave a review opens exactly the store's review page",
                created == [STORE_REVIEWS_URL], str(created))
        r.check("and leaves the saved answer alone",
                stored(page) == {"jobs": 7, "state": "later"}, str(stored(page)))
        page.locator("#help-back").click()
        page.wait_for_timeout(300)

        # --- never alongside What's new ---
        # Only when this version has a What's new line. The welcome line
        # below tests the same rule either way.
        if HAS_WHATS_NEW:
            prepare(page, {"jobs": 2}, seen="1.9.0")
            delete_one(page)
            r.check("never on the same open as What's new",
                    page.locator("#whats-new").is_visible() and not shown(page),
                    str(stored(page)))
        prepare(page, {"jobs": 2}, seen=None)
        delete_one(page)
        r.check("or the welcome line", page.locator("#whats-new").is_visible() and not shown(page),
                str(stored(page)))

        r.check("no console errors", not errors, str(errors[:3]))
        context.close()

    return r.summarise()


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
