"""
Known cookie names, other companies' partitioned cookies, and the checks
for developers.

1. Known names. A cookie called _ga is almost always Google Analytics, so
   the table says so, with a badge, a filter and a line in the editor. The
   risk is saying it about a cookie that isn't: a site can call its own
   cookie anything, so generic names like "id" must never match.

2. Partitioned cookies other companies keep for this site. A frame from
   widget-site.test on news-site.test can set a partitioned (CHIPS) cookie
   that's kept for news-site.test only. Its domain is widget-site.test, so
   a query by domain never finds it. It must be in news-site.test's table,
   in its delete count, deleted by "delete all for this site", and put
   back by Undo.

3. The developer filters: Not Secure, Readable by scripts and SameSite
   None. They only state facts about each cookie.

The page is served by a real local HTTPS server under two hostnames,
because Chrome only makes a cookie partitioned over a real secure
connection (see test_devtools_crosscheck.py). Its own port and hostnames,
so it can run at the same time as test_rules.py.
"""

import json
import ssl
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

from helpers import (
    PROFILES,
    Results,
    edit_button,
    extension_id,
    grant_host_permission,
    launch,
    popup_url,
    row_for,
    stub_active_tab,
)
from test_devtools_crosscheck import LocalTLS


class KnownSites(LocalTLS):
    """
    news-site.test sets its own cookies and embeds a frame from
    widget-site.test, which sets one partitioned cookie and one ordinary
    third-party cookie.
    """

    PORT = 8445
    TOP_HOST = "news-site.test"
    EMBED_HOST = "widget-site.test"

    def __init__(self, cert_dir):
        super().__init__(cert_dir)
        # Its own files, so it never shares a half-written certificate with
        # another test file.
        self.cert = Path(cert_dir) / "known-cert.pem"
        self.key = Path(cert_dir) / "known-key.pem"

    def start(self):
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                host = self.headers.get("Host", "").split(":")[0]
                self.send_response(200)
                self.send_header("Content-Type", "text/html")
                if host == outer.EMBED_HOST:
                    self.send_header(
                        "Set-Cookie", "w_chips=1; Secure; SameSite=None; Partitioned; Path=/")
                    self.send_header("Set-Cookie", "w_3p=1; Secure; SameSite=None; Path=/")
                    self.end_headers()
                    self.wfile.write(b"<!doctype html>widget")
                    return
                for cookie in TOP_COOKIES:
                    self.send_header("Set-Cookie", cookie)
                self.end_headers()
                frame = ("<!doctype html><iframe src='https://" + outer.EMBED_HOST + ":"
                         + str(outer.PORT) + "/frame'></iframe>")
                self.wfile.write(frame.encode())

        ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ssl_context.load_cert_chain(self.cert, self.key)
        self.server = ThreadingHTTPServer(("127.0.0.1", self.PORT), Handler)
        self.server.socket = ssl_context.wrap_socket(self.server.socket, server_side=True)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def url(self, host):
        return "https://" + host + ":" + str(self.PORT) + "/"


# news-site.test's own cookies. _ga and _fbp are well-known names, _ga_ABC123
# matches the prefix _ga_, euconsent-v2 is listed under two companies, and
# id is far too common a name to say anything about.
TOP_COOKIES = [
    "_ga=GA1.1.1.1; Path=/",
    "_fbp=fb.1.1.1; Secure; Path=/",
    "_ga_ABC123=GS1.1.1; Secure; HttpOnly; Path=/",
    "euconsent-v2=CP1; Secure; SameSite=Lax; Path=/",
    "id=42; Secure; HttpOnly; Path=/",
    "sn=1; Secure; SameSite=None; Path=/",
]

TOP_NAMES = ["_fbp", "_ga", "_ga_ABC123", "euconsent-v2", "id", "sn", "w_chips"]


def names(page):
    return sorted(page.evaluate(
        "() => [...document.querySelectorAll('#cookie-rows td.name')].map(td => td.textContent)"))


