// Builds the cookie table.
//
// Always use textContent here, never innerHTML. Cookie names and values come
// from websites, so they can't be trusted. Putting them in innerHTML would be
// a security hole.

import {
  formatExpiry,
  formatExpiryFull,
  expiresSoon,
  formatSameSite,
  truncate,
  cookieBytes,
  LARGE_COOKIE_BYTES,
  formatBytes,
  bareDomain,
} from "../lib/format.js";
import { cookieKey } from "../lib/cookies.js";
import { knownCookie, describeKnownBy } from "../lib/known.js";
import { copyWithFeedback, copyWithIconFeedback } from "./clipboard.js";
import { iconButton, setIconContent } from "./icons.js";

// Short enough that a row fits the popup's width. Long values can be clicked
// to show in full.
const VALUE_PREVIEW_LENGTH = 28;

// `handlers` is { onEdit(cookie), onDelete(cookie), onProtect(cookie, on),
// isProtected(cookie), onPick(cookie, ticked), isPicked(cookie),
// isChanged(cookie), isExpanded(cookie), onExpand(cookie, expanded),
// isEmbedded(cookie) }. isEmbedded says a cookie was set by another site
// and is kept for this one only (see setByOtherSite() in cookies.js).
// Deleting one cookie takes two clicks (Delete, then "Sure?"), and onDelete
// is only called after the second.
//
// Each row carries its cookie's key in data-key, and can take keyboard
// focus (tabindex -1). popup.js decides which row is in the tab order and
// handles the keys.
//
// `sort` is { key: "name" | "domain" | "expires", dir: "ascending" |
// "descending" }.
export function renderCookieTable(tbody, cookies, handlers = {}, sort = DEFAULT_SORT) {
  tbody.textContent = "";

  const sorted = sortCookies(cookies, sort, handlers.isProtected);

  // Only one row can show "Sure?" at a time. Clicking another row's button
  // resets the rest.
  const disarmers = [];
  const disarmAll = () => {
    for (const disarm of disarmers) {
      disarm();
    }
  };

  for (const cookie of sorted) {
    tbody.appendChild(buildRow(cookie, handlers, disarmers, disarmAll));
  }
}

export const DEFAULT_SORT = { key: "domain", dir: "ascending" };

// Ties are broken by domain and then name, so the order never jumps about.
// "example.com" and ".example.com" sort together.
//
// Before that, a Kept cookie comes first among its ties, whichever way
// round the sort is. In the usual sort, by domain, that puts a site's Kept
// cookies at the top of it. `isKept(cookie)` says whether a cookie is
// marked Kept (see src/lib/protect.js).
export function sortCookies(cookies, sort = DEFAULT_SORT, isKept = () => false) {
  const host = (cookie) => bareDomain(cookie.domain);
  const keptFirst = (a, b) => (isKept(b) ? 1 : 0) - (isKept(a) ? 1 : 0);
  const byDomainThenName = (a, b) =>
    host(a).localeCompare(host(b)) || a.name.localeCompare(b.name);
  const flip = sort.dir === "descending" ? -1 : 1;
  // Each cookie's size once, not once per comparison.
  const sizes = sort.key === "size" ? new Map(cookies.map((cookie) => [cookie, cookieBytes(cookie)])) : null;

  return [...cookies].sort((a, b) => {
    if (sort.key === "name") {
      return flip * a.name.localeCompare(b.name) || keptFirst(a, b) || flip * byDomainThenName(a, b);
    }
    if (sort.key === "size") {
      return flip * (sizes.get(a) - sizes.get(b)) || keptFirst(a, b) || byDomainThenName(a, b);
    }
    if (sort.key === "expires") {
      // Session cookies have no date, so they go last whichever way round.
      const aSession = typeof a.expirationDate !== "number";
      const bSession = typeof b.expirationDate !== "number";
      if (aSession !== bSession) {
        return aSession ? 1 : -1;
      }
      if (aSession) {
        return keptFirst(a, b) || byDomainThenName(a, b);
      }
      return flip * (a.expirationDate - b.expirationDate) || keptFirst(a, b) || byDomainThenName(a, b);
    }
    return (
      flip * host(a).localeCompare(host(b)) || keptFirst(a, b) || flip * a.name.localeCompare(b.name)
    );
  });
}

