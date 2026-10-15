"""
Site rules: which sites may set cookies.

cookieZ doesn't do the blocking. It gives Chrome a rule and Chrome follows
it. So the risk isn't in the popup's own code, it's in whether the rule
handed over means what the screen said. A choice labelled "Block other
companies' cookies" that quietly blocked the site's own would sign people
out, and one that blocked nothing would be a promise not kept.

That's why every check here loads a real page in a real browser and reads
what Chrome stored, through DevTools, the same as looking in the
Application panel. The page is served by a local HTTPS server under two
hostnames, so one site can embed the other:

    top-site.test    sets top_header (a header) and top_js (a script),
                     and embeds a frame from embed-site.test
    embed-site.test  in the frame, sets embed_3p and embed_chips (headers,
                     the second one partitioned) and embed_3pjs (a script)

So "everything" on top-site.test is five cookies, two of its own and three
from the other company.

What this file can't check: Chrome's permission prompt, incognito, and
whether the rules are still there after Chrome restarts. A test-loaded
extension is installed afresh on every launch, so Chrome forgets its rules
each time, which a real install doesn't. Those are checked by hand.
"""

import json
import ssl
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright

from helpers import (
    EXTENSION,
    PROFILES,
    Results,
    extension_id,
    grant_host_permission,
    launch,
    popup_url,
    stub_active_tab,
    visible_state,
)
from test_devtools_crosscheck import LocalTLS

OWN = ["top_header", "top_js"]
EVERYTHING = ["embed_3p", "embed_3pjs", "embed_chips", "top_header", "top_js"]


class TwoSites(LocalTLS):
    """The two-hostname HTTPS server, with pages that set every kind of cookie."""

    PORT = 8444

    def start(self):
        outer = self
        names = {self.TOP_HOST: "top", self.EMBED_HOST: "embed"}
        other = {self.TOP_HOST: self.EMBED_HOST, self.EMBED_HOST: self.TOP_HOST}

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                host = self.headers.get("Host", "").split(":")[0]
                me = names.get(host, "x")
                self.send_response(200)
                self.send_header("Content-Type", "text/html")
                if self.path.startswith("/frame"):
                    self.send_header("Set-Cookie", me + "_3p=1; Secure; SameSite=None; Path=/")
                    self.send_header(
                        "Set-Cookie", me + "_chips=1; Secure; SameSite=None; Partitioned; Path=/")
                    self.end_headers()
                    body = ("<!doctype html><script>document.cookie='" + me
                            + "_3pjs=1; Secure; SameSite=None; Path=/'</script>frame")
                else:
                    self.send_header("Set-Cookie", me + "_header=1; Secure; Path=/")
                    self.end_headers()
                    body = ("<!doctype html><script>document.cookie='" + me
                            + "_js=1; Secure; Path=/'</script><iframe src='https://"
                            + other.get(host, outer.TOP_HOST) + ":" + str(outer.PORT)
                            + "/frame'></iframe>")
                self.wfile.write(body.encode())

        ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ssl_context.load_cert_chain(self.cert, self.key)
        self.server = ThreadingHTTPServer(("127.0.0.1", self.PORT), Handler)
        self.server.socket = ssl_context.wrap_socket(self.server.socket, server_side=True)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def url(self, host):
        return "https://" + host + ":" + str(self.PORT) + "/"


def stored_names(context, page):
    """The test sites' cookies, as DevTools reports them."""
    cdp = context.new_cdp_session(page)
    names = sorted(c["name"] for c in cdp.send("Storage.getCookies")["cookies"]
                   if "site.test" in c["domain"])
    cdp.detach()
    return names


def visit(context, page, url, clear=True):
    """Loads a site, from no cookies unless told otherwise, and returns what Chrome kept."""
    if clear:
        cdp = context.new_cdp_session(page)
        cdp.send("Network.clearBrowserCookies")
        cdp.detach()
    page.goto(url)
    page.wait_for_timeout(1600)
    return stored_names(context, page)


def saved(page):
    return page.evaluate("async () => (await chrome.storage.local.get('siteRules')).siteRules || null")


