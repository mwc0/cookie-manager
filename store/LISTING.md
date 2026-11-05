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
Cookie Editor & Blocker - cookieZ
```

## Summary

*Limit: 132 characters. Shown under the name in search results.*

```
View, edit, delete and block cookies. There are no ads, and nothing you do leaves your computer.
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
cookieZ is an open source cookie editor for Chrome. It's for people who build or test websites, and for anyone who can't log in to a site and has been told to clear its cookies.

See, edit and delete the cookies on any site. Before anything is deleted, cookieZ shows how many cookies will go and which sites they belong to, then deletes exactly those. Some cookie editors say they've cleared everything when they've only cleared the site you're on, and many miss partitioned cookies. cookieZ deletes those too.

WHAT IT DOES

Viewing
- Every cookie for the site you're on: name, value, domain, path, expiry and flags
- Search by name, value, domain or path, or just one of them, such as domain:example.com
- One-click filters, such as Secure, Session or Expiring soon, and checks for developers, such as cookies that scripts can read
- Cookies with a well-known name say which company sets them and what for
- Partitioned cookies that other companies set while you were on the site are shown with it
- A Site report groups a site's cookies by purpose and the company that usually sets them, in plain English, and lists what's worth checking. It's a guess from each cookie's name, and it says so
- Sort by name, size, domain or expiry
- Encoded values and dates shown in a form you can read
- The table updates when the site changes a cookie, and a list shows what was added, changed, removed or expired

Deleting
- This page, this site and its subdomains, every site, the cookies you've ticked, or just what a search or filter is showing
- The count and the list of sites are shown before you confirm
- Undo your last delete, import or edit for 10 minutes
- Mark a cookie as Kept and it's left out of every delete. One screen lists everything you've kept
- Clear a site's stored data as well as its cookies, which often fixes a site you can't log in to
- Reload the site in one click afterwards, so it starts afresh, or clear and reload in one go

Editing
- Change any field, or make a new cookie
- Set an expiry in one click: 1 hour, 1 day, 1 week or 1 year
- Duplicate a cookie, copy its name, or copy it as the line a server would send
- Make partitioned cookies as well as ordinary ones
- Edit JSON values laid out, and they're saved on one line again
- Keep, stop keeping or change the expiry of all the cookies you've ticked at once
- If Chrome would refuse a cookie, you're told why: it's over 4 KB, or its name starts with __Host- or __Secure- and breaks the rules for those
- You're also told when Chrome changes what you set, such as its 400-day limit on expiry

Blocking
- One button to choose which cookies a site may set: allow them all, clear them when Chrome closes, block other companies' cookies, or block every cookie
- Block other companies' cookies on every site at once, or block everything except the sites you allow
- Block known trackers' cookies on every site, from a list built into cookieZ. Sites you allow still get them, and the trackers' own sites still work
- See how many cookies cookieZ has cleared for you
- Chrome does the blocking, so it works when cookieZ is closed, and removing cookieZ removes the rules
- One screen lists every site with a rule, and you can save a copy to use on another computer

Moving cookies
- Export cookies to use in your own tools and tests, or to keep a copy. JSON and cookies.txt are both supported
- Lock an export with a password, so only someone with the password can open it. The password is never saved
- Import them again, or paste in a request copied from DevTools. You see a preview before anything is added
- A plain warning when an export holds sign-in cookies, or when you're about to import someone else's
- Copy cookies from one site to another, such as from a staging site to localhost
- Compare a site's cookies with an earlier export, to see which are new, gone or changed

Also
- Alt+Shift+K opens it, / searches, N adds a cookie, the arrow keys move through cookies and Esc goes back
- Opens in a full tab for long lists and long values, or stays open beside the page in Chrome's side panel
- Works in incognito, kept separate from your normal cookies
- Light and dark
- In English, German, Spanish, French, Japanese and Brazilian Portuguese, following Chrome's own language
- Help is built in and works offline

PRIVACY
cookieZ makes no network requests. There are no ads and no analytics, it doesn't track you, and nothing leaves your computer. You don't have to take that on trust: open Chrome's DevTools, watch the Network tab and use it. The one web page it can open is this store's review page, and only when you click Leave a review.

At install it asks for three permissions: cookies, storage, and the side panel so it can stay open beside the page. Chrome shows no warning for the side panel. It asks for access to websites the first time you open it, and you can say no. Blocking and clearing a site's data need more permissions, each only asked for the first time you use it.

