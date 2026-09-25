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
addresses. If PRIVACY.md starts using something else, this stops with an
error rather than quietly dropping text.

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
  <!-- Applies a theme the visitor picked with the header button before the
       page draws, so it doesn't flash the other theme first. Inline and not
       deferred on purpose. See theme.js. -->
  <script>
    try {
      const saved = localStorage.getItem("color-scheme");
      if (saved === "light" || saved === "dark") {
        document.documentElement.classList.add(saved);
        document.querySelector('meta[name="color-scheme"]').content = saved;
      }
    } catch (e) {}
  </script>
  <title>Extension privacy policy - cookieZ</title>
  <meta name="description" content="The cookieZ extension collects nothing, sends nothing and makes no network requests. What it stores on your computer, and why it needs each permission.">
  <link rel="canonical" href="https://cookiez.uk/privacy/">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="cookieZ">
  <meta property="og:title" content="Extension privacy policy - cookieZ">
  <meta property="og:description" content="The cookieZ extension collects nothing, sends nothing and makes no network requests. What it stores on your computer, and why it needs each permission.">
  <meta property="og:url" content="https://cookiez.uk/privacy/">
  <meta property="og:image" content="https://cookiez.uk/images/01-overview.png">
  <meta property="og:image:width" content="1280">
  <meta property="og:image:height" content="800">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" type="image/png" sizes="32x32" href="../images/favicon-32.png">
  <link rel="stylesheet" href="../style.css">
  <script src="../theme.js" defer></script>
</head>
<body>
  <!-- Generated from store/PRIVACY.md by tests/make_privacy_page.py.
       Edit PRIVACY.md and re-run the script, never this page. -->
  <a class="skip" href="#main">Skip to content</a>

  <header class="site-header">
    <div class="wrap">
      <a class="wordmark" href="../" aria-label="cookieZ home">cookie<span class="key" aria-hidden="true">Z</span></a>
      <div class="header-end">
        <nav class="site-nav" aria-label="Main">
          <ul>
            <li><a href="../#features">Features</a></li>
            <li><a href="./" aria-current="page">Privacy</a></li>
            <li><a href="../support/">Support</a></li>
            <li><a href="https://github.com/mwc0/cookie-manager">Source code</a></li>
          </ul>
        </nav>
        <button type="button" class="theme-toggle" aria-label="Switch theme" hidden>
          <svg class="icon-moon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" fill="currentColor"/>
          </svg>
          <svg class="icon-sun" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="4.2" fill="currentColor"/>
            <g stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <line x1="12" y1="1.5" x2="12" y2="3.6"/>
              <line x1="12" y1="20.4" x2="12" y2="22.5"/>
              <line x1="1.5" y1="12" x2="3.6" y2="12"/>
              <line x1="20.4" y1="12" x2="22.5" y2="12"/>
              <line x1="4.6" y1="4.6" x2="6.1" y2="6.1"/>
              <line x1="17.9" y1="17.9" x2="19.4" y2="19.4"/>
              <line x1="4.6" y1="19.4" x2="6.1" y2="17.9"/>
              <line x1="17.9" y1="6.1" x2="19.4" y2="4.6"/>
            </g>
          </svg>
        </button>
      </div>
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
    # Indented to sit inside the template's <div class="prose">, so the page
    # source reads cleanly.
    body = "\n\n".join(out)
    body = "\n".join(("      " + line) if line else line for line in body.split("\n"))
    return title, updated, body


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
