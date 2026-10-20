# Privacy Policy: cookieZ

**Last updated: 20 October 2026**

## The short version

cookieZ collects nothing, sends nothing, and makes no network requests
of any kind. There is no server to send anything to.

## What this extension collects

Nothing.

Not your cookies. Not the sites you visit. Not usage statistics, crash
reports, error logs, or which buttons you press. Not an installation
identifier. Not your email address. Nothing is collected, because nothing is
transmitted.

## What this extension sends

Nothing. cookieZ makes no network requests at all.

That includes the things extensions commonly send without mentioning:

- No analytics or telemetry
- No crash or error reporting
- No update or licence checks
- No remotely loaded fonts, stylesheets, scripts or images
- No advertising or affiliate requests
- No "anonymous" or "aggregated" statistics

Everything the extension needs is bundled inside it. It has no server
component, so there is no place for your data to go even in principle.

## Lists inside the extension

cookieZ includes two lists, made from the Open Cookie Database, a public
list of well-known cookies:

- the websites of about 130 advertising and analytics companies, used
  only if you turn on **Block known trackers' cookies**
- well-known cookie names, with who usually sets each one and what for,
  used to label cookies as **Known** in the table and the editor

Both are files inside the extension package. They are never downloaded or
updated over the network, so they only change when cookieZ itself is
updated through the Chrome Web Store. They are read only on your device:
when cookieZ labels a cookie as Known, it compares the cookie's name with
its own copy of the list, and nothing about the cookie or the site is sent
anywhere to check it.

## What this extension stores on your device

Five things are saved on your own computer, and a sixth is held briefly in
memory so your last change can be undone. None of them is ever transmitted.

### Your colour theme

Whether you picked Light or Dark. That is the whole record: one of those two
words. It is only saved if you pick the opposite of your system's theme, and
it is removed if you switch back. It is stored twice, in Chrome's
`storage.local` and in the popup's own browser storage. The second copy exists
only so the popup can draw in the right colours instantly instead of flashing
white first.

### Cookies you have marked as Kept

The list of cookies you have marked as **Kept**, so that the extension
remembers not to delete them.

That list is stored using Chrome's `storage.local` API, which keeps it on your
own computer. It records only enough to recognise a cookie again:

- the cookie's name
- its domain
- its path
- for a partitioned (CHIPS) cookie only, its partition key, which includes
  the top-level site the cookie is partitioned under

It never includes cookie **values**.

That fourth item is worth stating plainly rather than glossing: for
partitioned cookies you have chosen to keep, the stored list will contain the
name of the site they are partitioned under. It is written to your own disk,
it is not synced to any account, not backed up anywhere, not readable by any
website, and never transmitted. But it is a site name, so you should know it
is there.

Nothing is stored for cookies you have not marked as Kept. Uninstalling the
extension removes the list, and the theme setting with it.

You can see the whole list, for every site, on the **Kept cookies** screen in
the extension, and remove anything from it there.

### Your site rules

If you use **Block** to choose which sites may set cookies, cookieZ saves
your choices so it can show them to you and hand them to Chrome. Each entry
is a site's name and the rule you picked for it: allow all cookies, clear
them when Chrome closes, block other companies' cookies, or block all
cookies. Three more settings are saved with them: the rule for every site
without one of its own, whether blocking a site should also delete its
cookies without asking, and whether **Block known trackers' cookies** is
turned on.

It never includes cookies or cookie values. It is a list of site names, so
you should know it is there. It is stored using Chrome's `storage.local` API
on your own computer, is not synced to any account, and is never transmitted.

Nothing is saved until you set a rule. You can see the whole list on the
**Block cookies** screen, remove any entry, or turn every rule off there.
Uninstalling the extension removes the list, and Chrome stops following the
rules.

You can also save a copy of your rules as a file, to load on another
computer. That file holds exactly the list and settings above. It is
saved where you choose, like any download, and cookieZ keeps no copy of it.

### The version you last opened

cookieZ saves its own version number, such as 1.7.0, the first time you
open a new version, so it can show one line about what's new just once.
That is the whole record.

