// Formatting for display. Nothing in here calls Chrome or changes anything.

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

// Within this, the expiry is shown as "in 3 days" rather than a date.
const RELATIVE_WITHIN = 30 * DAY;

// A cookie with no expiry date is a session cookie, deleted when the browser
// closes. One that expires within 30 days says how soon: "in 3 days".
export function formatExpiry(cookie, now = Date.now() / 1000) {
  if (typeof cookie.expirationDate !== "number") {
    return "Session";
  }

  const date = new Date(cookie.expirationDate * 1000);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  const relative = formatRelative(cookie.expirationDate - now);
  if (relative) {
    return relative;
  }

  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// The full date and time, for the tooltip, with "in 3 days" when it's soon.
export function formatExpiryFull(cookie, now = Date.now() / 1000) {
  if (typeof cookie.expirationDate !== "number") {
    return "Session cookie - removed when the browser closes";
  }

  const date = new Date(cookie.expirationDate * 1000);
  if (Number.isNaN(date.getTime())) {
    return "Expiry date could not be read";
  }

  const relative = formatRelative(cookie.expirationDate - now);
  return "Expires " + date.toLocaleString() + (relative ? " (" + relative + ")" : "");
}

// Whether a cookie expires within the next day.
export function expiresSoon(cookie, now = Date.now() / 1000) {
  if (typeof cookie.expirationDate !== "number") {
    return false;
  }
  const left = cookie.expirationDate - now;
  return left > 0 && left < DAY;
}

// "in 5 minutes", "in 5 hours", "in 3 days", or "" when it's not within 30
// days. Uses the browser's own wording for the user's language.
function formatRelative(secondsLeft) {
  if (!(secondsLeft > 0) || secondsLeft >= RELATIVE_WITHIN) {
    return "";
  }
  const words = new Intl.RelativeTimeFormat(undefined, { numeric: "always" });
  if (secondsLeft < HOUR) {
    return words.format(Math.max(1, Math.round(secondsLeft / 60)), "minute");
  }
  if (secondsLeft < DAY) {
    return words.format(Math.round(secondsLeft / HOUR), "hour");
  }
  return words.format(Math.round(secondsLeft / DAY), "day");
}

// Chrome's SameSite names differ from the ones in a Set-Cookie header, so
// show the familiar ones.
export function formatSameSite(value) {
  switch (value) {
    case "no_restriction":
      return "None";
    case "lax":
      return "Lax";
    case "strict":
      return "Strict";
    case "unspecified":
      return "Unset";
    default:
      return value || "Unset";
  }
}

// --- the expiry field --------------------------------------------------
//
// The date input uses local time as "YYYY-MM-DDTHH:mm". Chrome uses seconds
// since 1970. These two convert between them. toISOString() isn't used
// because it converts to UTC, which would shift the time the user sees.
export function toLocalDateTimeValue(expirationDate) {
  if (typeof expirationDate !== "number") {
    return "";
  }

  const date = new Date(expirationDate * 1000);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const pad = (number) => String(number).padStart(2, "0");
  return (
    date.getFullYear() +
    "-" +
    pad(date.getMonth() + 1) +
    "-" +
    pad(date.getDate()) +
    "T" +
    pad(date.getHours()) +
    ":" +
    pad(date.getMinutes())
  );
}

// Returns null if the field is empty or can't be read.
export function fromLocalDateTimeValue(text) {
  if (!text) {
    return null;
  }

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return Math.floor(date.getTime() / 1000);
}

// A cookie value made easier to read, for the editor's Decoded panel:
// URL-encoding ("%7B%22a%22") undone, and JSON laid out on separate lines.
// Returns null when decoding wouldn't change anything.
//
// JWTs ("eyJ...") are left alone. Decoding those is a paid-tier feature
// (see docs/SPEC.md), and they're neither URL-encoded nor JSON as they
// stand, so they come back as null here.
export function decodeValue(value) {
  const original = String(value == null ? "" : value);
  let text = original;

  if (/%[0-9a-f]{2}/i.test(text)) {
    try {
      text = decodeURIComponent(text);
    } catch (error) {
      // Not valid URL-encoding after all, such as a lone "%". Leave it.
      text = original;
    }
  }

  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      text = JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch (error) {
      // Looks like JSON but isn't. Show it as it is.
    }
  }

  return text === original ? null : text;
}

export function truncate(text, max) {
  const value = String(text == null ? "" : text);
  if (value.length <= max) {
    return value;
  }
  return value.slice(0, max) + "…";
}

// --- sizes -------------------------------------------------------------
//
// Sizes are in bytes as sent over the network, so a character outside plain
// ASCII counts as more than one.

const encoder = new TextEncoder();

function byteLength(text) {
  return encoder.encode(String(text == null ? "" : text)).length;
}

// Chrome refuses a cookie whose name and value add up to more than 4,096
// bytes. A cookie this close to it gets a "Large" badge, and the editor
// starts showing its size.
export const LARGE_COOKIE_BYTES = 3500;

// Chrome's limit applies to a cookie's name and value together.
export function cookieBytes(cookie) {
  return byteLength(cookie.name) + byteLength(cookie.value);
}

// The size of the Cookie header these cookies make: "a=1; b=2".
export function headerBytes(cookies) {
  if (cookies.length === 0) {
    return 0;
  }
  const pairs = cookies.reduce((total, cookie) => total + cookieBytes(cookie) + 1, 0);
  return pairs + 2 * (cookies.length - 1);
}

// "812 bytes", "3.1 KB"
export function formatBytes(bytes) {
  if (bytes < 1024) {
    return formatCount(bytes) + (bytes === 1 ? " byte" : " bytes");
  }
  return (bytes / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 }) + " KB";
}

export function formatCount(number) {
  return number.toLocaleString();
}

// "1 cookie", "14 cookies"
export function pluralise(count, singular, plural) {
  return formatCount(count) + " " + (count === 1 ? singular : plural);
}
