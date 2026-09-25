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
cookieZ - Cookie Editor
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

*Limit: 16,000 characters. Plain text, since the store strips most formatting.
Written in the same plain style as the better-rated listings in this category
(Cookie-Editor, Dark Reader, uBlock Origin Lite): a one-line summary, a short
intro, a plain feature list, a warning, and where to get help.*

```
View, edit and delete the cookies on any website. When you delete everything, it actually deletes everything.

cookieZ is a cookie editor for Chrome. It's useful if you build or test websites, or if a site won't let you log in and you've been told to clear its cookies.

Before you delete anything, cookieZ shows you how many cookies will go and which sites they come from. Some cookie editors say they've cleared everything but only clear the site you're on. This one deletes what it says it will, including partitioned cookies, which are often missed.

Features:
- See every cookie for the current site: name, value, domain, path, expiry and flags
- Delete cookies for this page, this site and its subdomains, or every site
- Create new cookies and edit any field
- Delete a single cookie
- Search by name, value, domain or path, then delete only the results
- Mark cookies as "Kept" so cookieZ never deletes them
- Works in incognito, kept separate from your normal cookies
- Tells you when Chrome changes what you set (for example, Chrome caps expiry at about 400 days)
- Light and dark mode

Privacy:
cookieZ makes no network requests. No ads, no analytics, no tracking, and nothing you do leaves your computer. You can check this yourself in the Network tab of Chrome's DevTools.

When you install it, it asks for two permissions: cookies, and storage to remember your settings. It asks for access to websites the first time you open it, and you can say no.

The code is open source, so you can read all of it:
https://github.com/mwc0/cookie-manager

Be careful: cookies can hold your logins. Don't paste a cookie's value anywhere you don't trust, or someone could sign in as you.

Help and bug reports: https://cookiez.uk/support/ or support@cookiez.uk
Privacy policy: https://cookiez.uk/privacy/
```

---

## Single purpose description

*Required. The store asks you to state the extension's single purpose.*

```
cookieZ lets the user view, create, edit and delete the cookies stored
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
Used to store two things locally. First, the list of cookies the user has
marked as "Kept", so the extension remembers to exclude them from deletion
after the popup closes. Each entry holds a cookie's name, domain and path,
plus its partition key for partitioned (CHIPS) cookies. It never holds cookie
values. Second, the user's colour theme choice: "auto", "light" or "dark".
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

```
https://cookiez.uk/privacy/
```

That page is generated from `store/PRIVACY.md` by `tests/make_privacy_page.py`,
so it always says the same as the file here. After changing PRIVACY.md, re-run
the script and push, or the website falls behind.

## Contact email

```
support@cookiez.uk
```
