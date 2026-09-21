"""
Cross-check the extension against Chrome itself.

Every other test in this directory verifies the extension by asking
`chrome.cookies` what happened. That is the same API the extension uses, so
if Chrome's extension API ever disagreed with how the browser actually stores
things, those tests would agree with the bug and still report green.

This file asks a different source: the Chrome DevTools Protocol. Storage.getCookies
and Network.requestWillBeSent are the calls behind DevTools' own Application
and Network panels, so what this file compares against is, in substance, what
you would see by opening DevTools and reading the tables yourself.

Three comparisons, matching the manual checklist in docs/HANDOFF.md:

  1. Cookie fields the popup DISPLAYS vs what DevTools reports.
  2. A partitioned (CHIPS) cookie created by a real cross-site iframe with a
     real Set-Cookie header, rather than one set directly through the
     extension API.
  3. Outbound requests, observed through the Network domain rather than
     Playwright's own request log.
"""

import json
import ssl
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

from helpers import (
    PROFILES,
    Results,
    extension_id,
    grant_host_permission,
    launch,
    popup_url,
    stub_active_tab,
)

SITE = "https://crosscheck.test/"
HOST = "crosscheck.test"

def devtools_cookies(cdp):
    """What DevTools' Application > Cookies panel would show."""
    return cdp.send("Storage.getCookies")["cookies"]


def displayed_rows(page):
    """What the popup's table actually shows, read out of the DOM."""
    return page.evaluate("""() => Array.from(document.querySelectorAll('#cookie-rows tr')).map(tr => {
        const cells = tr.querySelectorAll('td');
        return {
            name: cells[0].textContent.trim(),
            value: cells[1].textContent.trim(),
            domain: cells[2].textContent.trim(),
            path: cells[3].textContent.trim(),
            expires: cells[4].textContent.trim(),
            flags: Array.from(cells[5].querySelectorAll('.badge')).map(b => b.textContent.trim()),
        };
    })""")


def check_fields(r, context, ext_id):
    page = context.new_page()
    stub_active_tab(page, SITE)
    page.goto(popup_url(ext_id))
    page.wait_for_timeout(400)
    grant_host_permission(page)

    # A spread of shapes: secure, httpOnly, an explicit SameSite, a dated
    # cookie, a domain-wide one, and a value long enough to be truncated.
    page.evaluate("""async () => {
        const year = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 200;
        await chrome.cookies.set({url:'https://crosscheck.test/', name:'plain', value:'simple'});
        await chrome.cookies.set({url:'https://crosscheck.test/', name:'locked', value:'v',
            secure:true, httpOnly:true, sameSite:'strict'});
        await chrome.cookies.set({url:'https://crosscheck.test/', name:'dated', value:'v',
            expirationDate: year});
        await chrome.cookies.set({url:'https://crosscheck.test/', name:'wide', value:'v',
            domain:'.crosscheck.test'});
        await chrome.cookies.set({url:'https://crosscheck.test/deep', name:'scoped', value:'v',
            path:'/deep'});
    }""")
    page.reload()
    page.wait_for_timeout(1300)

    cdp = context.new_cdp_session(page)
    truth = {c["name"]: c for c in devtools_cookies(cdp) if HOST in c["domain"]}
    shown = {row["name"]: row for row in displayed_rows(page)}

    r.check("the popup shows exactly the cookies DevTools reports",
            set(shown) == set(truth),
            f"popup={sorted(shown)}, DevTools={sorted(truth)}")

    mismatches = []
    for name, row in shown.items():
        c = truth.get(name)
        if not c:
            continue
        if row["domain"] != c["domain"]:
            mismatches.append(f"{name}: domain {row['domain']!r} vs {c['domain']!r}")
        if row["path"] != c["path"]:
            mismatches.append(f"{name}: path {row['path']!r} vs {c['path']!r}")
        # DevTools reports -1 for a session cookie.
        is_session = c["expires"] == -1
        if is_session != (row["expires"] == "Session"):
            mismatches.append(f"{name}: expiry {row['expires']!r} vs expires={c['expires']}")
        if ("Secure" in row["flags"]) != c["secure"]:
            mismatches.append(f"{name}: Secure badge {('Secure' in row['flags'])} vs {c['secure']}")
        if ("HttpOnly" in row["flags"]) != c["httpOnly"]:
            mismatches.append(f"{name}: HttpOnly badge {('HttpOnly' in row['flags'])} vs {c['httpOnly']}")
    r.check("every displayed field matches DevTools", not mismatches, str(mismatches))

    # SameSite, which the popup abbreviates, so check the mapping explicitly.
    locked = truth.get("locked", {})
    r.check("the SameSite badge matches DevTools' value",
            "SS:Strict" in shown.get("locked", {}).get("flags", []) and locked.get("sameSite") == "Strict",
            f"badge={shown.get('locked', {}).get('flags')}, DevTools sameSite={locked.get('sameSite')!r}")

    # host-only vs domain-wide, the distinction the write path turns on.
    r.check("the HostOnly badge matches DevTools' leading-dot convention",
            "HostOnly" in shown.get("plain", {}).get("flags", [])
            and "HostOnly" not in shown.get("wide", {}).get("flags", [])
            and truth.get("wide", {}).get("domain", "").startswith("."),
            f"wide domain per DevTools = {truth.get('wide', {}).get('domain')!r}")

    page.close()


