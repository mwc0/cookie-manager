# Store listing assets

What goes into the Chrome Web Store submission.

| File | What it is |
| --- | --- |
| `LISTING.md` | Every text field in the Developer Dashboard, ready to paste — name, summary, description, single-purpose statement, permission justifications, data disclosures. |
| `PRIVACY.md` | The privacy policy. The store needs a URL for this; `LISTING.md` says which URL to use. |
| `screenshots/` | Not made yet. See below. |

## One wording decision to make before submitting

**The listing does not mention EditThisCookie by name.** That was a deliberate
choice and it is worth a minute of your time, because the argument cuts both
ways.

People who lost EditThisCookie search for it by name, so naming it would
likely find users who are looking for exactly this. But:

- It is the name of an extension that currently exists on the store, under an
  owner who is not you. Using a competitor's name in your listing risks a
  trademark complaint and a takedown.
- Chrome Web Store policy prohibits manipulating search placement with
  irrelevant keywords. A single factual mention is defensible; leaning on the
  name is not, and the line is drawn by a reviewer, not by you.
- A security-adjacent tool that looks like it is trading on another product's
  name works against the trust the whole listing is built on.

If you decide the reach is worth it, the defensible version is one factual
sentence in the description, not a keyword in the title or summary. Something
like:

> Built as a Manifest V3 replacement for the kind of cookie editor that
> stopped working when Chrome retired Manifest V2.

That says what it is without naming anyone. If you want the name itself, put
it in a sentence of plain fact ("built after EditThisCookie was removed from
the store") and accept the risk knowingly.

My recommendation is to leave it out at launch. It is easy to add later; a
takedown on a new listing is not easy to undo.

## Screenshots — still to do

The store wants **1280×800** or **640×400** PNG or JPEG. You need at least
one; up to five are allowed and using all five is worth it, since the spec
notes that listing quality is the constraint on installs.

Suggested set, in order:

1. **The main view** — a site with a realistic set of cookies, table visible.
2. **The delete scope indicator** — "All sites" selected, showing the count
   and the expanded list of domains. This is the headline feature and the
   answer to the "delete all doesn't" complaint, so it earns a slot.
3. **The editor** — creating or editing a cookie, showing the fields.
4. **Search** — a filter active, with the "just the cookies shown" scope
   visible.
5. **Kept cookies** — a kept row with its Delete disabled and the scope
   summary saying what it will leave alone.

Two things to get right:

- **Use a site you are entitled to show.** Screenshots of a real service's
  session cookies show that service's branding in your listing. `example.com`
  is reserved for documentation and is the safe choice; a local test page you
  control also works.
- **Don't show real session values.** Anything readable in a screenshot is
  public. Use obviously fake values.

The popup renders at 760px wide, so it will not fill a 1280×800 frame on its
own. Centre it on a plain background rather than scaling it up — an upscaled
screenshot looks blurry and cheap, which is the opposite of the impression
this listing is trying to make.

## Before you submit

- [ ] Decide the EditThisCookie question above
- [ ] Produce the screenshots
- [ ] Re-read `PRIVACY.md` and confirm every claim is still true of the code
      you are shipping — it is written in absolutes, which is only an asset
      while it stays accurate
- [ ] Check the version number in `src/manifest.json`
- [ ] Zip **the contents of `src/`**, not the repo root and not the `src`
      folder itself
- [ ] Confirm the zip contains no `tests/`, no `docs/`, no `.git`
