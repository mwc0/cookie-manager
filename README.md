# cookieZ - Cookie Editor

A Chrome cookie manager (Manifest V3)


## What it does so far

- Lists the current site's cookies, with domain, path, expiry and flags,
  including the partitioned cookies other companies keep for that site.
  Those are counted in the delete options, Clear site data and export too.
- Deletes cookies at three scopes: this page, this domain and its subdomains,
  or every site in the profile, plus a fourth while searching (below). It
  always shows the exact count and the exact domains affected before anything
  is removed.
- Creates and edits cookies, including the awkward parts other editors get
  wrong: a host-only cookie stays host-only, a session cookie doesn't quietly
  become permanent, and renaming one moves it instead of leaving two behind.
  It can also make a partitioned cookie for the site you're on, and
  Duplicate works for one.
- Copies a cookie's name or value, from its row or from the editor.
- Deletes a single cookie from its row, on a second click rather than a dialog.
- Tells you when Chrome silently changes what you asked for. It caps cookie
  expiry at about 400 days, so asking for a date beyond that says so instead
  of showing you a date that isn't what was stored.
- Searches the current tab's cookies by name, value, domain or path, or
  just one of them with a prefix such as `name:sid` or `domain:example.com`. While a
  search is active you also get a "just the cookies shown" delete scope, so
  filtering and then deleting removes what you can see rather than silently
  reaching past it. Quick filters include three checks for developers: not
  Secure (on an HTTPS page), readable by scripts, and SameSite None.
- Marks cookies with a well-known name as **Known**, with a filter for
  them, and says in the editor who usually sets one and what for. This comes
  from a list inside the extension and is looked up on your computer only.
  It's a guess from the name, and says so: any site can call its own cookie
  `_ga`.
- Lets you mark a cookie as **kept**, which excludes it from every delete this
  extension makes, including "All sites", and says so in the count before
  you delete, and lists kept cookies first among cookies that sort the
  same. It's a guard on this extension's own delete button, not
  protection from the website: nothing here stops a site changing its own
  cookies.
- Lets you choose which sites may set cookies, from the Block button: allow
  all, clear them when Chrome closes, block other companies' cookies, or
  block every cookie, for one site; or block other companies' cookies on
  every site, or everything except the sites you allow. The extension has
  no background script, so it doesn't do the blocking. It gives your choice
  to Chrome, and Chrome enforces it, which is why it works while the popup
  is closed and why removing the extension removes the rules.
- Blocks known trackers' cookies on every site, with one switch. The list of
  about 130 advertising and analytics domains is a file inside the
  extension, never downloaded, so it only changes when the extension is
  updated. It uses the same optional permission as the rest of blocking.
  Sites set to allow all cookies still get them, and each tracker's own
  website keeps its cookies, so signing in there still works. It blocks the
  trackers' cookies, not the trackers: their scripts still load. Turning it
  on offers to delete the tracker cookies already saved (kept cookies stay,
  Undo works).
- Shows how many cookies it has cleared for you, ever, on the Block cookies
  screen. It's one number kept on your computer. It counts what this
  extension deleted, not what Chrome blocked, because Chrome doesn't tell
  extensions when it blocks a cookie.
- Clears a site's stored data (local storage, databases, cache storage,
  offline files) along with its cookies, for the sites that need more than
  their cookies cleared before you can log in again.
- Offers a "Reload the site" button after a delete, Clear site data, an
  import or an Undo, since the open page still has what it loaded. It only
  reloads when you click it, and needs no permission.
- Exports and imports cookies in several formats, including Python code
  for your own test scripts. An export can be locked with a password, using
  the browser's own encryption (AES-GCM, with the key made from the
  password by PBKDF2-SHA-256 and 600,000 rounds), all on your computer.
  Import spots a locked file and asks for the password. The password is
  never saved, so a forgotten one can't be recovered. See
  `src/lib/crypto.js`.
- Warns, in one line, when an export holds cookies that look like sign-ins
  and has no password, and on import, that you should only import cookies
  you made yourself. Neither stops you.
- Compares an earlier export with the cookies those sites have now, and
  lists which are new since, gone or changed. Names and sites only, never
  values, and nothing is written.
- Asks once, after the fifth delete, import or save that worked, whether
  you'd leave a review (once more later if you say "Not now", never if you
  say no). Its button, also at the end of Help, opens the store's review
  page when clicked: the only web page the extension can open.

## Permissions

The extension asks for `cookies` and `storage` at install, and nothing else.
Access to websites is **optional** and requested at runtime, the first time you
open the popup. Chrome will not release a single cookie to an extension without
it.

Three more permissions are **optional** too, each requested only the first
time you use the feature that needs it:

- `contentSettings`, for blocking. Chrome's wording for it mentions the
  camera and microphone, because one permission covers every site setting.
  The code only touches the cookie setting: see `src/lib/rules.js`.
- `privacy`, only for blocking other companies' cookies on every site. It
  turns on Chrome's own switch for that, and nothing else.
- `browsingData`, only for Clear site data, which clears one site's stored
  data when you ask.

## What it will never do

No network requests. No telemetry or analytics. No ads, affiliate links or
injected content. No remote code.

The source is deliberately plain JavaScript with no build step, no bundler and
no dependencies, so you can read exactly what it does before trusting it with
your session cookies.

## Licence

MIT. See `LICENSE`. You can read it, fork it, and check that what's published
is what's described, which is rather the point.

## Third-party data

The lists of known cookie names and tracker domains in `src/lists/` are made
from the [Open Cookie Database](https://github.com/jkwakman/Open-Cookie-Database),
under the Apache License 2.0. Its licence, and what was changed, is in
`src/lists/LICENSE-OpenCookieDatabase.txt`. The lists are built by
`tests/make_lists.py`, which never downloads anything itself.

## Releases

What changed in each version is on the
[releases page](https://github.com/mwc0/cookie-manager/releases), along with
the exact zip that was uploaded to the Chrome Web Store.