class LocalTLS:
    """
    A real HTTPS origin, served locally.

    Needed because Chrome only applies the Partitioned attribute over a
    genuine secure connection through the network stack. Two hostnames are
    mapped to this one server with --host-resolver-rules, which is what makes
    the iframe cross-site and therefore what makes the cookie partitioned.
    """

    PORT = 8443
    TOP_HOST = "top-site.test"
    EMBED_HOST = "embed-site.test"

    def __init__(self, cert_dir):
        self.cert = Path(cert_dir) / "crosscheck-cert.pem"
        self.key = Path(cert_dir) / "crosscheck-key.pem"
        self.server = None

    def certificate_available(self):
        """Make a throwaway self-signed cert. False if openssl isn't here."""
        self.cert.parent.mkdir(parents=True, exist_ok=True)
        if self.cert.exists() and self.key.exists():
            return True

        config = self.cert.parent / "san.cnf"
        config.write_text(
            "[req]\ndistinguished_name=dn\nx509_extensions=v3\nprompt=no\n"
            "[dn]\nCN=" + self.TOP_HOST + "\n"
            "[v3]\nsubjectAltName=DNS:" + self.TOP_HOST + ",DNS:" + self.EMBED_HOST + "\n"
            "basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\n"
            "extendedKeyUsage=serverAuth\n",
            encoding="utf-8",
        )
        try:
            subprocess.run(
                ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
                 "-keyout", str(self.key), "-out", str(self.cert),
                 "-days", "2", "-config", str(config)],
                check=True, capture_output=True,
            )
        except (OSError, subprocess.CalledProcessError):
            return False
        return True

    def start(self):
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                host = self.headers.get("Host", "").split(":")[0]
                if host == outer.EMBED_HOST:
                    # The cookie under test, plus an unpartitioned third-party
                    # cookie beside it so the two can be told apart.
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html")
                    self.send_header(
                        "Set-Cookie",
                        "chips_real=from_header; Secure; SameSite=None; Partitioned; Path=/")
                    self.send_header(
                        "Set-Cookie",
                        "plain_3p=from_header; Secure; SameSite=None; Path=/")
                    self.end_headers()
                    self.wfile.write(b"<!doctype html>embedded")
                else:
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html")
                    self.end_headers()
                    frame = ('<!doctype html><iframe src="https://'
                             + outer.EMBED_HOST + ":" + str(outer.PORT) + '/"></iframe>')
                    self.wfile.write(frame.encode())

        ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ssl_context.load_cert_chain(self.cert, self.key)
        self.server = ThreadingHTTPServer(("127.0.0.1", self.PORT), Handler)
        self.server.socket = ssl_context.wrap_socket(self.server.socket, server_side=True)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def stop(self):
        if self.server:
            self.server.shutdown()
            self.server.server_close()

    @property
    def chrome_args(self):
        return [
            "--host-resolver-rules=MAP " + self.TOP_HOST + " 127.0.0.1,"
            " MAP " + self.EMBED_HOST + " 127.0.0.1",
            "--ignore-certificate-errors",
        ]