def listed(page):
    return page.evaluate("""() => [...document.querySelectorAll('#rules-rows tr')].map(row => [
        row.querySelector('.rules-site').textContent,
        row.querySelector('.rules-rule').textContent,
    ])""")


def checked(page, name):
    return page.evaluate(
        "(name) => { const r = document.querySelector('input[name=\"' + name + '\"]:checked');"
        " return r ? r.value : null; }", name)


def choose(page, name, value):
    page.locator('input[name="' + name + '"][value="' + value + '"]').check()
    page.wait_for_timeout(700)


def message(page):
    line = page.locator("#rules-message")
    return line.text_content().strip() if line.is_visible() else ""


def label(page):
    return page.locator("#rules-open-label").text_content().strip()


def lit(page):
    return "on" in (page.locator("#rules-open").get_attribute("class") or "").split()


def expiries(context, page):
    """Each test-site cookie's expiry as DevTools reports it; -1 is a session cookie."""
    cdp = context.new_cdp_session(page)
    found = {c["name"]: c["expires"] for c in cdp.send("Storage.getCookies")["cookies"] if "site.test" in c["domain"]}
    cdp.detach()
    return found


def open_rules(page):
    page.locator("#rules-open").click()
    page.wait_for_timeout(500)


def back(page):
    page.locator("#rules-back").click()
    page.wait_for_timeout(900)


def new_popup(context, ext_id, site_url, before=None):
    page = context.new_page()
    if before:
        page.add_init_script(before)
    stub_active_tab(page, site_url)
    page.goto(popup_url(ext_id))
    page.wait_for_timeout(400)
    grant_host_permission(page)
    page.reload()
    page.wait_for_timeout(1100)
    return page


# Makes the popup believe the rules permission hasn't been given, and that
# the user says no when asked. Host access is left as it is.
NO_RULES_PERMISSION = """
(() => {
    const wantsRules = (query) => Boolean(query && query.permissions && query.permissions.includes('contentSettings'));
    const realContains = chrome.permissions.contains.bind(chrome.permissions);
    const realRequest = chrome.permissions.request.bind(chrome.permissions);
    chrome.permissions.contains = (query, callback) => {
        if (!wantsRules(query)) { return realContains(query, callback); }
        if (callback) { callback(false); return; }
        return Promise.resolve(false);
    };
    chrome.permissions.request = (query, callback) => {
        if (!wantsRules(query)) { return realRequest(query, callback); }
        if (callback) { callback(false); return; }
        return Promise.resolve(false);
    };
})();
"""


def check_manifest(r):
    manifest = json.loads((EXTENSION / "manifest.json").read_text(encoding="utf-8"))
    r.check("the real manifest still asks for only cookies and storage at install",
            manifest.get("permissions") == ["cookies", "storage"], str(manifest.get("permissions")))
    r.check("the permissions for rules, every-site blocking and site data are optional",
            manifest.get("optional_permissions") == ["contentSettings", "privacy", "browsingData"],
            str(manifest.get("optional_permissions")))
    r.check("there is still no background script", "background" not in manifest, str(sorted(manifest)))