def chips(page):
    """The filters on screen, and which are switched on."""
    return page.evaluate("""() => {
        const out = {};
        if (document.getElementById('filters').hidden) return out;
        for (const chip of document.querySelectorAll('#filters .chip')) {
            if (!chip.hidden) out[chip.dataset.filter] = chip.getAttribute('aria-pressed') === 'true';
        }
        return out;
    }""")


def press(page, name):
    page.locator(f'#filters .chip[data-filter="{name}"]').click()
    page.wait_for_timeout(500)


def known_badge(page, name):
    """The Known badge on a row: its words, its tip and what a screen reader hears. None if there isn't one."""
    badge = row_for(page, name).first.locator("td.flags .badge.known")
    if badge.count() == 0:
        return None
    return badge.evaluate("""b => ({
        shown: b.firstChild.textContent,
        title: b.title,
        read: b.textContent,
    })""")


def partition_cookies(page, site):
    """What Chrome keeps in one site's partition, read straight from the store."""
    return page.evaluate("""async (site) => (await chrome.cookies.getAll({partitionKey: {topLevelSite: site}}))
        .map(c => ({name: c.name, domain: c.domain, site: c.partitionKey && c.partitionKey.topLevelSite}))""", site)


def store_names(page, host):
    return sorted(c["name"] for c in page.evaluate(
        "async (host) => await chrome.cookies.getAll({domain: host})", host))


def new_popup(context, ext_id, url):
    page = context.new_page()
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    stub_active_tab(page, url)
    page.goto(popup_url(ext_id))
    page.wait_for_timeout(400)
    grant_host_permission(page)
    page.reload()
    # The known list loads after the table, so give it a moment.
    page.wait_for_timeout(1800)
    return page, errors


def check_known(r, page):
    r.check("the table lists the site's cookies, and the one another company keeps for it",
            names(page) == TOP_NAMES, str(names(page)))

    ga = known_badge(page, "_ga")
    fbp = known_badge(page, "_fbp")
    r.check("_ga and _fbp get a Known badge, naming the company in its tip",
            ga is not None and fbp is not None
            and ga["shown"] == "Known" and "Google Analytics" in ga["title"]
            and fbp["shown"] == "Known" and "Facebook" in fbp["title"],
            json.dumps([ga, fbp]))
    r.check("the tip says it's a guess from the name",
            ga is not None and "A guess from the name only." in ga["title"], json.dumps(ga))
    r.check("screen readers hear who it's known for",
            ga is not None and ga["read"] == "Known name, used by Google Analytics", json.dumps(ga))
    r.check("a generic name like id isn't marked", known_badge(page, "id") is None,
            json.dumps(known_badge(page, "id")))
    prefix = known_badge(page, "_ga_ABC123")
    r.check("a prefix match: _ga_ABC123 is known from _ga_",
            prefix is not None and "Google Analytics" in prefix["title"], json.dumps(prefix))
    several = known_badge(page, "euconsent-v2")
    r.check("a name listed under two companies says so",
            several is not None and "used by Didomi and 1 other." in several["title"], json.dumps(several))
    table_text = page.locator("#cookie-table").text_content().lower()
    r.check("the word tracker isn't used", "tracker" not in table_text)

    # --- the Known filter ---
    r.check("the Known filter is offered", "known" in chips(page), json.dumps(chips(page)))
    press(page, "known")
    r.check("Known shows only the known names",
            names(page) == ["_fbp", "_ga", "_ga_ABC123", "euconsent-v2"], str(names(page)))
    press(page, "known")

    # --- the editor ---
    edit_button(row_for(page, "_ga").first).click()
    page.wait_for_timeout(400)
    line = page.locator("#name-known")
    text = " ".join((line.text_content() if line.is_visible() else "").split())
    r.check("the editor says what the name is known for, in one line",
            text.startswith("Known name: Google Analytics, analytics. ID used to identify users."), repr(text))
    r.check("with the credit, and that it's a guess",
            "A guess from the name only. From the Open Cookie Database." in text, repr(text))
    page.fill("#field-name", "id")
    page.wait_for_timeout(200)
    r.check("typing a name that isn't known takes the line away", not line.is_visible())
    page.locator("#edit-cancel").click()
    page.wait_for_timeout(500)
    edit_button(row_for(page, "id").first).click()
    page.wait_for_timeout(400)
    r.check("a cookie called id has no such line", not line.is_visible())
    page.locator("#edit-cancel").click()
    page.wait_for_timeout(500)


