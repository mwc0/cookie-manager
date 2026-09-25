// Access to websites. The "cookies" permission alone can't read any cookies:
// Chrome also needs permission for each cookie's site. We ask for all sites
// when the popup is first opened, rather than at install.
//
// Watch out: without that permission, chrome.cookies.getAll() doesn't fail.
// It returns an empty list, which looks the same as "this site has no
// cookies". So always check hasHostAccess() before reading cookies.

export const ALL_SITES = "*://*/*";

export async function hasHostAccess() {
  try {
    return await chrome.permissions.contains({ origins: [ALL_SITES] });
  } catch (error) {
    // Treat a failed check as "no access", so the user sees the grant screen
    // and not an empty list.
    console.warn("Permission check failed:", error);
    return false;
  }
}

// Must be called straight from a click, or Chrome refuses to show the
// prompt. Returns { granted, error }. The user saying no isn't an error.
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