def check_translation(r, page):
    """The saved rules turned into Chrome's rules, without touching Chrome."""
    out = page.evaluate("""async () => {
        const m = await import(chrome.runtime.getURL('lib/rules.js'));
        const show = (rules) => m.chromeRulesFor(rules)
            .map(x => [x.primaryPattern, x.secondaryPattern || '', x.setting].join(' | '));
        return {
            none: show({ everywhere: 'allow', sites: {} }),
            own: show({ everywhere: 'allow', sites: { 'example.com': 'own-only' } }),
            block: show({ everywhere: 'allow', sites: { 'example.com': 'block' } }),
            list: show({ everywhere: 'block', sites: { 'example.com': 'allow' } }),
            address: m.patternFor('127.0.0.1'),
            name: m.patternFor('example.com'),
            parent: m.siteFor({ everywhere: 'allow', sites: { 'example.com': 'block' } }, 'shop.example.com'),
            alone: m.siteFor({ everywhere: 'allow', sites: {} }, 'www.example.com'),
            inherited: m.ruleFor({ everywhere: 'allow', sites: { 'example.com': 'block' } }, 'shop.example.com'),
            unrelated: m.ruleFor({ everywhere: 'allow', sites: { 'example.com': 'block' } }, 'notexample.com'),
        };
    }""")
    site = "*://*.example.com/*"
    r.check("no rules means nothing is handed to Chrome", out["none"] == [], str(out["none"]))
    r.check("'own-only' blocks everyone on the site's pages, then allows the site itself",
            out["own"] == ["<all_urls> | " + site + " | block", site + " | " + site + " | allow"],
            str(out["own"]))
    r.check("'block' blocks the site's pages, and the site's cookies anywhere else",
            out["block"] == ["<all_urls> | " + site + " | block", site + " |  | block"], str(out["block"]))
    r.check("an allowed list is 'block everywhere' plus an allow for each listed site",
            out["list"] == ["<all_urls> |  | block", "<all_urls> | " + site + " | allow"], str(out["list"]))
    r.check("a site's pattern covers its subdomains; an IP address has none",
            out["name"] == site and out["address"] == "*://127.0.0.1/*",
            out["name"] + " and " + out["address"])
    r.check("a subdomain uses the rule set for the site above it",
            out["parent"] == "example.com" and out["inherited"] == "block",
            out["parent"] + ", " + out["inherited"])
    r.check("www. is the same site, and a look-alike name isn't covered",
            out["alone"] == "example.com" and out["unrelated"] == "allow",
            out["alone"] + ", " + out["unrelated"])