function buildRow(cookie, handlers, disarmers, disarmAll) {
  const row = document.createElement("tr");
  row.dataset.key = cookieKey(cookie);
  row.tabIndex = -1;
  if (handlers.isProtected && handlers.isProtected(cookie)) {
    row.classList.add("kept-row");
  }
  // Just added or changed, by the site or by cookieZ. See popup.css.
  if (handlers.isChanged && handlers.isChanged(cookie)) {
    row.classList.add("changed");
  }

  // Clicking a row opens it in the editor, unless the click was on one of
  // its own controls, or was the end of selecting some text to copy. The
  // Edit button does the same for keyboard users.
  //
  // The click's path is checked, not event.target: clicking Delete swaps
  // its icon for "Sure?", so by the time the click reaches the row, the
  // icon that was clicked is no longer in the page.
  row.addEventListener("click", (event) => {
    const onControl = event
      .composedPath()
      .some((node) => node instanceof Element && node.matches("button, input, label"));
    if (onControl) {
      return;
    }
    if (String(window.getSelection()) !== "") {
      return;
    }
    disarmAll();
    if (handlers.onEdit) {
      handlers.onEdit(cookie);
    }
  });

  row.appendChild(pickCell(cookie, handlers));

  // Worked out once per row: the table is redrawn on every change the site
  // makes, so this runs a lot.
  const bytes = cookieBytes(cookie);
  const embedded = Boolean(handlers.isEmbedded && handlers.isEmbedded(cookie));

  const name = textCell(cookie.name, "mono name");
  name.title = cookie.name + " (" + formatBytes(bytes) + ")";
  row.appendChild(name);
  row.appendChild(valueCell(cookie, handlers));
  // Only shown when cookieZ is open in a tab. See .size in popup.css.
  row.appendChild(textCell(formatBytes(bytes), "nowrap size"));
  const domain = breakableCell(cookie.domain, ".", "mono domain");
  // Another company's cookie, kept for this site only. Said in words under
  // its domain, since otherwise it looks like a cookie set for that domain.
  if (embedded) {
    const note = document.createElement("span");
    note.className = "embedded-note";
    note.textContent = "set in a frame, kept for this site only";
    note.title =
      "Set by " + bareDomain(cookie.domain) +
      " in a frame on this site. It's partitioned, so it's kept for this site only.";
    domain.appendChild(note);
  }
  row.appendChild(domain);
  row.appendChild(breakableCell(cookie.path, "/", "mono path"));

  const expires = textCell(formatExpiry(cookie), "nowrap expires");
  expires.title = formatExpiryFull(cookie);
  if (typeof cookie.expirationDate !== "number") {
    expires.classList.add("session");
  }
  if (expiresSoon(cookie)) {
    expires.classList.add("expires-soon");
  }
  row.appendChild(expires);

  row.appendChild(flagsCell(cookie, bytes, embedded));
  row.appendChild(actionsCell(cookie, handlers, disarmers, disarmAll));
  return row;
}

// A tick box for choosing cookies by hand, for "Just the ticked cookies".
// It sits in a label that fills the cell, so the whole cell can be clicked:
// the box alone is smaller than the 24px WCAG asks for.
function pickCell(cookie, handlers) {
  const cell = document.createElement("td");
  cell.className = "pick";
  const target = document.createElement("label");
  target.className = "pick-target";

  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = handlers.isPicked ? handlers.isPicked(cookie) : false;
  box.setAttribute("aria-label", "Tick " + cookie.name);
  box.addEventListener("change", () => {
    if (handlers.onPick) {
      handlers.onPick(cookie, box.checked);
    }
  });

  target.appendChild(box);
  cell.appendChild(target);
  return cell;
}

