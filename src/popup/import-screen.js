// The Import screen: reads a pasted or chosen file, opens a locked one,
// previews what will be written, writes it, and compares it with the
// cookies those sites have now.

import {
  getCookiesForDomain,
  writeCookie,
  getAllCookies,
  cookieKey,
} from "../lib/cookies.js";
import {
  parseImport,
  planImport,
  matchSentCookies,
  isForSite,
  moveToSite,
  compareCookies,
} from "../lib/transfer.js";
import { unlockText, readLockedFile } from "../lib/crypto.js";
import { isProtected } from "../lib/protect.js";
import { formatCount, describeError, bareDomain } from "../lib/format.js";
import { t, tn } from "../lib/i18n.js";
import { state } from "./state.js";
import { el, inTab, inPanel, showState } from "./ui.js";
import { refresh } from "./popup.js";
import { describeExpiryChange } from "./editor.js";
import { offerUndo, appendReloadButton, offerStoredUndo } from "./undo-button.js";

// --- import ----------------------------------------------------------------

// What the preview said will be written. Import writes exactly this list.
let importPlan = null;

// Every cookie the preview read from the file, for Compare. Unlike
// importPlan, this includes the ones that won't be written, such as
// expired ones, so Compare can say they're gone.
let importEntries = null;

// What's inside a password-protected export, once opened, so ticking "Put
// them on this site instead" doesn't ask for the password again. Only ever
// in memory, and forgotten as soon as the pasted text changes.
let unlockedText = null;

// Forgets the password and anything opened with it.
export function forgetImportPassword() {
  unlockedText = null;
  el("import-password").value = "";
  el("import-password-show").checked = false;
  el("import-password").type = "password";
  el("import-password-row").hidden = true;
}

export function openImport() {
  el("main-message").textContent = "";
  forgetImportPassword();
  el("import-move").checked = false;
  // The side panel stays open while a file is chosen, like a tab does.
  el("import-file-row").hidden = !(inTab || inPanel);
  el("import-file-hint").hidden = inTab || inPanel;
  resetImportPreview();
  el("import-result").hidden = true;
  el("import-failures").hidden = true;
  showState("import");
  el("import-text").focus();
}

export function resetImportPreview() {
  importPlan = null;
  importEntries = null;
  el("import-preview").hidden = true;
}

// A password-protected export: asks for the password, then opens it.
// Returns what's inside, or null after saying why it can't be opened yet.
// A damaged file is reported before any password is asked for.
async function openLockedImport() {
  if (unlockedText !== null) {
    return unlockedText;
  }
  const text = el("import-text").value;
  const { error } = readLockedFile(text);
  if (error) {
    el("import-password-row").hidden = true;
    showImportResult(error, true);
    return null;
  }

  const box = el("import-password");
  el("import-password-row").hidden = false;
  if (box.value === "") {
    showImportResult(t("transfer_typePassword"), false);
    box.focus();
    return null;
  }

  // Opening takes a moment: the password goes through 600,000 rounds.
  const password = box.value;
  box.value = "";
  const check = el("import-check");
  check.disabled = true;
  showImportResult(t("transfer_opening"), false);
  const result = await unlockText(text, password);
  check.disabled = false;

  if (!result.ok) {
    showImportResult(result.error, true);
    box.focus();
    return null;
  }
  el("import-result").hidden = true;
  forgetImportPassword();
  unlockedText = result.text;
  return unlockedText;
}

function fillList(list, items) {
  list.textContent = "";
  for (const text of items) {
    const item = document.createElement("li");
    item.textContent = text; // comes from a file, so never innerHTML
    list.appendChild(item);
  }
  list.hidden = items.length === 0;
}