def check_developer_filters(r, page):
    shown = chips(page)
    r.check("the three checks are offered on an HTTPS page",
            all(name in shown for name in ("notsecure", "readable", "samesitenone")), json.dumps(shown))

    press(page, "notsecure")
    r.check("Not Secure shows the cookie without Secure", names(page) == ["_ga"], str(names(page)))
    press(page, "notsecure")

    press(page, "readable")
    r.check("Readable by scripts shows the cookies without HttpOnly",
            names(page) == ["_fbp", "_ga", "euconsent-v2", "sn", "w_chips"], str(names(page)))
    press(page, "samesitenone")
    r.check("with SameSite None too, only cookies that are both",
            names(page) == ["sn", "w_chips"], str(names(page)))
    press(page, "readable")
    r.check("SameSite None alone", names(page) == ["sn", "w_chips"], str(names(page)))
    press(page, "samesitenone")

    # The layout: one line of filters as the site is, and when every filter
    # is showing, the three checks move to the next line together.
    natural = page.evaluate("""() => [...document.querySelectorAll('#filters .chip')]
        .filter(c => !c.hidden).map(c => Math.round(c.getBoundingClientRect().top))""")
    r.check("this site's filters fit on one line", len(set(natural)) == 1, str(natural))
    every = page.evaluate("""() => {
        for (const chip of document.querySelectorAll('#filters .chip')) chip.hidden = false;
        const top = (c) => Math.round(c.getBoundingClientRect().top);
        return {
            checks: [...document.querySelectorAll('.filters-checks .chip')].map(top),
            lines: new Set([...document.querySelectorAll('#filters .chip')].map(top)).size,
            wide: document.body.scrollWidth > document.body.clientWidth,
        };
    }""")
    r.check("with every filter showing: at most two lines, the checks together, nothing sideways",
            every["lines"] <= 2 and len(set(every["checks"])) == 1 and not every["wide"], json.dumps(every))
    page.reload()
    page.wait_for_timeout(1800)


def check_http_page(r, context, ext_id):
    page, errors = new_popup(context, ext_id, "http://plain-http.test/")
    page.evaluate("async () => { await chrome.cookies.set({url: 'http://plain-http.test/', name: 'plain', value: '1'}); }")
    page.reload()
    page.wait_for_timeout(1500)
    shown = chips(page)
    r.check("Not Secure isn't offered on a plain HTTP page, where nothing can be Secure",
            "notsecure" not in shown and "readable" in shown, json.dumps(shown))
    page.close()
    return errors


