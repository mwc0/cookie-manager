// Builds the cookie table rows.
//
// Everything here uses textContent, never innerHTML. Cookie names and values
// come from websites, so they are untrusted input. Dropping them into
// innerHTML inside an extension page would be a genuine security hole, not a
// style preference.

import {
  formatExpiry,
  formatExpiryFull,
  formatSameSite,
  truncate,
} from "../lib/format.js";

// Sized so a typical row fits the popup without the table overflowing --
// the row now carries three buttons, and a table wider than the popup gets
// scrolled rather than seen. Long values are still readable: click one to
// expand it in place.
const VALUE_PREVIEW_LENGTH = 28;

// `handlers` is { onEdit(cookie), onDelete(cookie), onProtect(cookie, on),
// isProtected(cookie) }. onDelete is only called once the user has confirmed,
// which this file handles: a single delete gets a two-click arm rather than a
// dialog, so nothing goes without a deliberate second click but there's no
// modal to dismiss either.
export function renderCookieTable(tbody, cookies, handlers = {}) {
  tbody.textContent = "";

  const sorted = [...cookies].sort(
    (a, b) => a.domain.localeCompare(b.domain) || a.name.localeCompare(b.name)
  );

  // Only one row may be armed at a time, so arming a second one disarms the
  // first. Kept per render pass rather than in a module variable, so a
  // re-render can't leave a stale button behind.
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

function buildRow(cookie, handlers, disarmers, disarmAll) {
  const row = document.createElement("tr");
  if (handlers.isProtected && handlers.isProtected(cookie)) {
    row.classList.add("kept-row");
  }

  row.appendChild(textCell(cookie.name, "mono name"));
  row.appendChild(valueCell(cookie.value));
  row.appendChild(breakableCell(cookie.domain, ".", "mono domain"));
  row.appendChild(breakableCell(cookie.path, "/", "mono path"));

  const expires = textCell(formatExpiry(cookie), "nowrap");
  expires.title = formatExpiryFull(cookie);
  if (typeof cookie.expirationDate !== "number") {
    expires.classList.add("session");
  }
  row.appendChild(expires);

  row.appendChild(flagsCell(cookie));
  row.appendChild(actionsCell(cookie, handlers, disarmers, disarmAll));
  return row;
}

function actionsCell(cookie, handlers, disarmers, disarmAll) {
  const cell = document.createElement("td");
  cell.className = "row-actions";

  const protectedNow = handlers.isProtected ? handlers.isProtected(cookie) : false;

  // "Keep" rather than "Protect": this only stops THIS extension deleting the
  // cookie. Nothing stops the website changing it. Calling that "protected"
  // would promise more than it does -- see src/lib/protect.js.
  const keep = document.createElement("button");
  keep.type = "button";
  keep.className = "row-button keep" + (protectedNow ? " kept" : "");
  keep.textContent = protectedNow ? "Kept" : "Keep";
  keep.setAttribute("aria-pressed", protectedNow ? "true" : "false");
  keep.title = protectedNow
    ? "This cookie is excluded from deletes. Click to stop keeping it."
    : "Exclude this cookie from deletes made here";
  keep.addEventListener("click", () => {
    disarmAll();
    if (handlers.onProtect) {
      handlers.onProtect(cookie, !protectedNow);
    }
  });

  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "row-button edit";
  edit.textContent = "Edit";
  edit.title = "Edit this cookie";
  edit.addEventListener("click", () => {
    disarmAll();
    if (handlers.onEdit) {
      handlers.onEdit(cookie);
    }
  });

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "row-button danger";
  remove.textContent = "Delete";

  // A kept cookie can't be deleted from here. Disabled rather than hidden, so
  // the reason is visible instead of the button just not being where it was.
  if (protectedNow) {
    remove.disabled = true;
    remove.title = "Kept cookies aren't deleted. Click Kept to allow it.";
  } else {
    remove.title = "Delete this cookie";
  }

  let armed = false;
  const disarm = () => {
    armed = false;
    remove.textContent = "Delete";
    remove.classList.remove("armed");
  };
  disarmers.push(disarm);

  remove.addEventListener("click", () => {
    if (!armed) {
      disarmAll();
      armed = true;
      remove.textContent = "Sure?";
      remove.classList.add("armed");
      return;
    }
    disarm();
    if (handlers.onDelete) {
      handlers.onDelete(cookie);
    }
  });

  cell.appendChild(keep);
  cell.appendChild(edit);
  cell.appendChild(remove);
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

// A cell whose text may wrap after each `separator`, so a long domain breaks
// as "accounts.example." / "co.uk" rather than at whatever letter reached the
// edge. <wbr> marks where a line may break and is otherwise invisible; it adds
// nothing to textContent. Each piece still goes in as a text node, never as
// HTML, because this is website-controlled input.
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

// Values are often long tokens. Show a preview, and let the user click to
// expand the full value in place.
function valueCell(value) {
  const cell = document.createElement("td");
  cell.className = "mono value";

  const full = value == null ? "" : String(value);
  const needsToggle = full.length > VALUE_PREVIEW_LENGTH;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "value-toggle";
  button.textContent = needsToggle ? truncate(full, VALUE_PREVIEW_LENGTH) : full;

  if (full === "") {
    button.textContent = "(empty)";
    button.classList.add("muted");
    button.disabled = true;
  } else if (needsToggle) {
    button.title = "Click to show the full value";
    button.addEventListener("click", () => {
      const expanded = cell.classList.toggle("expanded");
      button.textContent = expanded ? full : truncate(full, VALUE_PREVIEW_LENGTH);
      button.title = expanded ? "Click to collapse" : "Click to show the full value";
    });
  } else {
    button.disabled = true;
  }

  cell.appendChild(button);
  return cell;
}

function flagsCell(cookie) {
  const cell = document.createElement("td");
  cell.className = "flags";

  if (cookie.secure) {
    cell.appendChild(badge("Secure", "Sent over HTTPS only"));
  }
  if (cookie.httpOnly) {
    cell.appendChild(badge("HttpOnly", "Not readable by page JavaScript"));
  }
  if (cookie.hostOnly) {
    cell.appendChild(badge("HostOnly", "Exact host only, not subdomains"));
  }
  if (cookie.partitionKey) {
    cell.appendChild(badge("Partitioned", "Partitioned (CHIPS) cookie"));
  }

  cell.appendChild(
    badge("SS:" + formatSameSite(cookie.sameSite), "SameSite policy")
  );

  return cell;
}

function badge(text, title) {
  const span = document.createElement("span");
  span.className = "badge";
  span.textContent = text;
  span.title = title;
  return span;
}
