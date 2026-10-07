"""
Undo after a delete, an import, a Save in the editor, or a new cookie.

The important check is that Undo puts back exactly what was there before:
every field, read from Chrome's cookie store rather than from what the popup
says. It includes the kinds of cookie that are easy to get wrong: host-only,
domain-wide, HttpOnly, session, a path, and a partitioned cookie. And Undo
never removes a cookie marked Kept.

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
    edit_button,
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
            const stored = await chrome.storage.session.get('lastChange-normal');
            const last = stored['lastChange-normal'];
            last.at -= 11 * 60;
            await chrome.storage.session.set({'lastChange-normal': last});
        }""")
        page, errors = reopen(context, ext_id, page)
        r.check("a delete more than 10 minutes old isn't offered",
                page.locator("#main-message").is_hidden(), message(page))
        stored = page.evaluate("async () => await chrome.storage.session.get(null)")
        r.check("and it's removed from memory", stored == {}, json.dumps(stored))

        # --- nothing is kept on disk ---
        on_disk = page.evaluate("async () => Object.keys(await chrome.storage.local.get(null))")
        r.check("deleted cookies are never written to storage.local",
                not any("lastChange" in key for key in on_disk), str(on_disk))

        before = snapshot(page)

        # --- an import can be undone: new ones go, replaced ones come back ---
        page.locator("#import-button").click()
        page.fill("#import-text", json.dumps([
            {"name": "lax_one", "value": "imported", "domain": "undo.test", "hostOnly": True,
             "path": "/", "session": True},
            {"name": "brand_new", "value": "n", "domain": "undo.test", "hostOnly": True,
             "path": "/", "session": True},
        ]))
        page.locator("#import-check").click()
        page.wait_for_timeout(600)
        page.locator("#import-confirm").click()
        page.wait_for_timeout(1200)
        result = page.locator("#import-result")
        r.check("an import offers Undo on the import screen",
                result.text_content().startswith("Imported 2 cookies (1 replaced).")
                and result.locator(".undo-button").is_visible(),
                result.text_content().strip())
        page.locator("#import-back").click()
        page.wait_for_timeout(1000)
        r.check("and again in the status line after going back",
                message(page).startswith("Imported 2 cookies from undo.test just now.")
                and page.locator("#main-message .undo-button").is_visible(),
                message(page))
        page.locator("#main-message .undo-button").click()
        page.wait_for_timeout(1200)
        r.check("Undo says it removed one and put one back",
                message(page) == "Removed 1 cookie and put back 1 cookie.", message(page))
        r.check("and the cookies are exactly as before the import",
                snapshot(page) == before, json.dumps([a for a in snapshot(page) if a not in before]))

        # --- a Save in the editor can be undone ---
        def edit(name, field, text):
            edit_button(row_for(page, name)).click()
            page.wait_for_timeout(400)
            page.fill(field, text)
            page.locator("#edit-save").click()
            page.wait_for_timeout(1000)

        edit("lax_one", "#field-value", "edited")
        r.check("saving a change offers Undo",
                message(page).startswith("Saved changes to lax_one.")
                and page.locator("#main-message .undo-button").is_visible(),
                message(page))
        page.locator("#main-message .undo-button").click()
        page.wait_for_timeout(1000)
        r.check("Undo puts the old value back",
                message(page) == "Put lax_one back as it was." and snapshot(page) == before,
                message(page))

        # A new name makes a second cookie, so Undo has to take that away too.
        edit("lax_one", "#field-name", "lax_renamed")
        page.locator("#main-message .undo-button").click()
        page.wait_for_timeout(1000)
        r.check("undoing a rename leaves only the original",
                snapshot(page) == before, json.dumps(names(snapshot(page))))

        # --- a new cookie can be undone ---
        page.locator("#add-button").click()
        page.wait_for_timeout(400)
        page.fill("#field-name", "made_here")
        page.fill("#field-value", "m")
        page.locator("#edit-save").click()
        page.wait_for_timeout(1000)
        r.check("creating a cookie offers Undo",
                message(page).startswith("Created made_here.")
                and page.locator("#main-message .undo-button").is_visible(),
                message(page))
        page.locator("#main-message .undo-button").click()
        page.wait_for_timeout(1000)
        r.check("Undo removes it again",
                message(page) == "Removed made_here." and snapshot(page) == before, message(page))

        # --- Undo never removes a kept cookie ---
        page.locator("#add-button").click()
        page.wait_for_timeout(400)
        page.fill("#field-name", "made_then_kept")
        page.fill("#field-value", "k")
        page.locator("#edit-save").click()
        page.wait_for_timeout(1000)
        keep_button(row_for(page, "made_then_kept")).click()
        page.wait_for_timeout(700)
        page, errors = reopen(context, ext_id, page)
        r.check("reopening offers to undo the new cookie",
                message(page).startswith("Created made_then_kept just now."), message(page))
        page.locator("#main-message .undo-button").click()
        page.wait_for_timeout(1000)
        r.check("but a cookie kept since is left alone, and Undo says so",
                "made_then_kept" in names(snapshot(page))
                and "1 cookie is marked Kept, so it was left alone." in message(page),
                message(page))

        r.check("no console errors throughout", not errors, str(errors[:3]))
        context.close()

    return r.summarise()


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