def check_partitioned(r, page):
    top_site = "https://" + KnownSites.TOP_HOST

    note = row_for(page, "w_chips").first.locator(".embedded-note")
    r.check("the other company's partitioned cookie says plainly that it's kept for this site",
            note.count() == 1 and note.text_content() == "set in a frame, kept for this site only"
            and "Set by widget-site.test" in (note.get_attribute("title") or ""),
            note.text_content() if note.count() else "no note")
    r.check("its ordinary third-party cookie, which isn't this site's, isn't listed",
            "w_3p" not in names(page), str(names(page)))

    # A kept cookie of the other company's, elsewhere, mustn't be forgotten
    # just because one of its cookies is in this table.
    kept_key = "widget-site.test\n/\nw_3p\n"
    page.evaluate("async (key) => { await chrome.storage.local.set({ protectedCookies: [key] }); }", kept_key)
    page.reload()
    page.wait_for_timeout(1800)
    still = page.evaluate("async () => (await chrome.storage.local.get('protectedCookies')).protectedCookies")
    r.check("the other company's kept cookies elsewhere stay on the Kept list", still == [kept_key], str(still))
    page.evaluate("async () => { await chrome.storage.local.remove('protectedCookies'); }")
    page.reload()
    page.wait_for_timeout(1800)

    summary = page.locator("#scope-summary").text_content()
    r.check("This page counts it: the number is the table's",
            summary.startswith("Will delete 7 cookies across 2 sites."), repr(summary))

    # Export of the site's cookies.
    page.locator("#export-button").click()
    page.wait_for_timeout(400)
    exported = page.locator("#export-output").input_value()
    r.check("the export of this page includes it", '"w_chips"' in exported and '"_ga"' in exported)
    page.locator('input[name="format"][value="header"]').check()
    page.wait_for_timeout(200)
    header = page.locator("#export-output").input_value()
    r.check("but the Cookie header leaves it out, since it's never sent to this site",
            "_ga=" in header and "w_chips" not in header, repr(header))
    page.locator('input[name="format"][value="json"]').check()
    page.locator("#export-back").click()
    page.wait_for_timeout(400)

    # Clear site data counts it too. Only the question is checked here;
    # test_site_data.py clears for real.
    page.locator("#data-button").click()
    page.wait_for_timeout(600)
    question = page.locator("#data-confirm-text").text_content()
    r.check("Clear site data counts it", question.startswith("Delete 7 cookies from news-site.test"), repr(question))
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)

    # Delete everything for this site.
    page.locator('input[name="scope"][value="domain"]').check()
    page.wait_for_timeout(600)
    summary = page.locator("#scope-summary").text_content()
    r.check("the domain scope counts it the same",
            summary.startswith("Will delete 7 cookies across 2 sites."), repr(summary))
    page.locator("#delete-button").click()
    page.wait_for_timeout(300)
    page.locator("#confirm-yes").click()
    page.wait_for_timeout(1500)
    left = partition_cookies(page, top_site)
    r.check("deleting this site's cookies deletes the partitioned one too",
            left == [] and store_names(page, KnownSites.TOP_HOST) == [],
            json.dumps(left) + " " + str(store_names(page, KnownSites.TOP_HOST)))
    r.check("and leaves the other company's own cookie alone",
            store_names(page, KnownSites.EMBED_HOST) == ["w_3p"], str(store_names(page, KnownSites.EMBED_HOST)))
    message = page.locator("#main-message").text_content()
    r.check("it says how many went", message.startswith("Deleted 7 cookies."), repr(message))

    page.locator("#main-message .undo-button").click()
    page.wait_for_timeout(1500)
    back = partition_cookies(page, top_site)
    r.check("Undo puts the partitioned cookie back, in this site's partition",
            [c["name"] for c in back] == ["w_chips"] and back[0]["site"] == top_site, json.dumps(back))
    r.check("and the table has everything again", names(page) == TOP_NAMES, str(names(page)))
    message = page.locator("#main-message").text_content()
    r.check("Undo says so", message.startswith("Restored 7 cookies."), repr(message))


def main():
    r = Results("Known names, partitioned cookies kept for this site, and developer filters")

    server = KnownSites(PROFILES / "certs")
    if not server.certificate_available():
        r.check("openssl is available to make a test certificate", False, "install openssl and run again")
        return r.summarise()

    server.start()
    try:
        with sync_playwright() as p:
            context = launch(p, "known", extra_args=server.chrome_args)
            ext_id = extension_id(context)
            site = context.new_page()
            site.goto(server.url(server.TOP_HOST))
            site.wait_for_timeout(1800)

            page, errors = new_popup(context, ext_id, server.url(server.TOP_HOST))
            check_known(r, page)
            check_developer_filters(r, page)
            check_partitioned(r, page)
            errors += check_http_page(r, context, ext_id)
            r.check("no console errors throughout", not errors, str(errors[:3]))
            context.close()
    finally:
        server.stop()

    return r.summarise()


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
