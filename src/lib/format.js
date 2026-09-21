// Display helpers. Pure functions -- no chrome API calls, no side effects,
// so these are the easy ones to reason about and change.

// Cookies without an expirationDate are session cookies: they die when the
// browser closes. Keeping that distinction visible matters, because writing an
// expiry onto a session cookie silently makes it permanent.
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

// The full timestamp, for the row's tooltip.
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

// Chrome's internal SameSite names aren't the ones developers know from the
// Set-Cookie header, so translate them back.
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

export function truncate(text, max) {
  const value = String(text == null ? "" : text);
  if (value.length <= max) {
    return value;
  }
  return value.slice(0, max) + "…";
}

export function formatCount(number) {
  return number.toLocaleString();
}

// "1 cookie" / "14 cookies"
export function pluralise(count, singular, plural) {
  return formatCount(count) + " " + (count === 1 ? singular : plural);
}
