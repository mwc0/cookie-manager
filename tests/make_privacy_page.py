"""
Build docs/privacy/index.html (the website's copy) from store/PRIVACY.md.

    python tests/make_privacy_page.py

The extension's privacy policy lives in one place, store/PRIVACY.md. The
website shows the same text, and a privacy policy that says one thing on
GitHub and another on the website is worse than having none. So the web page
is generated, never edited by hand. Run this after every change to
PRIVACY.md.

Only understands the handful of Markdown features PRIVACY.md actually uses:
headings, paragraphs, bullet lists, **bold**, `code`, bare links and email
addresses. If
PRIVACY.md starts using something else, this stops with an error rather
than quietly dropping text.

Uses only the standard library.
"""

import html
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "store" / "PRIVACY.md"
OUT = ROOT / "docs" / "privacy" / "index.html"


# The page around the policy text. Same header and footer as the rest of
# the site; keep them in step with docs/index.html.
TEMPLATE = """<!DOCTYPE html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>Privacy policy - cookieZ extension</title>
  <meta name="description" content="What the cookieZ extension collects, sends and stores. In short: nothing collected, nothing sent.">
  <link rel="canonical" href="https://cookiez.uk/privacy/">
  <link rel="icon" type="image/png" sizes="32x32" href="../images/favicon-32.png">
  <link rel="stylesheet" href="../style.css">
</head>
<body>
  <!-- Generated from store/PRIVACY.md by tests/make_privacy_page.py.
       Edit PRIVACY.md and re-run the script, never this page. -->
  <a class="skip" href="#main">Skip to content</a>

  <header class="site-header">
    <div class="wrap">
      <a class="wordmark" href="../" aria-label="cookieZ home">cookie<span class="key" aria-hidden="true">Z</span></a>
      <nav class="site-nav" aria-label="Main">
        <ul>
          <li><a href="../#features">Features</a></li>
          <li><a href="./" aria-current="page">Privacy</a></li>
          <li><a href="../support/">Support</a></li>
          <li><a href="https://github.com/mwc0/cookie-manager">Source code</a></li>
        </ul>
      </nav>
    </div>
  </header>

  <main id="main" class="page">
    <div class="wrap prose">
      <h1>Privacy policy</h1>
      <p class="updated">For the cookieZ browser extension. {{UPDATED}}.</p>
      <p class="aside">This covers the extension. For this website, see the <a href="../website-privacy/">website privacy policy</a>.</p>

{{BODY}}
    </div>
  </main>

  <footer class="site-footer">
    <div class="wrap">
      <span>&copy; 2026 cookieZ</span>
      <ul>
        <li><a href="./">Extension privacy</a></li>
        <li><a href="../website-privacy/">Website privacy</a></li>
        <li><a href="../support/">Support</a></li>
        <li><a href="https://github.com/mwc0/cookie-manager">Source code</a></li>
      </ul>
    </div>
  </footer>
</body>
</html>
"""


def inline(text):
    """Escape, then apply **bold**, `code` and bare https links."""
    text = html.escape(text, quote=False)
    text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"(?<![\"'>])(https://[^\s<]+[^\s<.,;:)])", r'<a href="\1">\1</a>', text)
    text = re.sub(r"\b([\w.+-]+@[\w-]+\.[\w.-]*\w)\b", r'<a href="mailto:\1">\1</a>', text)
    # Anything still looking like Markdown outside a code span was missed.
    outside_code = re.sub(r"<code>.*?</code>", "", text)
    if "*" in outside_code or "[" in outside_code:
        raise ValueError(f"Markdown this script doesn't handle: {text!r}")
    return text


def convert(markdown):
    """Returns (title, updated line, body HTML)."""
    lines = markdown.splitlines()
    title = updated = None
    out = []
    para = []
    items = []

    def flush_para():
        if para:
            out.append("<p>" + inline(" ".join(para)) + "</p>")
            para.clear()

    def flush_list():
        if items:
            out.append("<ul>\n" + "\n".join(f"  <li>{inline(i)}</li>" for i in items) + "\n</ul>")
            items.clear()

    for line in lines:
        stripped = line.strip()
        if line.startswith("# "):
            title = line[2:].strip()
        elif stripped.startswith("**Last updated:"):
            updated = stripped.strip("*").strip()
        elif line.startswith("## ") or line.startswith("### "):
            flush_para(); flush_list()
            level = 2 if line.startswith("## ") else 3
            out.append(f"<h{level}>{inline(line.lstrip('#').strip())}</h{level}>")
        elif line.startswith("- "):
            flush_para()
            items.append(line[2:].strip())
        elif line.startswith("  ") and items and stripped:
            items[-1] += " " + stripped
        elif not stripped:
            flush_para(); flush_list()
        else:
            flush_list()
            para.append(stripped)
    flush_para(); flush_list()

    if not title or not updated:
        raise ValueError("PRIVACY.md needs a '# ' title and a '**Last updated: ...**' line")
    return title, updated, "\n\n".join(out)


def main():
    title, updated, body = convert(SOURCE.read_text(encoding="utf-8"))
    page = TEMPLATE
    for marker, value in (("{{UPDATED}}", html.escape(updated)), ("{{BODY}}", body)):
        if page.count(marker) != 1:
            print(f"TEMPLATE must contain {marker} exactly once")
            return 1
        page = page.replace(marker, value)
    OUT.write_bytes(page.encode("utf-8"))
    print(f"wrote {OUT.relative_to(ROOT)} from {SOURCE.relative_to(ROOT)} ({updated})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