### How many cookies cookieZ has cleared

One number: how many cookies cookieZ has deleted for you, in total, shown
on the **Block cookies** screen. It goes up when you delete cookies with
cookieZ and down when you undo a delete. It doesn't record which cookies,
which sites or when, only the total. It counts cookies cookieZ cleared,
not cookies Chrome blocked, because Chrome doesn't tell extensions when it
blocks a cookie. It is stored using Chrome's `storage.local` API on your
own computer and is never transmitted. Uninstalling the extension removes
it.

### Your last change, for Undo

When you delete cookies, import cookies or save a cookie in the editor,
cookieZ holds on to what it needs to undo that change if you click **Undo**:

- the cookies as they were before: the ones you deleted, or the ones an
  import or a save replaced, so they can be put back
- the cookies an import or a save added, so they can be taken away again

To put a cookie back it needs the whole cookie, so this does include cookie
**values**, which are often what keeps you logged in to a site.

It is kept as briefly and as narrowly as possible:

- Only the most recent change is held. A new delete, import or save
  replaces it.
- It is dropped after 10 minutes, and as soon as you use Undo.
- It is held in Chrome's `storage.session`, which lives in memory only. It is
  never written to your disk, and Chrome empties it when you close the
  browser.
- Changes made in an incognito window are held separately, and are only
  offered for Undo in incognito.

Like everything else here, it is never transmitted.

## Cookies the extension reads

cookieZ reads your cookies in order to show them to you, which is what
it is for. This happens only while the popup is open, only in response to you
opening it, and the results only ever reach your own screen. While it is
open, Chrome also tells it when a site changes a cookie, so the table can
show the change and the **What changed** screen can list it. That list holds
the cookie's name, its site, the time, and whether it was added, changed,
removed or expired. It never holds the cookie's value. It is kept in memory
only, and nothing about those changes is kept once the popup closes.

Cookie values are shown in the popup's table. They are never transmitted, and
never stored by the extension, except for the short-lived Undo copy described
above. They only leave the popup if you choose: when
you copy a value, a Set-Cookie line or an export, it goes to your clipboard,
and when you download an export, it is saved as a file on your computer,
where you choose.
cookieZ keeps no copy of either.

Importing works the same way in reverse. The cookies you paste or choose are
written to Chrome's cookie store and nowhere else.

## Password-protected exports

You can give an export a password. cookieZ uses it on your computer, with
Chrome's own encryption, to lock that one file, and again to open it when
you import it. The password is never saved and never sent anywhere: once
the file is locked or opened, cookieZ forgets it. This also means a
forgotten password can't be recovered. The locked file is one you copy or
save yourself, like any other export, and cookieZ keeps no copy of it.

## Reloading the site

After a delete, Clear site data, an import or an Undo, cookieZ offers a
**Reload the site** button. It reloads only the tab you're on, and only when
you click it. Reloading a tab needs no permission, so nothing new is asked
for.

## Blocking cookies

Site rules are the one thing that goes on working while cookieZ is closed,
so it is worth saying exactly how. cookieZ does not run in the background
and does not watch your browsing. When you set a rule, it gives that rule to
Chrome, using the same site settings you can see in Chrome's own settings
pages, and Chrome does the blocking from then on. cookieZ is not told which
sites you visit or which cookies were blocked.