def check_rules(r, context, ext_id, server):
    top = server.url(server.TOP_HOST)
    embed = server.url(server.EMBED_HOST)
    host = server.TOP_HOST

    site = context.new_page()
    page = new_popup(context, ext_id, top)

    r.check("with no rules, the button in the header just says 'Block', and isn't lit",
            label(page) == "Block" and not lit(page), label(page))
    r.check("and the site gets all five cookies", visit(context, site, top) == EVERYTHING,
            str(stored_names(context, site)))

    open_rules(page)
    r.check("the link opens the rules screen", visible_state(page) == "state-rules", str(visible_state(page)))
    r.check("with the permission given, the choices are shown and the request isn't",
            page.locator("#rules-body").is_visible() and not page.locator("#rules-gate").is_visible())
    r.check("it names the site, and starts on 'Allow all cookies'",
            page.locator("#rules-site-name").text_content() == host and checked(page, "site-rule") == "allow",
            page.locator("#rules-site-name").text_content() + ", " + str(checked(page, "site-rule")))
    r.check("nothing is saved until a choice is made", saved(page) is None, json.dumps(saved(page)))

    # --- block other companies' cookies ---
    choose(page, "site-rule", "own-only")
    r.check("choosing 'Block other companies' cookies' says what it did",
            message(page) == "Other companies' cookies are now blocked on " + host + ".", message(page))
    r.check("only the site's name and the rule are saved",
            saved(page) == {"everywhere": "allow", "sites": {host: "own-only"}, "deleteOnBlock": False}, json.dumps(saved(page)))
    r.check("TRAP: the site keeps its own cookies and the other company's are gone, partitioned one included",
            visit(context, site, top) == OWN, str(stored_names(context, site)))
    r.check("the rule is for that site only: the other site still gets everything",
            len(visit(context, site, embed)) == 5, str(stored_names(context, site)))
    r.check("the site is listed with its rule",
            listed(page) == [[host, "Block other companies' cookies"]], str(listed(page)))

    back(page)
    r.check("back on the table, the button says what the rule is doing, and is lit",
            label(page) == "Blocking others" and lit(page), label(page))

    # --- block all, with cookies already there ---
    open_rules(page)
    choose(page, "site-rule", "allow")
    r.check("choosing what every other site already gets removes the site's own rule",
            saved(page) == {"everywhere": "allow", "sites": {}, "deleteOnBlock": False} and listed(page) == [],
            json.dumps(saved(page)))
    visit(context, site, top)
    page.evaluate("async (key) => { await chrome.storage.local.set({ protectedCookies: [key] }); }",
                  host + "\n/\ntop_js\n")

    choose(page, "site-rule", "block")
    offer = page.locator("#rules-cleanup-text")
    r.check("blocking a site that already has cookies offers to delete them, kept ones left out",
            offer.is_visible()
            and offer.text_content() == "It still has 1 cookie saved. 1 kept cookie will be left alone.",
            offer.text_content())
    r.check("blocking doesn't delete anything by itself",
            stored_names(context, site) == EVERYTHING, str(stored_names(context, site)))

    page.locator("#rules-cleanup-yes").click()
    page.wait_for_timeout(900)
    left = stored_names(context, site)
    r.check("TRAP: 'Delete them' removes exactly the cookie counted, and the kept one stays",
            "top_header" not in left and "top_js" in left, str(left))
    r.check("it says so, with Undo", message(page).startswith("Deleted 1 cookie.")
            and page.locator("#rules-message .undo-button").is_visible(), message(page))
    page.locator("#rules-message .undo-button").click()
    page.wait_for_timeout(900)
    r.check("Undo puts it back, even though the site is blocked",
            "top_header" in stored_names(context, site), str(stored_names(context, site)))

    page.evaluate("async () => { await chrome.storage.local.remove('protectedCookies'); }")
    r.check("TRAP: with 'Block all cookies', the site gets no cookies at all",
            visit(context, site, top) == [], str(stored_names(context, site)))
    r.check("and its cookies are blocked on other sites' pages too",
            visit(context, site, embed) == ["embed_header", "embed_js"], str(stored_names(context, site)))

    back(page)
    r.check("the button says 'Blocked'", label(page) == "Blocked" and lit(page), label(page))
    r.check("the empty table says the rules are why",
            page.locator("#empty-message").text_content().strip()
            == "No cookies are set for this site. Your site rules are blocking them.",
            page.locator("#empty-message").text_content().strip())
    page.locator("#add-button").click()
    page.wait_for_timeout(300)
    r.check("the editor warns that the site won't be able to read a cookie saved here",
            page.locator("#edit-rule-note").is_visible())
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)

    # --- removing a rule ---
    open_rules(page)
    page.locator("#rules-rows .rules-remove").first.click()
    page.wait_for_timeout(700)
    r.check("Remove takes the site off the list and says so",
            listed(page) == [] and message(page) == "Removed the rule for " + host + ".", message(page))
    r.check("and the site gets everything again", visit(context, site, top) == EVERYTHING,
            str(stored_names(context, site)))

    # --- every other site, and the allowed list ---
    # click(), not check(): the choice is put back until the answer, and
    # check() fails when a radio button doesn't stay ticked.
    page.locator('input[name="everywhere-rule"][value="block"]').click()
    page.wait_for_timeout(400)
    r.check("'Block all cookies' for every other site asks first, and changes nothing yet",
            page.locator("#rules-everywhere-confirm").is_visible()
            and checked(page, "everywhere-rule") == "allow" and saved(page)["everywhere"] == "allow",
            str(checked(page, "everywhere-rule")))
    page.locator("#rules-everywhere-no").click()
    page.wait_for_timeout(300)
    r.check("Cancel leaves it alone", not page.locator("#rules-everywhere-confirm").is_visible()
            and visit(context, site, top) == EVERYTHING)

    page.locator('input[name="everywhere-rule"][value="block"]').click()
    page.wait_for_timeout(300)
    page.locator("#rules-everywhere-yes").click()
    page.wait_for_timeout(800)
    r.check("after saying yes, it's saved and this site's own choice follows it",
            saved(page) == {"everywhere": "block", "sites": {}, "deleteOnBlock": False} and checked(page, "site-rule") == "block",
            json.dumps(saved(page)))
    r.check("TRAP: every site is blocked",
            visit(context, site, top) == [] and visit(context, site, embed) == [],
            str(stored_names(context, site)))

    choose(page, "site-rule", "allow")
    r.check("allowing this site puts it on the list",
            listed(page) == [[host, "Allow all cookies"]], str(listed(page)))
    r.check("TRAP: the allowed site works in full, and the other site is still blocked",
            visit(context, site, top) == EVERYTHING and visit(context, site, embed) == [],
            str(stored_names(context, site)))

    choose(page, "site-rule", "own-only")
    r.check("on the allowed list, 'Block other companies' cookies' still keeps only the site's own",
            visit(context, site, top) == OWN, str(stored_names(context, site)))

    # --- Chrome loses the rules ---
    page.evaluate("async () => { await chrome.contentSettings.cookies.clear({}); }")
    r.check("(with Chrome's copy wiped behind cookieZ's back, nothing is blocked)",
            visit(context, site, top) == EVERYTHING, str(stored_names(context, site)))
    page.reload()
    page.wait_for_timeout(1300)
    note = page.locator("#main-message")
    r.check("TRAP: the next time cookieZ opens it notices, and says it has set them again",
            note.is_visible() and "set them again" in note.text_content(), note.text_content())
    r.check("and they are back in force", visit(context, site, top) == OWN, str(stored_names(context, site)))

    # --- a subdomain of a site with a rule ---
    sub = new_popup(context, ext_id, "https://shop." + host + "/")
    open_rules(sub)
    r.check("on a subdomain, the rule shown is the one for the site above it",
            sub.locator("#rules-site-name").text_content() == host
            and checked(sub, "site-rule") == "own-only"
            and sub.locator("#rules-site-note").text_content()
            == "This rule was set for " + host + ", which covers shop." + host + " too.",
            sub.locator("#rules-site-note").text_content())
    sub.close()

    nested = page.evaluate("""async () => {
        const m = await import(chrome.runtime.getURL('lib/rules.js'));
        await m.setSiteRule('shop.nested.test', 'own-only');
        const result = await m.setSiteRule('nested.test', 'own-only');
        return Object.keys(result.rules.sites).filter(site => site.includes('nested'));
    }""")
    r.check("a rule for a site replaces any for its subdomains, so two can't pull against each other",
            nested == ["nested.test"], str(nested))

    # --- turning everything off ---
    page.reload()
    page.wait_for_timeout(1100)
    open_rules(page)
    page.locator("#rules-clear").click()
    page.wait_for_timeout(300)
    r.check("'Turn off all rules' asks first",
            page.locator("#rules-confirm").is_visible() and saved(page)["everywhere"] == "block")
    page.keyboard.press("Tab")
    page.locator("#rules-confirm-yes").click()
    page.wait_for_timeout(800)
    r.check("then nothing is saved but an empty list, and the button goes",
            saved(page) == {"everywhere": "allow", "sites": {}, "deleteOnBlock": False} and listed(page) == []
            and not page.locator("#rules-clear").is_visible(), json.dumps(saved(page)))
    r.check("TRAP: and Chrome is allowing everything again",
            visit(context, site, top) == EVERYTHING and len(visit(context, site, embed)) == 5,
            str(stored_names(context, site)))

    page.keyboard.press("Escape")
    page.wait_for_timeout(700)
    r.check("Esc goes back to the table", visible_state(page) == "state-main", str(visible_state(page)))

    page.close()
    site.close()


