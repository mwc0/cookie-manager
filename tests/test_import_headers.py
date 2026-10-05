"""
Importing a Cookie header, a curl command or Set-Cookie lines, and putting
imported cookies on this site instead of where they came from.

A Cookie header only has names and values, so the important checks are that
a cookie the site already has keeps every other field (domain, path, flags,
expiry) and only its value changes, and that a new name becomes a plain
session cookie on this site. Everything is read back from Chrome's cookie
store, not from what the popup says.
"""

import calendar
import json
import sys
import time
from email.utils import formatdate

from playwright.sync_api import sync_playwright

from helpers import (
    Results,
    extension_id,
    launch,
    open_popup,
)

SITE = "https://hdr.test/"
FAR = 60 * 60 * 24 * 200

SEED = """async (far) => {
    const exp = Math.floor(Date.now() / 1000) + far;
    const set = (d) => chrome.cookies.set(d);
    await set({url: 'https://hdr.test/', name: 'sid', value: 'old-session', domain: 'hdr.test',
               secure: true, httpOnly: true, sameSite: 'lax', expirationDate: exp});
    await set({url: 'https://hdr.test/', name: 'pref', value: 'light'});
    await set({url: 'https://hdr.test/deep', name: 'deep', value: 'd1', path: '/deep'});
    await set({url: 'https://other.test/', name: 'sid', value: 'elsewhere'});
}"""

# Every cookie on the given domains, keyed by "name@domain path".
COOKIES = """async (domains) => {
    const found = {};
    for (const domain of domains) {
        const plain = await chrome.cookies.getAll({domain});
        const parts = await chrome.cookies.getAll({domain, partitionKey: {}});
        for (const c of [...plain, ...parts]) {
            found[c.name + '@' + c.domain + ' ' + c.path] = {
                value: c.value, hostOnly: c.hostOnly, secure: c.secure, httpOnly: c.httpOnly,
                sameSite: c.sameSite, session: c.session,
                exp: c.expirationDate ? Math.round(c.expirationDate) : null,
                partition: c.partitionKey ? c.partitionKey.topLevelSite : null,
            };
        }
    }
    return found;
}"""


def cookies(page, *domains):
    return page.evaluate(COOKIES, list(domains or ["hdr.test", "other.test"]))


def text_of(page, element_id):
    return page.locator("#" + element_id).text_content().strip()


def check_text(page, text):
    """Pastes `text` and clicks Check. Returns (summary, problems)."""
    page.locator("#import-button").click()
    page.wait_for_timeout(300)
    page.fill("#import-text", text)
    page.locator("#import-check").click()
    page.wait_for_timeout(700)
    return text_of(page, "import-summary"), text_of(page, "import-problems")


def confirm(page):
    page.locator("#import-confirm").click()
    page.wait_for_timeout(1500)
    return text_of(page, "import-result")


def back(page):
    page.locator("#import-back").click()
    page.wait_for_timeout(900)


