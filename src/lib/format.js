// Formatting for display. Nothing in here calls Chrome or changes anything.

// A cookie with no expiry date is a session cookie, deleted when the browser
// closes.
export function formatExpiry(cookie) {
  if (typeof cookie.expirationDate !== "number") {
    return "Session";
  }

  const date = new Date(cookie.expirationDate * 1000);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// The full date and time, for the tooltip.
export function formatExpiryFull(cookie) {
  if (typeof cookie.expirationDate !== "number") {
    return "Session cookie - removed when the browser closes";
  }

  const date = new Date(cookie.expirationDate * 1000);
  if (Number.isNaN(date.getTime())) {
    return "Expiry date could not be read";
  }

  return "Expires " + date.toLocaleString();
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