def check_new_choices(r, context, ext_id, server):
    """1.7: clearing on close, other companies' cookies everywhere, deleting
    when blocking, cookie counts, and a copy of the rules."""
    top = server.url(server.TOP_HOST)
    embed = server.url(server.EMBED_HOST)
    host = server.TOP_HOST
    site = context.new_page()
    page = new_popup(context, ext_id, top)
    open_rules(page)

    # --- clear when Chrome closes ---
    choose(page, "site-rule", "session")
    r.check("'Clear when Chrome closes' says what it does",
            message(page) == "Chrome will delete " + host + "'s cookies every time it closes.", message(page))
    visit(context, site, top)
    times = expiries(context, site)
    r.check("TRAP: the site still gets its cookies, but every one is a session cookie",
            sorted(times) == EVERYTHING and all(t == -1 for t in times.values()), str(times))
    back(page)
    r.check("the button says 'Clears on close'", label(page) == "Clears on close" and lit(page), label(page))
    open_rules(page)
    page.locator("#rules-rows .rules-remove").first.click()
    page.wait_for_timeout(700)

    # --- other companies' cookies, everywhere ---
    choose(page, "everywhere-rule", "own-only")
    r.check("'Block other companies' cookies' for every site is saved and says so",
            saved(page)["everywhere"] == "own-only" and "every site" in message(page), message(page))
    status = page.evaluate("() => new Promise(r => chrome.privacy.websites.thirdPartyCookiesAllowed.get({}, r))")
    r.check("it turns on Chrome's own switch, and cookieZ is the one controlling it",
            status["value"] is False and status["levelOfControl"] == "controlled_by_this_extension", str(status))
    r.check("TRAP: on every site, other companies' cookies are gone and the site's own stay (partitioned ones are Chrome's exception)",
            visit(context, site, top) == ["embed_chips", "top_header", "top_js"]
            and visit(context, site, embed) == ["embed_header", "embed_js", "top_chips"],
            str(stored_names(context, site)))
    choose(page, "site-rule", "allow")
    r.check("TRAP: a site set to 'Allow all cookies' still gets everything",
            visit(context, site, top) == EVERYTHING, str(stored_names(context, site)))
    back(page)
    other = new_popup(context, ext_id, embed)
    r.check("on a site without its own rule, the button says 'Blocking others'",
            label(other) == "Blocking others" and lit(other), label(other))
    other.close()

    # --- delete when blocking, and the count column ---
    open_rules(page)
    visit(context, site, top)
    page.locator("#rules-delete-on-block").check()
    page.wait_for_timeout(500)
    r.check("'delete without asking' is saved", saved(page)["deleteOnBlock"] is True, json.dumps(saved(page)))
    r.check("the list shows how many cookies a listed site has now",
            page.locator("#rules-rows td.rules-count").first.text_content() == "2",
            page.locator("#rules-rows td.rules-count").first.text_content())
    choose(page, "site-rule", "block")
    page.wait_for_timeout(600)
    left = stored_names(context, site)
    r.check("TRAP: blocking now deletes the site's cookies straight away, and says so with Undo",
            "top_header" not in left and "top_js" not in left
            and "Deleted 2 cookies." in message(page)
            and page.locator("#rules-message .undo-button").is_visible()
            and not page.locator("#rules-cleanup").is_visible(), message(page) + " | " + str(left))

    # --- a copy of the rules ---
    backup = page.evaluate("""async () => {
        const m = await import(chrome.runtime.getURL('lib/rules.js'));
        return m.rulesToBackup((await m.loadRules()).rules);
    }""")
    data = json.loads(backup)
    r.check("the copy holds the rules and nothing else",
            data == {"kind": "cookieZ site rules", "version": 1, "everywhere": "own-only",
                     "deleteOnBlock": True, "sites": {host: "block"}}, backup)
    path = PROFILES / "rules-backup.json"
    path.write_text(backup, encoding="utf-8")
    page.evaluate("async () => { const m = await import(chrome.runtime.getURL('lib/rules.js')); await m.clearRules(); }")
    page.reload()
    page.wait_for_timeout(1100)
    open_rules(page)
    page.locator("#rules-load").set_input_files(str(path))
    page.wait_for_timeout(600)
    r.check("loading a copy asks before replacing anything",
            page.locator("#rules-load-confirm").is_visible()
            and page.locator("#rules-load-text").text_content() == "Replace your rules with the 1 site in this file?",
            page.locator("#rules-load-text").text_content())
    page.locator("#rules-load-yes").click()
    page.wait_for_timeout(900)
    r.check("then the rules are back, and Chrome is following them",
            saved(page) == {"everywhere": "own-only", "sites": {host: "block"}, "deleteOnBlock": True}
            and visit(context, site, top) == [], json.dumps(saved(page)))
    path.write_text('{"something": "else"}', encoding="utf-8")
    page.locator("#rules-load").set_input_files(str(path))
    page.wait_for_timeout(500)
    r.check("a file that isn't a cookieZ copy is refused, and nothing changes",
            "isn't a cookieZ rules backup" in message(page) and not page.locator("#rules-load-confirm").is_visible()
            and saved(page)["sites"] == {host: "block"}, message(page))

    # --- back to how it was ---
    page.locator("#rules-clear").click()
    page.wait_for_timeout(300)
    page.locator("#rules-confirm-yes").click()
    page.wait_for_timeout(800)
    status = page.evaluate("() => new Promise(r => chrome.privacy.websites.thirdPartyCookiesAllowed.get({}, r))")
    r.check("TRAP: turning everything off hands Chrome's own switch back",
            status["value"] is True and status["levelOfControl"] != "controlled_by_this_extension"
            and visit(context, site, top) == EVERYTHING, str(status))
    page.evaluate("async () => { await chrome.storage.local.remove('siteRules'); }")
    page.close()
    site.close()


