"""
Export, import, copying a value, and opening in a tab.

The round trips are the important part: export, delete, import, and every
cookie comes back exactly as it was. They read Chrome's cookie store, not
what the popup says, and they include the kinds of cookie that are easy to
get wrong: host-only, session, SameSite, a path, and a partitioned cookie.
"""

import json
import sys

from playwright.sync_api import sync_playwright

from helpers import (
    Results,
    extension_id,
    launch,
    open_popup,
    popup_url,
    row_for,
    keep_button,
    visible_state,
)

SITE = "https://transfer.test/"
HOST = "transfer.test"
FAR = 60 * 60 * 24 * 200

SEED = """async (far) => {
    const exp = Math.floor(Date.now() / 1000) + far;
    const set = (d) => chrome.cookies.set(d);
    await set({url: 'https://transfer.test/', name: 'plain', value: 'simple'});
    await set({url: 'https://transfer.test/', name: 'wide', value: 'w1', domain: 'transfer.test',
               secure: true, httpOnly: true, sameSite: 'strict', expirationDate: exp});
    await set({url: 'https://transfer.test/', name: 'lax_one', value: 'x', sameSite: 'lax', expirationDate: exp});
    await set({url: 'https://transfer.test/deep', name: 'deep', value: 'd', path: '/deep'});
    await set({url: 'https://transfer.test/', name: 'long_value',
               value: 'a-long-value-that-is-cut-short-in-the-table-0123456789'});
    await set({url: 'https://transfer.test/', name: 'chips', value: 'c', secure: true,
               sameSite: 'no_restriction', partitionKey: {topLevelSite: 'https://embedder.test'}});
}"""

