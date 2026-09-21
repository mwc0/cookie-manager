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

export function renderCookieTable(tbody, cookies) {
  tbody.textContent = "";

  const sorted = [...cookies].sort(
    (a, b) => a.domain.localeCompare(b.domain) || a.name.localeCompare(b.name)
  );

  for (const cookie of sorted) {
    tbody.appendChild(buildRow(cookie));
  }
}

function buildRow(cookie) {
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
  return row;
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