If you turn on **Block known trackers' cookies on every site**, cookieZ
gives Chrome a rule for each company on its built-in list (see "Lists
inside the extension" above), and Chrome blocks those companies' cookies
on every site. This uses the same site settings permission as the rest of
Block, so nothing new is asked for. Sites you have set to allow all
cookies still get them, and each company's own website keeps its cookies,
so you can still sign in there. It blocks the companies' cookies, not the
companies themselves: their scripts and images still load. When you turn
it on, cookieZ offers to delete the cookies those companies have already
saved (or deletes them straight away, if you have chosen to always delete
when blocking), by looking up the domains on the list and nothing else.
Kept cookies are left alone, and Undo can put the deleted ones back.

If you choose to block other companies' cookies on every site, cookieZ
turns on Chrome's own setting for that, the one in Chrome's privacy
settings, instead of writing a rule. While cookieZ has it turned on, you
can't change it in Chrome's settings. Choosing anything else, turning every
rule off, switching cookieZ off or removing it hands the setting back to
you as it was.

When you next open cookieZ, it asks Chrome whether your saved rules are
still in force, and sets them again if they are not. That check is made
against the sites on your saved list only, plus one company from the
trackers list if that switch is on. The **Block cookies** screen also
shows how many cookies each listed site has at that moment, by looking up
those sites only.

## Clearing a site's data

**Clear site data** deletes the site's cookies the usual way, so kept cookies
are left alone and Undo can put the cookies back. It then asks Chrome to
clear what else that site has stored on your computer: its local storage,
databases, cache storage and offline files. cookieZ never reads that data;
Chrome deletes it directly, and it can't be put back. Only the site the
popup is open on is affected.

## Permissions, and why each one exists

**`cookies`**: required to read, create, edit and delete cookies. Without it
the extension cannot do anything at all.

**`storage`**: required to remember which cookies you marked as Kept, your
site rules, your colour theme, the version you last opened and how many
cookies cookieZ has cleared, so they survive closing the popup, and to hold
your last change in memory for Undo.

**Changing site settings** (`contentSettings`): required only for
**Block**. This permission is **optional** too. It is not part of the install
prompt, and Chrome asks for it only if you click the button on the Block
cookies screen. Chrome's own wording for it is broad, and mentions the camera,
microphone and location, because one permission covers every kind of site
setting. cookieZ uses it for one thing: the setting that says whether a site
may use cookies. You can decline it and everything else works as before, and
you can revoke it later from the extension's Details page.

**Changing privacy settings** (`privacy`): required only to block other
companies' cookies on every site, and **optional**. Chrome asks for it the
first time you choose that, and its prompt reads "Change your
privacy-related settings". cookieZ uses it for one setting: whether other
companies' cookies are allowed. You can decline it and everything else works
as before.

**Clearing browsing data** (`browsingData`): required only for **Clear site
data**, and **optional**. Chrome asks for it the first time you use that.
cookieZ uses it to clear one site's stored data when you ask, and never
anything else, never on its own, and never your history or passwords.

**Access to websites** (`*://*/*`): Chrome will not release a single cookie
to an extension without permission for the site that cookie belongs to. This
permission is **optional**: it is deliberately kept out of the install prompt
and requested at runtime, the first time you open the popup. You can decline
it, and you can revoke it later from the extension's Details page in
`chrome://extensions`. It is used only to read and change cookies when you
ask.

No other permissions are requested.

## Third parties

There are none. No analytics provider, no error-reporting service, no CDN, no
advertising network, no affiliate partner. No data is sold, shared,
transferred or disclosed to anyone, because no data leaves your device.

## Remote code

The extension runs no remote code. Everything it executes ships inside the
extension package and can be read in full. This is required by Chrome's
Manifest V3 and is also a deliberate design choice. See below.

## Verifying all of this yourself

You do not have to take any of it on trust.

**Watch the network.** Open the extension, use it, and keep Chrome's DevTools
Network tab open throughout. You will see no outbound requests.

**Read the source.** The extension is plain JavaScript, HTML and CSS with no
build step, no bundler, no minification and no dependencies. What is published
is what was written. The full source is at:

https://github.com/mwc0/cookie-manager

**Run the tests.** The repository includes an automated check that scans the
source for anything capable of making a request, and separately captures every
request the browser makes during a full session of using the extension. Both
have to come back empty.

## Children

The extension is not directed at children and collects no personal
information from anyone, of any age.

## Changes to this policy

If this policy ever changes, the updated version will be published at the
repository link above with a new date at the top, and the change will be
described in the extension's release notes at
https://github.com/mwc0/cookie-manager/releases. Any change that introduced data
collection would be a fundamental change to what this extension is, and would
be stated plainly rather than buried here.

## Contact

Questions, or something in this policy that does not match what you observe:
email support@cookiez.uk, or open an issue at
https://github.com/mwc0/cookie-manager/issues
