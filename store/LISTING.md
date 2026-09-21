# Chrome Web Store listing copy

Everything here is ready to paste into the Developer Dashboard. Field names
match the dashboard's own labels. Character limits are noted where the store
enforces one.

See `README.md` in this folder for what still has to be produced (screenshots)
and the one wording decision worth making deliberately before submitting.

---

## Name

*Limit: 75 characters. Roughly the first 45 show in search results.*

```
Cookie Manager: view, edit and delete cookies
```

## Summary

*Limit: 132 characters. Shown under the name in search results.*

```
View, create, edit and delete cookies. Deletes all of them, not just some. No ads, no tracking, no network requests.
```

## Category

Developer Tools

## Language

English (United Kingdom)

---

## Description

*Limit: 16,000 characters. Plain text, since the store strips most formatting, so
this is written to read well without it.*

```
A cookie manager that does what it says, for developers, testers and anyone
who wants to see what sites are storing on their machine.

WHAT IT DOES

• Lists every cookie for the site you're on, with domain, path, expiry and
  flags: Secure, HttpOnly, HostOnly, SameSite and partitioned (CHIPS).

• Deletes cookies at three scopes: this page, this domain and its subdomains,
  or every site in your browser profile. Before anything is removed you see
  the exact count and the exact list of domains affected.

• Creates and edits cookies: name, value, domain, path, expiry, Secure,
  HttpOnly and SameSite.

• Searches by name, value, domain or path. While a search is active you get a
  "just the cookies shown" delete scope, so filtering and then deleting
  removes what's actually on screen.

• Lets you mark cookies as Kept, so they're excluded from deletes. Useful for
  the login you don't want to lose while clearing everything else.

• Works in incognito, with incognito cookies kept properly separate from your
  normal browsing.


DELETE ALL ACTUALLY MEANS ALL

The common complaint about cookie managers is that "delete all" quietly
doesn't. It clears the current domain and leaves the rest, or it misses
partitioned cookies, and you only find out later when you're still logged in
somewhere you meant to clear.

This one shows you the number and the domains before it acts, and the number
it shows is taken from the same query that does the deleting, so what it
says and what it does cannot drift apart. Partitioned (CHIPS) cookies are
included, which is the case most often missed.


NO NETWORK REQUESTS. NONE.

This extension makes no network requests of any kind. Not analytics, not
error reporting, not update checks, not web fonts or CDN loads. It has no
server component. Nothing you do in it leaves your computer.

That means:
• No tracking or telemetry of any kind
• No ads, no affiliate links, no injected content
• No remote code
• Nothing sold, shared or transferred to anyone

You don't have to take that on trust. Open DevTools, watch the Network tab,
and use the extension. You'll see nothing leave. The source is plain
JavaScript, HTML and CSS with no build step, no bundler, no minification and
no dependencies, so what's published is exactly what was written, and you can
read all of it.


MINIMAL PERMISSIONS

The install prompt asks for two things: access to cookies, and local storage
to remember which cookies you've marked as Kept.

Access to websites is requested separately, at runtime, the first time you
open the popup, not at install. Chrome won't release a single cookie to an
extension without it, so a cookie manager genuinely needs it, but it's kept
out of the install prompt so you can see exactly what you're agreeing to and
when. You can decline it, and revoke it later.

Nothing else is requested.


OPEN SOURCE

Full source, including the automated tests:
https://github.com/mwc0/cookie-manager

The tests cover the things that fail silently: a "delete all" that leaves
cookies behind, a host-only cookie that quietly becomes domain-wide, a
session cookie that silently becomes permanent. They also check that the
extension makes no outbound requests.

This is free, with no ads and no paid upgrade required to use any of the
above.
```

---

## Single purpose description

*Required. The store asks you to state the extension's single purpose.*

```
Cookie Manager lets the user view, create, edit and delete the cookies stored
in their own browser. Every feature serves that one purpose: listing cookies
for the current site, editing their fields, deleting them at a chosen scope,
searching within them, and marking individual cookies to be excluded from
deletion.
```

---

## Permission justifications

*Required. The store asks for a justification per permission, and these are
read by a human reviewer. Keep them specific, because vague justifications are a
common cause of review delays.*

### `cookies`

```
This is a cookie manager; the cookies permission is what the extension is
for. It is used to read the cookies for the site in the active tab so they
can be displayed, and to create, modify and delete cookies at the user's
explicit request. There is no feature that does not depend on it.
```

### `storage`

```
Used to store one thing locally: the list of cookies the user has marked as
"Kept", so the extension remembers to exclude them from deletion after the
popup closes. Each entry holds a cookie's name, domain and path, plus its
partition key for partitioned (CHIPS) cookies. It never holds cookie values.
Stored via chrome.storage.local; nothing is synced or transmitted.
```

### Host permission (`*://*/*`, optional)

```
Chrome does not return any cookie to an extension without host permission for
the site that cookie belongs to, so a general-purpose cookie manager requires
broad host access to function at all. It is declared under
optional_host_permissions rather than permissions, so it is not part of the
install prompt: it is requested at runtime the first time the user opens the
popup, and can be declined or revoked. It is used only to read and modify
cookies in response to the user opening the popup and acting on it. No page
content is read, no scripts are injected, and no data is transmitted.
```

### Remote code

```
No remote code is used. All code executes from within the extension package.
The source is unminified and unbundled.
```

---

## Data usage disclosures

*The dashboard asks you to tick what you collect. The honest answers:*

| Question | Answer |
| --- | --- |
| Personally identifiable information | No |
| Health information | No |
| Financial and payment information | No |
| Authentication information | **No**, see the note below |
| Personal communications | No |
| Location | No |
| Web history | No |
| User activity | No |
| Website content | No |

**The note on authentication information.** The extension displays session
cookies, which are authentication-related, and a reviewer may reasonably
query this. The disclosure question asks what you *collect*, meaning
transmit off the user's device, and the answer is nothing. The cookies are
read and shown on screen, never gathered, stored or sent. If the dashboard
wording ever makes this ambiguous, say exactly that in the notes field rather
than ticking a box that implies transmission.

Then tick all three certifications:

- I do not sell or transfer user data to third parties, outside of the
  approved use cases
- I do not use or transfer user data for purposes that are unrelated to my
  item's single purpose
- I do not use or transfer user data to determine creditworthiness or for
  lending purposes

All three are true.

---

## Privacy policy URL

The store requires a URL, not a file. The policy is in `store/PRIVACY.md`, and
the simplest honest option is to point at it on GitHub:

```
https://github.com/mwc0/cookie-manager/blob/main/store/PRIVACY.md
```

That needs no hosting and updates when the repo does. If you'd rather have a
plain page, GitHub Pages on this repo would also work.
