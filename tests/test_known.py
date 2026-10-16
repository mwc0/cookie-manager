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