SOURCE CODE
All of it is on GitHub. It's plain JavaScript with no build step, so what you read is what runs:
https://github.com/mwc0/cookie-manager

BE CAREFUL
Cookies can hold your logins. Don't paste a cookie's value or an export anywhere you don't trust, or someone could sign in as you.

HELP
https://cookiez.uk/support/ or support@cookiez.uk
Privacy policy: https://cookiez.uk/privacy/

cookieZ is made by an independent developer in the UK.
```

---

## Single purpose description

*Required. The store asks you to state the extension's single purpose.*

```
cookieZ lets the user view, create, edit and delete the cookies stored
in their own browser, and choose which sites may set them. Every feature
serves that one purpose, managing the user's cookies and the site data that
goes with them: listing cookies for the current site, editing their fields,
deleting them at a chosen scope, searching within them, marking individual
cookies to be excluded from deletion, setting rules for whether cookies are
allowed (including blocking known trackers' cookies), naming cookies whose
name is well known, and clearing a site's stored data when its cookies are
cleared.
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
Used to store six things locally, via chrome.storage.local. First, the
cookies the user has marked as "Kept", so they are left out of deletes: a
cookie's name, domain, path and, for partitioned cookies, partition key,
never its value. Second, the colour theme, if the user picks the opposite
of their system theme. Third, the user's site rules, if they set any: site
names, the rule for each, and three related settings. Fourth, the extension
version last opened, so a "what's new" line shows once. Fifth, a count of
the cookies the extension has deleted, shown to the user. Sixth, a count of
the user's finished deletes, imports and saves, and whether they answered
a request for a review, so that request is shown at most twice. Also, for the Undo
button, the cookies affected by the most recent delete,
import or save are held in chrome.storage.session (memory only, never
written to disk, cleared by the browser on exit). Only the last change is
held, and it is dropped after 10 minutes or once used. Nothing is synced or
transmitted.
```

### `contentSettings` (optional)

```
Used for one feature, Block, which lets the user choose which sites may set
cookies: allow all, clear them when the browser closes, block third-party
cookies on that site, block all cookies on that site, block cookies on
every site except the ones they allow, or block cookies from a list of
known advertising and analytics domains, which is bundled in the package. The extension has no background script, so it cannot block cookies
itself; it passes the user's choice to Chrome through
chrome.contentSettings.cookies and Chrome enforces it. Only the cookies
content setting is ever read or written. No other content setting
(JavaScript, camera, microphone, location, and so on) is touched. The
permission is declared under optional_permissions, so it is not part of the
install prompt: it is requested at runtime, only when the user clicks the
button on the Block cookies screen, and can be declined or revoked. Rules
are only ever set in response to the user choosing one.
```

### `privacy` (optional)

```
Used for one choice on the Block cookies screen: blocking third-party
cookies on every site. A per-site content setting can't express "any site
other than the page's own", so this sets Chrome's own switch,
chrome.privacy.websites.thirdPartyCookiesAllowed, to false. It is the only
privacy setting read or written. It is declared under optional_permissions,
so it is not part of the install prompt: it is requested only when the user
picks that choice, and can be declined. Choosing anything else, or turning
the rules off, clears the extension's control so the user's own setting
applies again.
```

### `browsingData` (optional)

```
Used for one button, Clear site data, which helps when deleting a site's
cookies alone doesn't fix it. When the user clicks it and confirms,
chrome.browsingData.remove is called with the origins of the site in the
active tab only, for localStorage, indexedDB, cacheStorage, serviceWorkers
and fileSystems. It never clears history, passwords, downloads or any other
site, and never runs without the user asking. The site's cookies are deleted
separately through the cookies API, so the user's excluded cookies and Undo
still apply. It is declared under optional_permissions and requested only
the first time the button is used.
```

### `sidePanel`

```
Used for one button, Open in side panel, so the extension can stay open
beside the page instead of in the toolbar popup, which closes whenever the
user clicks away. The side panel shows the same extension page as the
popup. It is requested at install rather than at runtime because granting
it at runtime made chrome.sidePanel.open() crash the browser; Chrome shows
no warning for it. No side_panel manifest key is used, so the panel only
exists after the user clicks that button. While the panel is open it listens to chrome.tabs.onActivated
and chrome.tabs.onUpdated for its own window, only to show the cookies of
the site in the active tab; nothing about those events is stored or
transmitted.
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
The source is unminified and unbundled. The two data lists (known cookie
names and tracker domains) are plain files in the package, never downloaded.
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
