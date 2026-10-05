"""
Undo after a delete.

The important check is that Undo puts back exactly what was deleted: every
field, read from Chrome's cookie store rather than from what the popup says.
It includes the kinds of cookie that are easy to get wrong: host-only,
domain-wide, HttpOnly, session, a path, and a partitioned cookie.

Undo is kept in chrome.storage.session so it survives the popup closing, so
these tests close and reopen it. It only lasts 10 minutes, which is checked
by moving the stored time back rather than waiting.
"""

import json
import sys

from playwright.sync_api import sync_playwright

from helpers import (
    Results,
    delete_button,
    extension_id,
    keep_button,
    launch,
    open_popup,
    row_for,
)

SITE = "https://undo.test/"
FAR = 60 * 60 * 24 * 200

SEED = """async (far) => {
    const exp = Math.floor(Date.now() / 1000) + far;
    const set = (d) => chrome.cookies.set(d);
    await set({url: 'https://undo.test/', name: 'plain', value: 'simple'});
    await set({url: 'https://undo.test/', name: 'wide', value: 'w1', domain: 'undo.test',
               secure: true, httpOnly: true, sameSite: 'strict', expirationDate: exp});
    await set({url: 'https://undo.test/', name: 'lax_one', value: 'x', sameSite: 'lax', expirationDate: exp});
    await set({url: 'https://undo.test/deep', name: 'deep', value: 'd', path: '/deep'});
    await set({url: 'https://undo.test/', name: 'chips', value: 'c', secure: true,
               sameSite: 'no_restriction', partitionKey: {topLevelSite: 'https://embedder.test'}});
    await set({url: 'https://undo.test/', name: 'kept_one', value: 'k'});
}"""

# Every cookie on the test site, partitioned ones included, in a form that
# can be compared.
SNAPSHOT = """async () => {
    const plain = await chrome.cookies.getAll({domain: 'undo.test'});
    const parts = await chrome.cookies.getAll({domain: 'undo.test', partitionKey: {}});
    const seen = new Map();
    for (const c of [...plain, ...parts]) {
        const key = [c.name, c.domain, c.path, c.partitionKey ? c.partitionKey.topLevelSite : ''].join('|');
        seen.set(key, {
            name: c.name, value: c.value, domain: c.domain, path: c.path, hostOnly: c.hostOnly,
            secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite, session: c.session,
            exp: c.expirationDate ? Math.round(c.expirationDate) : null,
            partition: c.partitionKey ? c.partitionKey.topLevelSite : null,
        });
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}"""


def snapshot(page):
    return page.evaluate(SNAPSHOT)


def names(cookies):
    return sorted(c["name"] for c in cookies)


def message(page):
    return page.locator("#main-message").text_content().strip()


def reopen(context, ext_id, page):
    """Closes the popup and opens it again, as the toolbar button would."""
    page.close()
    page, errors = open_popup(context, ext_id, SITE)
    # Wait until the popup has finished loading. Clicking while it's still
    # redrawing the table can land on the wrong row.
    page.wait_for_function(
        "() => !document.getElementById('scope-summary').textContent.includes('Counting')"
    )
    page.wait_for_timeout(300)
    return page, errors


def main():
    r = Results("Undo")

    with sync_playwright() as p:
        context = launch(p, "undo")
        ext_id = extension_id(context)
        page, errors = open_popup(context, ext_id, SITE)
        page.evaluate(SEED, FAR)
        page.reload()
        page.wait_for_timeout(1200)

        keep_button(row_for(page, "kept_one")).click()
        page.wait_for_timeout(700)

        original = snapshot(page)
        r.check("seeded six cookies, one partitioned and one kept",
                len(original) == 6 and any(c["partition"] for c in original), json.dumps(original))

        # --- delete "This page", and Undo is offered ---
        page.locator('input[name="scope"][value="page"]').check()
        page.wait_for_timeout(900)
        page.locator("#delete-button").click()
        page.wait_for_timeout(300)
        page.locator("#confirm-yes").click()
        page.wait_for_timeout(1200)
        result = page.locator("#main-message")
        r.check("the delete removes everything but the kept cookie",
                names(snapshot(page)) == ["kept_one"], str(names(snapshot(page))))
        r.check("the result offers Undo",
                "Deleted 5 cookies" in result.text_content()
                and result.locator(".undo-button").is_visible(),
                result.text_content().strip())

        # --- closing the popup doesn't lose it ---
        page, errors = reopen(context, ext_id, page)
        r.check("reopening the popup still offers Undo",
                message(page).startswith("Deleted 5 cookies from undo.test just now.")
                and page.locator("#main-message .undo-button").is_visible(),
                message(page))

        page.locator("#main-message .undo-button").click()
        page.wait_for_timeout(1500)
        r.check("Undo says what it restored", message(page).startswith("Restored 5 cookies"), message(page))
        after = snapshot(page)
        r.check("every cookie is back exactly, partition included",
                after == original, json.dumps([a for a in after if a not in original]))
        r.check("the table shows them again",
                page.locator("#cookie-rows tr").count() == 6, str(page.locator("#cookie-rows tr").count()))

        # --- once used, it's gone ---
        page, errors = reopen(context, ext_id, page)
        r.check("after an undo, nothing is offered on the next open",
                page.locator("#main-message").is_hidden(), message(page))

        # --- a single-row delete can be undone too ---
        row = row_for(page, "wide")
        delete_button(row).click()
        delete_button(row).click()
        page.wait_for_timeout(900)
        r.check("a single delete offers Undo",
                message(page).startswith("Deleted wide.")
                and page.locator("#main-message .undo-button").is_visible(),
                message(page))
        page.locator("#main-message .undo-button").click()
        page.wait_for_timeout(1200)
        r.check("and Undo puts that one back exactly",
                snapshot(page) == original, json.dumps([a for a in snapshot(page) if a not in original]))

        # --- it only lasts 10 minutes ---
        row = row_for(page, "plain")
        delete_button(row).click()
        delete_button(row).click()
        page.wait_for_timeout(900)
        page.evaluate("""async () => {
            const stored = await chrome.storage.session.get('lastDelete-normal');
            const last = stored['lastDelete-normal'];
            last.at -= 11 * 60;
            await chrome.storage.session.set({'lastDelete-normal': last});
        }""")
        page, errors = reopen(context, ext_id, page)
        r.check("a delete more than 10 minutes old isn't offered",
                page.locator("#main-message").is_hidden(), message(page))
        stored = page.evaluate("async () => await chrome.storage.session.get(null)")
        r.check("and it's removed from memory", stored == {}, json.dumps(stored))

        # --- nothing is kept on disk ---
        on_disk = page.evaluate("async () => Object.keys(await chrome.storage.local.get(null))")
        r.check("deleted cookies are never written to storage.local",
                not any("lastDelete" in key for key in on_disk), str(on_disk))

        r.check("no console errors throughout", not errors, str(errors[:3]))
        context.close()

    return r.summarise()


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