# Every cookie on the test site, partitioned ones included, in a form that
# can be compared.
SNAPSHOT = """async () => {
    const plain = await chrome.cookies.getAll({domain: 'transfer.test'});
    const parts = await chrome.cookies.getAll({domain: 'transfer.test', partitionKey: {}});
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

CLEAR = """async () => {
    const plain = await chrome.cookies.getAll({domain: 'transfer.test'});
    const parts = await chrome.cookies.getAll({domain: 'transfer.test', partitionKey: {}});
    for (const c of [...plain, ...parts]) {
        const d = {url: 'https://' + c.domain.replace(/^\\./, '') + c.path, name: c.name};
        if (c.partitionKey) d.partitionKey = c.partitionKey;
        await chrome.cookies.remove(d);
    }
}"""

# The clipboard can't be read back in a test, so writes are recorded instead.
CAPTURE_CLIPBOARD = "() => { navigator.clipboard.writeText = async (t) => { window.__copied = t; }; }"


def snapshot(page):
    return page.evaluate(SNAPSHOT)


def text_of(page, element_id):
    return page.locator("#" + element_id).text_content().strip()


def do_import(page, text):
    """Pastes `text`, checks it, and imports. Returns (preview, result)."""
    page.locator("#import-button").click()
    page.wait_for_timeout(300)
    page.fill("#import-text", text)
    page.locator("#import-check").click()
    page.wait_for_timeout(700)
    preview = text_of(page, "import-summary")
    if page.locator("#import-confirm").is_visible():
        page.locator("#import-confirm").click()
        page.wait_for_timeout(1500)
    result = text_of(page, "import-result") if page.locator("#import-result").is_visible() else ""
    return preview, result


def back_to_main(page):
    page.locator("#import-back").click()
    page.wait_for_timeout(900)


def export_text(page, fmt):
    page.locator("#export-button").click()
    page.wait_for_timeout(300)
    page.locator(f'input[name="format"][value="{fmt}"]').check()
    page.wait_for_timeout(200)
    text = page.locator("#export-output").input_value()
    summary = text_of(page, "export-summary")
    page.locator("#export-back").click()
    page.wait_for_timeout(300)
    return text, summary


def main():
    r = Results("Export / import / copy / tab")

    with sync_playwright() as p:
        context = launch(p, "transfer")
        ext_id = extension_id(context)
        page, errors = open_popup(context, ext_id, SITE)
        page.evaluate(SEED, FAR)
        page.reload()
        page.wait_for_timeout(1200)
        page.evaluate(CAPTURE_CLIPBOARD)

        original = snapshot(page)
        r.check("seeded six cookies, one of them partitioned",
                len(original) == 6 and any(c["partition"] for c in original), json.dumps(original))

        # --- export: the count matches the delete panel ---
        page.locator('input[name="scope"][value="page"]').check()
        page.wait_for_timeout(900)
        scope_summary = text_of(page, "scope-summary")
        json_text, export_summary = export_text(page, "json")
        exported = json.loads(json_text)
        r.check("export lists the same cookies the delete panel counts",
                "6 cookies" in scope_summary and export_summary.startswith("6 cookies") and len(exported) == 6,
                f"{scope_summary!r} / {export_summary!r} / {len(exported)} exported")
        r.check("the JSON uses EditThisCookie / Cookie-Editor field names",
                all({"domain", "hostOnly", "httpOnly", "name", "path", "sameSite", "secure",
                     "session", "value"} <= set(c) for c in exported))

        header, _ = export_text(page, "header")
        r.check("the Cookie header has every name and value",
                all(f"{c['name']}={c['value']}" in header for c in original) and header.count("; ") == 5,
                header)

        # --- copy and download ---
        page.locator("#export-button").click()
        page.wait_for_timeout(300)
        page.locator('input[name="format"][value="json"]').check()
        page.locator("#export-copy").click()
        page.wait_for_timeout(300)
        copied = page.evaluate("() => window.__copied")
        r.check("Copy copies the export", copied == page.locator("#export-output").input_value())

        with page.expect_download() as info:
            page.locator("#export-download").click()
        download = info.value
        saved = open(download.path(), encoding="utf-8").read()
        r.check("Download saves the same text, as a .json file named after the site",
                saved == json_text and download.suggested_filename.startswith("cookies-transfer.test-")
                and download.suggested_filename.endswith(".json"),
                download.suggested_filename)
        page.locator("#export-back").click()
        page.wait_for_timeout(300)

        # --- JSON round trip ---
        page.evaluate(CLEAR)
        r.check("cleared the site before importing", snapshot(page) == [])
        page.reload()
        page.wait_for_timeout(1000)
        page.evaluate(CAPTURE_CLIPBOARD)
        preview, result = do_import(page, json_text)
        after = snapshot(page)
        r.check("the import preview says how many will be added",
                preview.startswith("Will add 6 cookies"), preview)
        r.check("the result matches the preview", result.startswith("Imported 6 cookies"), result)
        r.check("JSON round trip: every cookie comes back exactly, partition included",
                after == original,
                json.dumps([a for a in after if a not in original]))

        # --- importing the same again replaces, it doesn't duplicate ---
        back_to_main(page)
        preview, result = do_import(page, json_text)
        r.check("importing again says the cookies replace existing ones",
                "6 of them replace cookies you already have" in preview, preview)
        r.check("and leaves one copy of each", snapshot(page) == original, str(len(snapshot(page))))
        back_to_main(page)

        # --- cookies.txt round trip ---
        netscape, _ = export_text(page, "netscape")
        r.check("cookies.txt marks HttpOnly cookies the standard way",
                "#HttpOnly_.transfer.test\tTRUE\t/\tTRUE\t" in netscape, netscape[:200])
        page.evaluate(CLEAR)
        preview, result = do_import(page, netscape)
        after = snapshot(page)

        def core(cookies):
            # cookies.txt has no room for SameSite or partitions.
            return sorted(
                [{k: c[k] for k in ("name", "value", "domain", "path", "hostOnly", "secure",
                                     "httpOnly", "session", "exp")} for c in cookies],
                key=lambda c: c["name"])

        r.check("cookies.txt round trip: everything it can hold comes back",
                core(after) == core(original) and result.startswith("Imported 6 cookies"),
                json.dumps([a for a in core(after) if a not in core(original)]))
        back_to_main(page)

        # --- other tools' exports ---
        other = json.dumps([
            {"domain": ".transfer.test", "name": "from_editor", "value": "e", "path": "/",
             "sameSite": None, "secure": False, "httpOnly": False, "session": True},
            {"domain": "transfer.test", "name": "from_puppeteer", "value": "p", "path": "/",
             "expires": -1, "sameSite": "Lax", "secure": False, "httpOnly": False},
        ])
        preview, result = do_import(page, other)
        got = {c["name"]: c for c in snapshot(page)}
        r.check("a Cookie-Editor style export imports (leading dot means domain-wide)",
                "from_editor" in got and not got["from_editor"]["hostOnly"] and got["from_editor"]["session"],
                json.dumps(got.get("from_editor")))
        r.check("a Puppeteer style export imports (expires -1 is a session cookie)",
                "from_puppeteer" in got and got["from_puppeteer"]["hostOnly"]
                and got["from_puppeteer"]["session"] and got["from_puppeteer"]["sameSite"] == "lax",
                json.dumps(got.get("from_puppeteer")))
        back_to_main(page)

        # --- bad input: readable, and nothing written ---
        before = snapshot(page)
        checks = [
            ("[{ not json", "couldn't be read"),
            ("a=1; b=2", "Cookie header"),
            ("just some words", "cookies.txt format"),
            ("", "nothing to import"),
        ]
        for text, expected in checks:
            page.locator("#import-button").click()
            page.wait_for_timeout(200)
            page.fill("#import-text", text)
            page.locator("#import-check").click()
            page.wait_for_timeout(500)
            problems = page.locator("#import-problems").text_content()
            r.check(f"bad input {text[:12]!r} is explained",
                    expected.lower() in problems.lower() and not page.locator("#import-confirm").is_visible(),
                    problems.strip())
            back_to_main(page)

        mixed = json.dumps([
            {"domain": "transfer.test", "name": "no_secure", "value": "v", "sameSite": "no_restriction",
             "secure": False, "hostOnly": True, "session": True},
            {"domain": "transfer.test", "name": "old", "value": "v", "hostOnly": True,
             "session": False, "expirationDate": 1000},
            {"domain": "transfer.test", "name": "good", "value": "v", "hostOnly": True, "session": True},
        ])
        preview, result = do_import(page, mixed)
        problems = page.locator("#import-problems").text_content()
        names = {c["name"] for c in snapshot(page)}
        r.check("an import skips the cookies it can't write, and says why",
                "Will add 1 cookie" in preview and "expired" in preview and "Secure" in problems,
                f"{preview!r} / {problems.strip()!r}")
        r.check("the reason describes the cookie instead of asking to tick a box",
                "isn't Secure" in problems and "Tick" not in problems, problems.strip())
        r.check("only the valid cookie was written",
                "good" in names and "no_secure" not in names and "old" not in names,
                str(sorted(names - {c['name'] for c in before})))
        back_to_main(page)

        # --- kept cookies are exported, and the export says so ---
        keep_button(row_for(page, "plain")).click()
        page.wait_for_timeout(700)
        _, summary = export_text(page, "json")
        r.check("the export includes kept cookies and says so",
                "including 1 kept cookie" in summary, summary)

        # --- copying a long value from the table ---
        page.evaluate(CAPTURE_CLIPBOARD)
        row = row_for(page, "long_value")
        row.locator(".value-toggle").click()
        page.wait_for_timeout(200)
        row.locator(".row-button.copy").click()
        page.wait_for_timeout(200)
        r.check("an expanded value has a Copy button that copies all of it",
                page.evaluate("() => window.__copied")
                == "a-long-value-that-is-cut-short-in-the-table-0123456789")

        # --- a Cookie header for a www site ---
        # A page on www.mixed.test gets cookies set for both www.mixed.test
        # and mixed.test. That's still one page's cookies, so the header
        # must be available for "This page".
        mixed_page, mixed_errors = open_popup(context, ext_id, "https://www.mixed.test/")
        mixed_page.evaluate("""async () => {
            await chrome.cookies.set({url: 'https://www.mixed.test/', name: 'on_www', value: 'a'});
            await chrome.cookies.set({url: 'https://www.mixed.test/', name: 'on_base', value: 'b',
                                      domain: 'mixed.test'});
        }""")
        mixed_page.reload()
        mixed_page.wait_for_timeout(1200)
        header_radio = mixed_page.locator('input[name="format"][value="header"]')

        mixed_page.locator('input[name="scope"][value="page"]').check()
        mixed_page.wait_for_timeout(900)
        mixed_page.locator("#export-button").click()
        mixed_page.wait_for_timeout(300)
        enabled = header_radio.is_enabled()
        header_radio.check()
        mixed_page.wait_for_timeout(200)
        header = mixed_page.locator("#export-output").input_value()
        r.check("the Cookie header works for This page on a www site",
                enabled and "on_www=a" in header and "on_base=b" in header, header)
        mixed_page.locator("#export-back").click()
        mixed_page.wait_for_timeout(300)

        mixed_page.locator('input[name="scope"][value="all"]').check()
        mixed_page.wait_for_timeout(900)
        mixed_page.locator("#export-button").click()
        mixed_page.wait_for_timeout(300)
        r.check("but not for All sites, which mixes several sites",
                header_radio.is_disabled())
        r.check("no console errors on the www site", not mixed_errors, str(mixed_errors))
        mixed_page.close()

        # --- open in a tab ---
        with context.expect_page() as info:
            page.locator("#tab-button").click()
        opened = info.value
        opened.wait_for_load_state()
        r.check("Open in a tab opens the popup in a tab, for the tab it came from",
                opened.url.startswith(popup_url(ext_id)) and "?tab=1" in opened.url, opened.url)
        opened.close()

        # A real tab on the test site, then the tab view pointed at it.
        site_tab = context.new_page()
        site_tab.route("https://transfer.test/**", lambda route: route.fulfill(
            status=200, content_type="text/html", body="<!doctype html><title>t</title>"))
        site_tab.goto(SITE)
        helper = context.new_page()
        helper.goto(popup_url(ext_id))
        tab_id = helper.evaluate(
            "async () => (await chrome.tabs.query({url: 'https://transfer.test/*'}))[0].id")
        helper.close()

        tab_view = context.new_page()
        tab_view.set_viewport_size({"width": 1280, "height": 900})
        tab_errors = []
        tab_view.on("console", lambda m: tab_errors.append(m.text) if m.type == "error" else None)
        tab_view.goto(popup_url(ext_id) + f"?tab={tab_id}")
        tab_view.wait_for_timeout(1500)
        width = tab_view.evaluate("() => document.body.getBoundingClientRect().width")
        r.check("the tab view shows that tab's site",
                visible_state(tab_view) == "state-main" and text_of(tab_view, "site-name") == HOST,
                f"state={visible_state(tab_view)}")
        r.check("the tab view is wider than the popup, and has no Open in a tab button",
                width > 800 and not tab_view.locator("#tab-button").is_visible(), f"{width}px")
        tab_view.locator("#import-button").click()
        tab_view.wait_for_timeout(300)
        r.check("choosing a file is offered in the tab view, not in the popup",
                tab_view.locator("#import-file").is_visible()
                and not tab_view.locator("#import-file-hint").is_visible())
        tab_view.locator("#import-file").set_input_files(files=[{
            "name": "c.json", "mimeType": "application/json",
            "buffer": json.dumps([{"domain": "transfer.test", "name": "from_file", "value": "f",
                                   "hostOnly": True, "session": True}]).encode()}])
        tab_view.wait_for_timeout(800)
        r.check("a chosen file is read and previewed",
                text_of(tab_view, "import-summary").startswith("Will add 1 cookie"),
                text_of(tab_view, "import-summary"))
        r.check("no console errors in the tab view", not tab_errors, str(tab_errors[:3]))

        r.check("no console errors throughout", not errors, str(errors[:3]))
        context.close()

    return r.summarise()


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