// Copy name, Keep, Edit and Delete, as icon buttons. Each has its name in a
// hidden span, so screen readers read "Copy name", "Keep", "Edit", "Delete".
//
// The first click on Delete turns it into a filled "Sure?" (in words) with a
// cancel button next to it, and hides the others so they can't be hit by
// mistake. The second click deletes.
function actionsCell(cookie, handlers, disarmers, disarmAll) {
  const cell = document.createElement("td");
  cell.className = "row-actions";

  const protectedNow = handlers.isProtected ? handlers.isProtected(cookie) : false;

  // For pasting a name into code or a test. The icon turns into a tick for
  // a moment once it's copied.
  const copy = iconButton("copy", "Copy name");
  copy.classList.add("copy-name");
  copy.title = "Copy the name, " + cookie.name;
  copy.addEventListener("click", () => {
    disarmAll();
    copyWithIconFeedback(copy, cookie.name, "copy", "Copy name");
  });

  // Called "Keep", not "Protect", because it only stops this extension
  // deleting the cookie. See src/lib/protect.js. A kept cookie's bookmark is
  // filled in.
  const keep = iconButton("keep", protectedNow ? "Kept" : "Keep", { filled: protectedNow });
  keep.classList.add("keep");
  if (protectedNow) {
    keep.classList.add("kept");
  }
  keep.setAttribute("aria-pressed", protectedNow ? "true" : "false");
  keep.title = protectedNow
    ? "Kept: left out of every delete. Click to stop keeping it."
    : "Keep: leave this cookie out of every delete made here";
  keep.addEventListener("click", () => {
    disarmAll();
    if (handlers.onProtect) {
      handlers.onProtect(cookie, !protectedNow);
    }
  });

  const edit = iconButton("edit", "Edit");
  edit.classList.add("edit");
  edit.title = "Edit this cookie";
  edit.addEventListener("click", () => {
    disarmAll();
    if (handlers.onEdit) {
      handlers.onEdit(cookie);
    }
  });

  const remove = iconButton("delete", "Delete");
  remove.classList.add("danger");

  // A kept cookie can't be deleted. The button is disabled, not hidden, so
  // its tooltip can say why.
  if (protectedNow) {
    remove.disabled = true;
    remove.title = "Kept cookies aren't deleted. Click the bookmark to allow it.";
  } else {
    remove.title = "Delete this cookie";
  }

  const cancel = iconButton("cancel", "Don't delete");
  cancel.classList.add("cancel");
  cancel.hidden = true;

  let armed = false;
  const disarm = () => {
    armed = false;
    setIconContent(remove, "delete", "Delete");
    remove.classList.remove("armed");
    remove.classList.add("icon-only");
    copy.hidden = false;
    keep.hidden = false;
    edit.hidden = false;
    cancel.hidden = true;
  };
  disarmers.push(disarm);

  remove.addEventListener("click", () => {
    if (!armed) {
      disarmAll();
      armed = true;
      remove.textContent = "Sure?";
      remove.classList.remove("icon-only");
      remove.classList.add("armed");
      copy.hidden = true;
      keep.hidden = true;
      edit.hidden = true;
      cancel.hidden = false;
      return;
    }
    disarm();
    if (handlers.onDelete) {
      handlers.onDelete(cookie);
    }
  });

  cancel.addEventListener("click", () => {
    disarm();
    remove.focus();
  });

  cell.appendChild(copy);
  cell.appendChild(keep);
  cell.appendChild(edit);
  cell.appendChild(remove);
  cell.appendChild(cancel);
  return cell;
}

function textCell(text, className) {
  const cell = document.createElement("td");
  cell.textContent = text == null ? "" : String(text);
  if (className) {
    cell.className = className;
  }
  return cell;
}

// A cell that only wraps at a separator, so a long domain breaks after a dot
// and not in the middle of a word. <wbr> marks where a line may break and is
// otherwise invisible. Each piece is still added as text, never as HTML.
function breakableCell(text, separator, className) {
  const cell = document.createElement("td");
  cell.className = className;

  const parts = (text == null ? "" : String(text)).split(separator);
  parts.forEach((part, index) => {
    if (index > 0) {
      cell.appendChild(document.createTextNode(separator));
      cell.appendChild(document.createElement("wbr"));
    }
    cell.appendChild(document.createTextNode(part));
  });

  return cell;
}