# Makes the popup believe the "privacy" permission hasn't been given, and
# that the user says no when asked.
NO_PRIVACY_PERMISSION = NO_RULES_PERMISSION.replace("'contentSettings'", "'privacy'")


def check_privacy_declined(r, context, ext_id, server):
    page = new_popup(context, ext_id, server.url(server.TOP_HOST), before=NO_PRIVACY_PERMISSION)
    open_rules(page)
    page.locator('input[name="everywhere-rule"][value="own-only"]').click()
    page.wait_for_timeout(600)
    r.check("saying no to the extra permission leaves 'every other site' as it was",
            checked(page, "everywhere-rule") == "allow" and "didn't give permission" in message(page)
            and (saved(page) or {}).get("everywhere", "allow") == "allow", message(page))
    page.close()


def check_without_permission(r, context, ext_id, server):
    """Before the permission is given, and when the user says no."""
    top = server.url(server.TOP_HOST)
    host = server.TOP_HOST
    page = new_popup(context, ext_id, top, before=NO_RULES_PERMISSION)

    open_rules(page)
    r.check("without the permission, the screen explains and asks; no choices are shown",
            page.locator("#rules-gate").is_visible() and not page.locator("#rules-body").is_visible()
            and not page.locator("#rules-gate-saved").is_visible())
    before = saved(page)
    page.locator("#rules-grant").click()
    page.wait_for_timeout(500)
    r.check("saying no changes nothing and says the rest still works",
            "nothing has changed" in message(page) and saved(page) == before, message(page))
    back(page)
    r.check("and the table still works", visible_state(page) == "state-main"
            and label(page) == "Block")

    # Rules saved earlier, then the permission taken away.
    page.evaluate("async (host) => { await chrome.storage.local.set({ siteRules:"
                  " { everywhere: 'allow', sites: { [host]: 'block' } } }); }", host)
    page.reload()
    page.wait_for_timeout(1100)
    r.check("TRAP: with saved rules but no permission, the button doesn't claim to be blocking",
            label(page) == "Block" and not lit(page), label(page))
    open_rules(page)
    r.check("the saved rules are shown, greyed, with a line saying Chrome isn't following them",
            page.locator("#rules-gate-saved").is_visible() and listed(page) == [[host, "Block all cookies"]]
            and page.locator('input[name="site-rule"][value="allow"]').is_disabled()
            and page.locator("#rules-rows .rules-remove").first.is_disabled(), str(listed(page)))

    page.evaluate("async () => { await chrome.storage.local.remove('siteRules'); }")
    page.close()


def main():
    r = Results("Site rules")
    check_manifest(r)

    server = TwoSites(PROFILES / "certs")
    if not server.certificate_available():
        r.check("openssl is available to make a test certificate", False,
                "these checks need a real HTTPS server; install openssl and run again")
        return r.summarise()

    server.start()
    try:
        with sync_playwright() as p:
            context = launch(p, "rules", extra_args=server.chrome_args)
            ext_id = extension_id(context)

            first = new_popup(context, ext_id, server.url(server.TOP_HOST))
            errors = []
            first.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            check_translation(r, first)
            first.close()

            check_rules(r, context, ext_id, server)
            check_new_choices(r, context, ext_id, server)
            check_privacy_declined(r, context, ext_id, server)
            check_without_permission(r, context, ext_id, server)
            r.check("no errors were logged", not errors, str(errors))
            context.close()
    finally:
        server.stop()

    return r.summarise()


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
