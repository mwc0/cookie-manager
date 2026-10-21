// The Export screen: builds the export in the chosen format, locks it with
// a password if one is typed, and copies or downloads it.

import { setByOtherSite, baseHostOf, sitesOf } from "../lib/cookies.js";
import {
  toJson,
  toNetscape,
  toHeader,
  toPlaywright,
  toCurl,
  toSelenium,
  looksLikeSignIn,
} from "../lib/transfer.js";
import { lockText } from "../lib/crypto.js";
import { copyWithFeedback } from "./clipboard.js";
import { pluralise, describeError } from "../lib/format.js";
import { knownCookie } from "../lib/known.js";
import { state } from "./state.js";
import { el, showState, describeSites } from "./ui.js";
import { selectedScope } from "./popup.js";

// --- export ----------------------------------------------------------------

function selectedFormat() {
  const checked = document.querySelector('input[name="format"]:checked');
  return checked ? checked.value : "json";
}

// The export for the chosen format, and the file name to download it as.
function buildExport() {
  const format = selectedFormat();
  const date = new Date().toISOString().slice(0, 10);
  const scopeName = {
    page: state.page.hostname,
    domain: baseHostOf(state.page.hostname),
    all: "all-sites",
    matches: state.page.hostname + "-search",
    picked: state.page.hostname + "-ticked",
  }[selectedScope()];
  const base = "cookies-" + scopeName + "-" + date;

  if (format === "netscape") {
    return { text: toNetscape(state.scopeAll), filename: base + ".txt", type: "text/plain" };
  }
  // A Cookie header and curl are what the browser sends to this page, and
  // a cookie another company keeps for this site is only sent to that
  // company, so those two leave it out.
  const sentHere = state.scopeAll.filter((cookie) => !setByOtherSite(cookie, state.page.hostname));
  if (format === "header") {
    return { text: toHeader(sentHere), filename: base + "-header.txt", type: "text/plain" };
  }
  if (format === "curl") {
    return { text: toCurl(sentHere, state.page.origin + "/"), filename: base + "-curl.sh", type: "text/plain" };
  }
  if (format === "playwright") {
    return { text: toPlaywright(state.scopeAll), filename: base + "-playwright.json", type: "application/json" };
  }
  if (format === "selenium") {
    return { text: toSelenium(state.scopeAll), filename: base + "-selenium.py", type: "text/plain" };
  }
  return { text: toJson(state.scopeAll), filename: base + ".json", type: "application/json" };
}

// Selenium code has to stay readable to run, and cookieZ can't import it,
// so a password would only make it useless. Every other format can be
// locked, because cookieZ can import each of them back.
function formatCanBeLocked() {
  return selectedFormat() !== "selenium";
}

// The password box is off for Selenium, and says why. The sign-in warning
// shows while the export has cookies that look like sign-ins and nothing
// will lock it.
function showExportPassword() {
  const box = el("export-password");
  const lockable = formatCanBeLocked();
  box.disabled = !lockable;
  if (!lockable) {
    box.value = "";
  }
  el("export-password-note").textContent = lockable
    ? "Locks the file, so it can only be imported with this password. The password isn't saved anywhere, so don't lose it."
    : "Selenium code can't have a password: it has to stay readable to run. Choose another format to lock the file.";

  const signIns = state.scopeAll.some((cookie) => looksLikeSignIn(cookie, knownCookie(cookie.name)));
  el("export-warning").hidden = !signIns || box.value !== "";
}

const LOCKED_NOTE =
  "Locked with your password. You'll need the password to import it, and it isn't saved anywhere.";

// The export as it will be copied or saved. With a password, it's locked
// first, which takes a moment, so "Encrypting…" shows meanwhile. Then the
// password box is emptied, so the password isn't kept.
// Returns null if it couldn't be locked, having said why.
async function finishExport() {
  const built = buildExport();
  const password = el("export-password").value;
  if (password === "" || !formatCanBeLocked()) {
    return built;
  }

  const buttons = [el("export-copy"), el("export-download")];
  for (const button of buttons) {
    button.disabled = true;
  }
  showExportResult("Encrypting…", false);
  try {
    const locked = await lockText(built.text, password);
    el("export-password").value = "";
    showExportPassword();
    // Shows what was copied or saved.
    el("export-output").value = locked;
    showExportResult(LOCKED_NOTE, false);
    return {
      text: locked,
      filename: built.filename.replace(/\.[a-z]+$/, "") + "-locked.json",
      type: "application/json",
      locked: true,
    };
  } catch (error) {
    showExportResult("Couldn't lock the export: " + describeError(error), true);
    return null;
  } finally {
    for (const button of buttons) {
      button.disabled = false;
    }
  }
}

function showExportResult(text, isError) {
  const result = el("export-result");
  result.className = isError ? "result error" : "result";
  result.textContent = text;
  result.hidden = false;
}

export async function copyExport() {
  const finished = await finishExport();
  if (finished) {
    await copyWithFeedback(el("export-copy"), finished.text);
  }
}

// Leaving the screen forgets any password typed but not used.
export function closeExport() {
  el("export-password").value = "";
  showState("main");
}

export function openExport() {
  const sites = sitesOf(state.scopeAll);
  const kept = state.scopeAll.length - state.scopeCookies.length;

  el("export-summary").textContent =
    pluralise(state.scopeAll.length, "cookie", "cookies") +
    describeSites(sites) +
    (kept > 0 ? ", including " + pluralise(kept, "kept cookie", "kept cookies") : "") +
    ".";

  // The Cookie header and curl both send cookies to one page, so they're
  // only offered when the cookies are one page's.
  const onePage = exportIsOnePage(sites);
  const onePageFormats = [
    ["header", "Names and values only, as a browser sends them to this page."],
    ["curl", "Sends these cookies to this page, for bash or zsh."],
  ];
  for (const [format, note] of onePageFormats) {
    const radio = document.querySelector('input[name="format"][value="' + format + '"]');
    radio.disabled = !onePage;
    el(format + "-note").textContent = onePage
      ? note
      : "Only for the cookies of one page. Choose “This page” to use it.";
    if (!onePage && radio.checked) {
      document.querySelector('input[name="format"][value="json"]').checked = true;
    }
  }

  el("export-result").hidden = true;
  el("main-message").textContent = "";
  el("export-password").value = "";
  el("export-password-show").checked = false;
  el("export-password").type = "password";
  showExportText();
  showState("export");
  el("export-copy").focus();
}

// Whether the cookies being exported are what a browser sends to one page.
// "This page" (and a search within it) is exactly that set, even when it
// mixes example.com and www.example.com cookies. The wider scopes only
// qualify when every cookie has the same domain.
function exportIsOnePage(sites) {
  return (
    selectedScope() === "page" ||
    selectedScope() === "matches" ||
    selectedScope() === "picked" ||
    sites.length <= 1
  );
}

export function showExportText() {
  el("export-output").value = buildExport().text;
  showExportPassword();
}

export async function downloadExport() {
  const finished = await finishExport();
  if (!finished) {
    return;
  }
  const { text, filename, type, locked } = finished;

  // A download made from the page itself. No downloads permission needed.
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);

  showExportResult(
    "Saving as " + filename + "." + (locked ? " " + LOCKED_NOTE : ""),
    false
  );
}