def main():
    r = Results("Import: headers, curl, Set-Cookie, and moving to this site")

    with sync_playwright() as p:
        context = launch(p, "import-headers")
        ext_id = extension_id(context)
        page, errors = open_popup(context, ext_id, SITE)
        page.evaluate(SEED, FAR)
        page.reload()
        page.wait_for_timeout(1200)
        before = cookies(page)

        # --- a Cookie header: values change, nothing else does ---
        summary, problems = check_text(page, "Cookie: sid=new-session; pref=dark; fresh=1")
        r.check("the preview counts a Cookie header for this site",
                summary.startswith("Will add 3 cookies for hdr.test."), summary)
        r.check("it says only the values change for cookies the site has",
                "2 of them replace cookies you already have. Only their values change." in summary, summary)
        r.check("and that a new name will be a session cookie",
                "1 new cookie will be a session cookie, so Chrome removes it when it closes." in summary, summary)
        r.check("no offer to move cookies that are already for this site",
                page.locator("#import-move-row").is_hidden())
        result = confirm(page)
        after = cookies(page)
        sid_before, sid_after = before["sid@.hdr.test /"], after["sid@.hdr.test /"]
        r.check("sid has the new value",
                sid_after["value"] == "new-session", json.dumps(sid_after))
        r.check("and keeps its domain, flags and expiry",
                {k: v for k, v in sid_after.items() if k != "value"}
                == {k: v for k, v in sid_before.items() if k != "value"},
                json.dumps([sid_before, sid_after]))
        r.check("pref, a host-only cookie, has its new value",
                after["pref@hdr.test /"]["value"] == "dark" and after["pref@hdr.test /"]["hostOnly"],
                json.dumps(after.get("pref@hdr.test /")))
        r.check("fresh is new: host-only, session, Secure because the page is https",
                after.get("fresh@hdr.test /") == {
                    "value": "1", "hostOnly": True, "secure": True, "httpOnly": False,
                    "sameSite": "unspecified", "session": True, "exp": None, "partition": None},
                json.dumps(after.get("fresh@hdr.test /")))
        r.check("another site's cookie with the same name is untouched",
                after["sid@other.test /"]["value"] == "elsewhere"
                and after["deep@hdr.test /deep"]["value"] == "d1",
                json.dumps(after.get("sid@other.test /")))

        # Undo puts back the old values, and removes the new cookie.
        page.locator("#import-result .undo-button").click()
        page.wait_for_timeout(1200)
        r.check("Undo after a Cookie header import puts everything back",
                cookies(page) == before and "Removed 1 cookie and put back 2 cookies." in text_of(page, "import-result"),
                text_of(page, "import-result"))
        back(page)

        # --- curl: cookieZ's own export goes back in ---
        page.locator("#export-button").click()
        page.wait_for_timeout(300)
        page.locator('input[name="format"][value="curl"]').check()
        page.wait_for_timeout(200)
        exported = page.locator("#export-output").input_value()
        page.locator("#export-back").click()
        page.wait_for_timeout(300)

        check_text(page, "sid=changed; pref=changed")
        confirm(page)
        back(page)
        summary, problems = check_text(page, exported)
        result = confirm(page)
        r.check("cookieZ's own curl export imports, and puts the values back",
                cookies(page) == before, f"{exported!r} / {summary!r} / {problems!r}")
        back(page)

        # --- curl from DevTools, with $'...' quoting and a -H cookie line ---
        devtools = (
            "curl 'https://hdr.test/account' \\\n"
            "  -H 'accept: text/html' \\\n"
            "  -b $'pref=it\\'s; sid=from-devtools' \\\n"
            "  --compressed"
        )
        summary, problems = check_text(page, devtools)
        confirm(page)
        after = cookies(page)
        r.check("a DevTools curl command imports, $'...' quoting included",
                after["pref@hdr.test /"]["value"] == "it's"
                and after["sid@.hdr.test /"]["value"] == "from-devtools"
                and after["sid@.hdr.test /"]["httpOnly"],
                f"{summary!r} / {problems!r}")
        back(page)

        check_text(page, "curl 'https://hdr.test/' -H 'Cookie: fresh=2'")
        confirm(page)
        r.check("a Cookie line sent with -H works too",
                cookies(page).get("fresh@hdr.test /", {}).get("value") == "2",
                json.dumps(cookies(page).get("fresh@hdr.test /")))
        back(page)

        for text, expected in [
            ("curl 'https://hdr.test/' -b cookies.txt", "reads its cookies from a file"),
            ('curl ^"https://hdr.test/^" -b ^"a=1^"', "Windows (cmd)"),
            ("curl -X GET -b 'a=1'", "no web address"),
            ("curl 'https://hdr.test/' -H 'accept: x'", "doesn't send any cookies"),
        ]:
            summary, problems = check_text(page, text)
            r.check(f"curl problem explained: {expected}",
                    expected in problems and page.locator("#import-confirm-row").is_hidden(),
                    problems)
            back(page)

        # --- Set-Cookie lines, with other response headers mixed in ---
        soon = formatdate(time.time() + 30 * 86400, usegmt=True)
        headers = "\n".join([
            "HTTP/2 200",
            "content-type: text/html",
            "Set-Cookie: setc=v1; Domain=hdr.test; Path=/app; Max-Age=3600; Secure; HttpOnly; SameSite=Strict",
            "set-cookie: gone=x; Max-Age=0",
            "Set-Cookie: chipsy=c; Secure; Partitioned; SameSite=None",
            f"Set-Cookie: dated=d; Expires={soon}",
        ])
        summary, problems = check_text(page, headers)
        r.check("Set-Cookie lines are counted, and the expired one is skipped",
                summary.startswith("Will add 2 cookies for hdr.test.") and "1 cookie has already expired" in summary,
                summary)
        r.check("a partitioned Set-Cookie line is skipped, with the reason",
                "chipsy is partitioned" in problems, problems)
        confirm(page)
        after = cookies(page)
        setc = after.get("setc@.hdr.test /app")
        r.check("Domain, Path, Secure, HttpOnly and SameSite are all read",
                setc is not None and not setc["hostOnly"] and setc["secure"] and setc["httpOnly"]
                and setc["sameSite"] == "strict" and not setc["session"],
                json.dumps(setc))
        r.check("Max-Age sets the expiry from now",
                setc is not None and abs(setc["exp"] - (time.time() + 3600)) < 120,
                json.dumps(setc))
        dated = after.get("dated@hdr.test /")
        r.check("Expires is read, and no Domain means host-only on this site",
                dated is not None and dated["hostOnly"]
                and abs(dated["exp"] - calendar.timegm(time.strptime(soon, "%a, %d %b %Y %H:%M:%S GMT"))) < 2,
                json.dumps(dated))
        back(page)

        summary, problems = check_text(page, "bare=1; Path=/; SameSite=Lax")
        confirm(page)
        r.check("a Set-Cookie value without the 'Set-Cookie:' part is recognised",
                cookies(page).get("bare@hdr.test /", {}).get("sameSite") == "lax", summary)
        back(page)

        # --- putting cookies from another site on this one ---
        staging = json.dumps([
            {"name": "stg", "value": "s", "domain": ".staging.example", "hostOnly": False,
             "path": "/", "secure": True, "session": True},
            {"name": "stgpart", "value": "p", "domain": "staging.example", "hostOnly": True,
             "path": "/", "secure": True, "sameSite": "no_restriction", "session": True,
             "partitionKey": {"topLevelSite": "https://staging.example"}},
        ])
        summary, problems = check_text(page, staging)
        r.check("cookies for another site offer to move here",
                page.locator("#import-move-row").is_visible()
                and text_of(page, "import-move-row") == "Put them on hdr.test instead"
                and summary.startswith("Will add 2 cookies for staging.example."),
                f"{text_of(page, 'import-move-row')!r} / {summary!r}")
        page.locator("#import-move").check()
        page.wait_for_timeout(800)
        summary, problems = text_of(page, "import-summary"), text_of(page, "import-problems")
        r.check("ticking it moves them, and skips the partitioned one",
                summary.startswith("Will add 1 cookie for hdr.test.")
                and "stgpart (staging.example) is partitioned, so it can't be moved" in problems,
                f"{summary!r} / {problems!r}")
        r.check("focus stays on the box", page.evaluate("() => document.activeElement.id") == "import-move")
        confirm(page)
        moved = cookies(page, "hdr.test", "staging.example")
        r.check("the cookie lands on this site as host-only, with its flags",
                moved.get("stg@hdr.test /", {}).get("hostOnly") is True
                and moved["stg@hdr.test /"]["secure"]
                and not any(key.endswith("staging.example /") for key in moved),
                json.dumps(moved))
        back(page)

        # And the case it's for: from a staging site to localhost.
        local, local_errors = open_popup(context, ext_id, "http://localhost:3000/")
        check_text(local, staging)
        local.locator("#import-move").check()
        local.wait_for_timeout(800)
        r.check("on localhost the box names localhost",
                text_of(local, "import-move-row") == "Put them on localhost instead",
                text_of(local, "import-move-row"))
        confirm(local)
        on_local = cookies(local, "localhost")
        r.check("the cookie is put on localhost, ports aside",
                on_local.get("stg@localhost /", {}).get("value") == "s", json.dumps(on_local))

        r.check("no console errors throughout", not errors and not local_errors,
                str((errors + local_errors)[:3]))
        context.close()

    return r.summarise()


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