// Long values show a preview. Click to see the whole value, with a Copy
// button under it. A short value is plain text: a disabled button would
// swallow the click that opens the row in the editor. An opened value stays
// open when the table is drawn again, such as when the site changes a
// cookie.
function valueCell(cookie, handlers) {
  const cell = document.createElement("td");
  cell.className = "mono value";

  const full = cookie.value == null ? "" : String(cookie.value);
  const needsToggle = full.length > VALUE_PREVIEW_LENGTH;

  if (!needsToggle) {
    const text = document.createElement("span");
    text.className = "value-text" + (full === "" ? " muted" : "");
    text.textContent = full === "" ? "(empty)" : full;
    cell.appendChild(text);
    return cell;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "value-toggle";
  button.textContent = truncate(full, VALUE_PREVIEW_LENGTH);

  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "row-button copy";
  copy.textContent = "Copy";
  copy.title = "Copy the whole value";
  copy.hidden = true;
  copy.addEventListener("click", () => copyWithFeedback(copy, full));

  const show = (expanded) => {
    cell.classList.toggle("expanded", expanded);
    button.textContent = expanded ? full : truncate(full, VALUE_PREVIEW_LENGTH);
    button.title = expanded ? "Click to collapse" : "Click to show the full value";
    copy.hidden = !expanded;
  };
  show(Boolean(handlers.isExpanded && handlers.isExpanded(cookie)));
  button.addEventListener("click", () => {
    const expanded = !cell.classList.contains("expanded");
    show(expanded);
    if (handlers.onExpand) {
      handlers.onExpand(cookie, expanded);
    }
  });

  cell.appendChild(button);
  cell.appendChild(copy);
  return cell;
}

// Only what's unusual about a cookie gets a badge, in words. Most cookies
// are for one host and have no SameSite set, so those get nothing, rather
// than the same badges on every row. The editor shows every setting.
// `bytes` and `embedded` come from buildRow(), which has already worked
// them out.
function flagsCell(cookie, bytes, embedded) {
  const cell = document.createElement("td");
  cell.className = "flags";
  const host = bareDomain(cookie.domain);

  if (cookie.secure) {
    cell.appendChild(badge("Secure", "Only sent over HTTPS"));
  }
  if (cookie.httpOnly) {
    cell.appendChild(badge("HttpOnly", "Hidden from the page's own JavaScript"));
  }
  if (!cookie.hostOnly) {
    cell.appendChild(badge("Subdomains", "Also sent to every subdomain of " + host));
  }
  // Set by another site in a frame on this one. Its row also says so in
  // words, under the domain (see buildRow()).
  if (embedded) {
    cell.appendChild(
      badge("Partitioned", "Partitioned (CHIPS): set by " + host + " and kept for this site only")
    );
  } else if (cookie.partitionKey) {
    cell.appendChild(
      badge("Partitioned", "Partitioned (CHIPS): kept separately for each site it's used on")
    );
  }
  if (cookie.sameSite && cookie.sameSite !== "unspecified") {
    cell.appendChild(
      badge("SameSite " + formatSameSite(cookie.sameSite), SAME_SITE_MEANING[cookie.sameSite] || "")
    );
  }

  // A guess from the name, so it comes after the facts, and the word is
  // "Known", never "tracker". Who it's known for is in the tip, and read
  // out by screen readers.
  const known = knownCookie(cookie.name);
  if (known) {
    const by = describeKnownBy(known);
    const tip = "Known name, used by " + by + ". A guess from the name only.";
    const mark = badge("Known", tip);
    mark.classList.add("known");
    const detail = document.createElement("span");
    detail.className = "visually-hidden";
    detail.textContent = " name, used by " + by;
    mark.appendChild(detail);
    cell.appendChild(mark);
  }

  if (bytes >= LARGE_COOKIE_BYTES) {
    const large = badge(
      "Large",
      formatBytes(bytes) + ". Chrome won't keep a cookie over 4 KB (name and value together)."
    );
    large.classList.add("large");
    cell.appendChild(large);
  }

  return cell;
}

const SAME_SITE_MEANING = {
  strict: "Only sent when you're on this site",
  lax: "Sent on this site, and when you follow a link to it",
  no_restriction: "Also sent when another site loads something from this one",
};

function badge(text, title) {
  const span = document.createElement("span");
  span.className = "badge";
  span.textContent = text;
  span.title = title;
  return span;
}