export async function checkImport() {
  el("import-result").hidden = true;
  el("import-failures").hidden = true;
  resetImportPreview();

  const pageUrl = state.page.origin + "/";
  let parsed = parseImport(el("import-text").value, { pageUrl });
  if (parsed.format === "locked") {
    const text = await openLockedImport();
    if (text === null) {
      return;
    }
    parsed = parseImport(text, { pageUrl });
  }
  let entries = parsed.entries;
  let problems = parsed.problems;

  // Cookies from another site can be put on this one instead, such as from
  // a staging site to localhost. Only offered when some are from elsewhere.
  const elsewhere = entries.some((entry) => !isForSite(entry, state.page.hostname));
  el("import-move-site").textContent = state.page.hostname;
  el("import-move-row").hidden = !elsewhere;
  if (elsewhere && el("import-move").checked) {
    const moved = moveToSite(entries, pageUrl);
    entries = moved.entries;
    problems = [...problems, ...moved.problems];
  }

  let existing;
  try {
    existing = await getAllCookies();
  } catch (error) {
    showImportResult(t("transfer_cantReadCurrent", describeError(error)), true);
    return;
  }

  // A Cookie header or curl command only has names and values. The rest
  // comes from the cookies the site already has.
  entries = matchSentCookies(entries, existing);
  const fromHeader = parsed.format === "header" || parsed.format === "curl";

  const plan = planImport(
    entries,
    existing,
    (cookie) => isProtected(state.protectedKeys, cookie),
    Date.now() / 1000
  );

  const count = plan.toWrite.length;
  const replacing = plan.toWrite.filter((item) => item.replaces).length;
  const kept = plan.toWrite.filter((item) => item.kept).length;

  const parts = [];
  if (count === 0) {
    parts.push(t("transfer_nothingCanBeImported"));
  } else {
    parts.push(
      plan.domains.length === 1
        ? tn("transfer_willAddForSite", count, plan.domains[0])
        : tn("transfer_willAddAcrossSites", count, tn("transfer_siteCount", plan.domains.length))
    );
    if (replacing > 0) {
      parts.push(tn("transfer_replaces", replacing));
      if (fromHeader) {
        parts.push(tn("transfer_onlyValueChanges", replacing));
      }
    }
    const adding = count - replacing;
    if (fromHeader && adding > 0) {
      parts.push(tn("transfer_newSessionCookies", adding));
    }
    if (kept > 0) {
      parts.push(tn("transfer_keptInImport", kept));
    }
  }
  if (plan.expired > 0) {
    parts.push(tn("transfer_alreadyExpired", plan.expired));
  }
  if (plan.duplicates > 0) {
    parts.push(tn("transfer_duplicates", plan.duplicates));
  }
  el("import-summary").textContent = parts.join(" ");

  if (plan.domains.length > 1) {
    fillList(el("import-domains-list"), plan.domains);
    el("import-domains-summary").textContent = tn("transfer_showSites", plan.domains.length);
    el("import-domains").open = false;
    el("import-domains").hidden = false;
  } else {
    el("import-domains").hidden = true;
  }

  const skipped = [...problems, ...plan.invalid.map((text) => t("transfer_willBeSkipped", text))];
  fillList(el("import-problems"), skipped);

  // Said every time, next to the button that writes: a file of someone
  // else's cookies is a known way to trick people.
  el("import-warning").hidden = count === 0;
  el("import-confirm").textContent = tn("transfer_importButton", count);
  // Compare works on anything that was read, even if nothing can be
  // imported, so the row shows whenever there's a cookie in the file.
  el("import-confirm").hidden = count === 0;
  el("import-confirm-row").hidden = entries.length === 0;
  el("import-preview").hidden = false;
  importPlan = count > 0 ? plan : null;
  importEntries = entries.length > 0 ? entries : null;
  if (importPlan) {
    el("import-confirm").focus();
  }
}

// --- compare with an export ---------------------------------------------------

