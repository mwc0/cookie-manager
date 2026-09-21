// Host permission handling.
//
// The "cookies" permission on its own is not enough to read a single cookie.
// Chrome also requires host permission for the site a cookie belongs to.
// We keep "*://*/*" out of the manifest and in optional_host_permissions so
// the install screen stays clean, then ask for it at runtime.
//
// The important trap: without host permission, chrome.cookies.getAll() does
// NOT throw. It quietly returns an empty array, which looks exactly like
// "this site has no cookies". Everything that reads cookies must therefore
// check hasHostAccess() first, so we can tell the user which situation
// they're actually in.

export const ALL_SITES = "*://*/*";

// Does the user already have us covered for all sites?
export async function hasHostAccess() {
  try {
    return await chrome.permissions.contains({ origins: [ALL_SITES] });
  } catch (error) {
    // If even the check fails, treat it as "no access" and let the UI show
    // the grant screen rather than an empty cookie list.
    console.warn("Permission check failed:", error);
    return false;
  }
}

// Ask for access. This MUST be called directly from a click handler --
// Chrome rejects permission requests that aren't tied to a user gesture.
//
// Returns { granted, error }. A denial is not an error; it's a normal answer
// that the UI needs to handle readably.
export async function requestHostAccess() {
  try {
    const granted = await chrome.permissions.request({ origins: [ALL_SITES] });
    return { granted, error: null };
  } catch (error) {
    return { granted: false, error: describeRequestFailure(error) };
  }
}

function describeRequestFailure(error) {
  const message = error && error.message ? error.message : String(error);

  if (message.includes("user gesture")) {
    return "Chrome only allows the permission prompt to open from a direct click. Please click the button again.";
  }
  return "Chrome couldn't show the permission prompt: " + message;
}