def check_real_chips(r, playwright):
    """
    A partitioned cookie made the way the web makes them: a cross-site iframe
    over real TLS, returning a real Set-Cookie header with Partitioned.

    The first version of this served the pages through Playwright's request
    interception. Chrome stored the cookie but ignored the Partitioned
    attribute completely, because route fulfilment doesn't go through the
    path that applies partitioning. That was a harness artefact rather than a
    finding about Chrome, and telling those two apart is the whole point of
    this file, so it is worth a local server to get right.
    """
    server = LocalTLS(PROFILES / "certs")
    if not server.certificate_available():
        r.note("real-embed CHIPS check",
               "SKIPPED: openssl not available to make a test certificate")
        return

    server.start()
    try:
        context = launch(playwright, "crosscheck-tls", extra_args=server.chrome_args)
        ext_id = extension_id(context)

        page = context.new_page()
        page.goto("https://" + server.TOP_HOST + ":" + str(server.PORT) + "/")
        page.wait_for_timeout(2000)

        cdp = context.new_cdp_session(page)
        by_name = {c["name"]: c for c in devtools_cookies(cdp) if "site.test" in c["domain"]}

        chips = by_name.get("chips_real")
        plain = by_name.get("plain_3p")
        r.check("a real cross-site iframe set both cookies",
                bool(chips) and bool(plain), "found " + str(sorted(by_name)))
        if not chips:
            context.close()
            return

        r.check("DevTools reports the Partitioned one as partitioned, keyed to the top-level site",
                bool(chips.get("partitionKey")), json.dumps(chips.get("partitionKey")))
        r.check("and the one without the attribute as unpartitioned",
                not (plain or {}).get("partitionKey"),
                json.dumps((plain or {}).get("partitionKey")))

        # The assumption src/lib/cookies.js is built on, now against a cookie
        # the browser partitioned itself rather than one we declared.
        popup = context.new_page()
        stub_active_tab(popup, "https://" + server.EMBED_HOST + "/")
        popup.goto(popup_url(ext_id))
        popup.wait_for_timeout(400)
        grant_host_permission(popup)

        queries = popup.evaluate("""async (host) => ({
            plain: (await chrome.cookies.getAll({domain: host})).map(c => c.name).sort(),
            anyPartition: (await chrome.cookies.getAll({domain: host, partitionKey: {}}))
                .map(c => c.name).sort(),
        })""", server.EMBED_HOST)

        r.check("a plain getAll() misses the real partitioned cookie",
                queries["plain"] == ["plain_3p"], json.dumps(queries["plain"]))
        r.check("getAll({partitionKey:{}}) finds it, which is why cookies.js queries twice",
                queries["anyPartition"] == ["chips_real", "plain_3p"],
                json.dumps(queries["anyPartition"]))

        popup.reload()
        popup.wait_for_timeout(1300)
        shown = sorted(row["name"] for row in displayed_rows(popup))
        r.check("the popup lists the real partitioned cookie",
                shown == ["chips_real", "plain_3p"], str(shown))

        popup.locator('input[name="scope"][value="all"]').check()
        popup.wait_for_timeout(1000)
        popup.locator("#delete-button").click()
        popup.wait_for_timeout(300)
        popup.locator("#confirm-yes").click()
        popup.wait_for_timeout(1500)

        left = [c["name"] for c in devtools_cookies(cdp) if "site.test" in c["domain"]]
        r.check("'All sites' removes it, confirmed by DevTools rather than by the extension",
                not left, "still present: " + str(left))

        context.close()
    finally:
        server.stop()


def check_network(r, context, ext_id):
    """
    Outbound requests as the Network panel would see them.

    Network.requestWillBeSent is what DevTools' Network tab listens to, so
    this is the same observation as leaving that tab open for a session --
    rather than trusting Playwright's higher-level request event, which is
    what the existing no-network test uses.
    """
    page = context.new_page()
    stub_active_tab(page, SITE)

    cdp = context.new_cdp_session(page)
    seen = []
    cdp.on("Network.requestWillBeSent", lambda e: seen.append(e["request"]["url"]))
    cdp.send("Network.enable")

    page.goto(popup_url(ext_id))
    page.wait_for_timeout(400)
    grant_host_permission(page)
    page.evaluate(
        "async () => { await chrome.cookies.set({url:'https://crosscheck.test/', name:'n', value:'1'}); }"
    )
    page.reload()
    page.wait_for_timeout(1200)

    # Exercise the paths most likely to reach out, if anything ever did.
    page.locator("#add-button").click()
    page.wait_for_timeout(300)
    page.fill("#field-name", "made_here")
    page.fill("#field-value", "v")
    page.locator("#edit-save").click()
    page.wait_for_timeout(900)
    page.fill("#search-input", "made")
    page.wait_for_timeout(600)
    page.locator('input[name="scope"][value="all"]').check()
    page.wait_for_timeout(900)

    outbound = [u for u in seen if u.startswith(("http://", "https://"))]
    r.check("DevTools' Network view shows no outbound requests from the popup",
            not outbound,
            f"{len(seen)} requests total, all chrome-extension://" if not outbound else str(outbound))

    page.close()


def main():
    r = Results("DevTools cross-check")

    with sync_playwright() as p:
        context = launch(p, "crosscheck")
        ext_id = extension_id(context)

        check_fields(r, context, ext_id)
        check_network(r, context, ext_id)
        context.close()

        # Its own browser: it needs the hostname-mapping and certificate
        # flags, which the other checks must not have.
        check_real_chips(r, p)

    return r.summarise()


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