// Shows how the file read by the preview differs from the cookies the same
// sites have now. Read only: nothing is written. It asks Chrome again,
// rather than reusing what Check read, so it's up to date.
export async function compareImport() {
  if (!importEntries) {
    return;
  }
  const domains = Array.from(new Set(importEntries.map((entry) => bareDomain(entry.domain))));

  let current;
  try {
    const lists = await Promise.all(domains.map((domain) => getCookiesForDomain(domain)));
    // A file with example.com and www.example.com would find the
    // www cookies twice.
    const byKey = new Map();
    for (const cookie of lists.flat()) {
      byKey.set(cookieKey(cookie), cookie);
    }
    current = Array.from(byKey.values());
  } catch (error) {
    showImportResult(t("transfer_cantReadCurrent", describeError(error)), true);
    return;
  }

  const result = compareCookies(importEntries, current);
  const differences = result.gone.length + result.added.length + result.changed.length;

  if (differences === 0) {
    el("compare-summary").textContent = tn("transfer_compareSame", result.same);
  } else {
    // One sentence for each mix of new, gone and changed, so each can be
    // translated whole: transfer_compareNew, transfer_compareNewGone,
    // transfer_compareNewGoneChanged, transfer_compareNewChanged,
    // transfer_compareGone, transfer_compareGoneChanged and
    // transfer_compareChanged. Each is given all four counts.
    const key =
      "transfer_compare" +
      (result.added.length > 0 ? "New" : "") +
      (result.gone.length > 0 ? "Gone" : "") +
      (result.changed.length > 0 ? "Changed" : "");
    el("compare-summary").textContent = t(
      key,
      formatCount(result.added.length),
      formatCount(result.gone.length),
      formatCount(result.changed.length),
      formatCount(result.same)
    );
  }

  // Names and sites only, never values: the values may be sign-ins.
  const rows = [
    ...result.added.map((cookie) => [cookie, t("transfer_rowNewSince")]),
    ...result.gone.map((entry) => [entry, t("transfer_rowGone")]),
    ...result.changed.map((item) => [item.cookie, t("transfer_rowChanged", item.differences.join(", "))]),
  ];
  const body = el("compare-rows");
  body.textContent = "";
  for (const [cookie, what] of rows) {
    const row = document.createElement("tr");
    const cells = [
      [cookie.name, "mono changes-name"],
      [bareDomain(cookie.domain), "mono changes-site"],
      [what, "changes-what"],
    ];
    for (const [text, className] of cells) {
      const cell = document.createElement("td");
      cell.className = className;
      cell.textContent = text; // comes from a file, so never innerHTML
      row.appendChild(cell);
    }
    body.appendChild(row);
  }
  el("compare-wrap").hidden = rows.length === 0;

  showState("compare");
  el("compare-back").focus();
}

export function closeCompare() {
  el("compare-rows").textContent = "";
  showState("import");
  el("import-compare").focus();
}

function showImportResult(text, isError) {
  const result = el("import-result");
  result.textContent = text;
  result.className = isError ? "result error" : "result";
  result.hidden = false;
}

export async function runImport() {
  if (!importPlan) {
    return;
  }
  const plan = importPlan;
  resetImportPreview();
  showImportResult(t("transfer_importing"), false);

  let created = 0;
  let replaced = 0;
  let shortened = 0;
  const failures = [];
  // For Undo: the cookies this import replaced, and the ones it added.
  const change = { kind: "import", restore: [], remove: [] };

  // One at a time, so the result for each cookie is known.
  for (const { entry, replaces, match } of plan.toWrite) {
    const { ok, cookie, error } = await writeCookie(null, entry);
    if (!ok) {
      failures.push(entry.name + " (" + entry.domain + "): " + error);
      continue;
    }
    if (replaces) {
      replaced += 1;
      change.restore.push(match);
    } else {
      created += 1;
      change.remove.push(cookie);
    }
    if (describeExpiryChange(entry, cookie)) {
      shortened += 1;
    }
  }

  const parts = [
    replaced > 0
      ? tn("transfer_importedReplaced", created + replaced, formatCount(replaced))
      : tn("transfer_imported", created + replaced),
  ];
  if (shortened > 0) {
    parts.push(tn("transfer_expiryShortened", shortened));
  }
  if (failures.length > 0) {
    parts.push(tn("transfer_chromeRefused", failures.length));
  }
  showImportResult(parts.join(" "), failures.length > 0);
  await offerUndo(el("import-result"), change);
  if (change.remove.length + change.restore.length > 0) {
    appendReloadButton(el("import-result"));
  }
  fillList(el("import-failures"), failures);
}

export async function readImportFile() {
  const file = el("import-file").files[0];
  if (!file) {
    return;
  }
  try {
    el("import-text").value = await file.text();
    forgetImportPassword();
    await checkImport();
  } catch (error) {
    showImportResult(t("transfer_cantReadFile", file.name, describeError(error)), true);
  }
}

// Back on the main screen, an import made just now can be undone from the
// status line, like any other change.
export async function closeImport() {
  forgetImportPassword();
  showState("main");
  await refresh();
  await offerStoredUndo();
}
