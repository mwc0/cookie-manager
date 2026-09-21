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

const VALUE_PREVIEW_LENGTH = 48;

// `handlers` is { onEdit(cookie), onDelete(cookie) }. onDelete is only called
// once the user has confirmed, which this file handles: a single delete gets
// a two-click arm rather than a dialog, so nothing goes without a deliberate
// second click but there's no modal to dismiss either.
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

  row.appendChild(textCell(cookie.name, "mono name"));
  row.appendChild(valueCell(cookie.value));
  row.appendChild(textCell(cookie.domain, "mono"));
  row.appendChild(textCell(cookie.path, "mono"));

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

  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "row-button";
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
  remove.title = "Delete this cookie";

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
