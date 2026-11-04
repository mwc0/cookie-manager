// The New cookie / Edit cookie screen: filling in the form, the value's
// decoded and JSON views, duplicating, and saving.

import { BLOCK } from "../lib/rules.js";
import {
  setByOtherSite,
  writeCookie,
  validateCookieValues,
  baseHostOf,
  cookieKey,
  MAX_COOKIE_BYTES,
} from "../lib/cookies.js";
import { toSetCookie } from "../lib/transfer.js";
import { copyWithFeedback } from "./clipboard.js";
import {
  cookieBytes,
  LARGE_COOKIE_BYTES,
  formatExpiryWhen,
  toLocalDateTimeValue,
  fromLocalDateTimeValue,
  describeValue,
  isJsonValue,
  isCompactJson,
  prettyJson,
  compactJson,
  describeError,
  bareDomain,
  formatCount,
} from "../lib/format.js";
import { t } from "../lib/i18n.js";
import { knownCookie, describeKnown } from "../lib/known.js";
import { state } from "./state.js";
import { el, showState, showMainMessage } from "./ui.js";
import { refresh } from "./popup.js";
import { pageRule } from "./rules-screen.js";
import { offerUndo } from "./undo-button.js";

// --- create / edit ---------------------------------------------------------

// After Duplicate on a partitioned cookie, the partition the copy goes in.
// Otherwise null.
let duplicatePartition = null;

// Opens the editor. `cookie` is the one to edit, or null for a new one.
export function openEditor(cookie) {
  state.editing = cookie || null;

  el("main-message").textContent = "";
  el("edit-title").textContent = cookie ? t("cookie_editTitleEdit") : t("cookie_editTitleNew");
  el("edit-errors").hidden = true;
  el("edit-errors").textContent = "";
  el("edit-changed").hidden = true;
  el("edit-rule-note").hidden = pageRule() !== BLOCK;

  const isNew = !cookie;
  const secure = isNew ? state.page.origin.startsWith("https:") : Boolean(cookie.secure);

  el("field-name").value = isNew ? "" : cookie.name;
  const value = isNew ? "" : cookie.value;
  const asJson = isCompactJson(value);
  el("field-json").checked = asJson;
  el("field-value").value = asJson ? prettyJson(value) : value;
  showJsonChoice();

  // A domain-wide cookie is stored with a leading dot (".example.com"). The
  // dot is hidden here because the Host-only checkbox already shows that.
  // buildSetDetails() puts it back when saving.
  el("field-domain").value = isNew
    ? state.page.hostname
    : bareDomain(cookie.domain);
  el("field-path").value = isNew ? "/" : cookie.path || "/";

  el("field-samesite").value = isNew ? "unspecified" : cookie.sameSite || "unspecified";
  el("field-secure").checked = secure;
  el("field-httponly").checked = isNew ? false : Boolean(cookie.httpOnly);

  // New cookies start as host-only, the same as a website's default.
  el("field-hostonly").checked = isNew ? true : Boolean(cookie.hostOnly);

  // New cookies start as session cookies, so nothing permanent is left behind
  // by accident.
  const isSession = isNew || typeof cookie.expirationDate !== "number";
  el("field-session").checked = isSession;
  el("field-expiry").value = isSession
    ? ""
    : toLocalDateTimeValue(cookie.expirationDate);
  syncExpiryEnabled();

  // A partitioned cookie keeps its partition when saved. The partition can't
  // be edited here.
  const partition = el("edit-partition");
  if (cookie && setByOtherSite(cookie, state.page.hostname)) {
    partition.textContent = t("cookie_editPartitionEmbedded", bareDomain(cookie.domain));
    partition.hidden = false;
  } else if (cookie && cookie.partitionKey) {
    partition.textContent = t("cookie_editPartitioned");
    partition.hidden = false;
  } else {
    partition.hidden = true;
  }

  // A new cookie can be partitioned (CHIPS): kept for this site only. An
  // existing cookie's partition can't be changed, so the box is only for
  // new ones.
  duplicatePartition = null;
  el("field-partitioned").checked = false;
  el("partitioned-site").textContent = baseHostOf(state.page.hostname);
  el("partitioned-row").hidden = !isNew;

  el("edit-duplicate").hidden = isNew;

  showDecoded();
  showValueSize();
  showKnownName();
  showState("edit");
  el("field-name").focus();
}

// One line under the name when the Open Cookie Database knows it, kept up
// to date as the name is typed.
export function showKnownName() {
  const known = knownCookie(el("field-name").value);
  el("name-known").hidden = !known;
  el("name-known-text").textContent = known ? describeKnown(known) : "";
}

// Says how big the cookie is once it's close to Chrome's limit, and turns
// red once it's over. Updated as the name or value is typed.
export function showValueSize() {
  const bytes = cookieBytes({ name: el("field-name").value, value: valueToSave().value || el("field-value").value });
  const note = el("value-size");
  note.hidden = bytes < LARGE_COOKIE_BYTES;
  note.textContent = t("cookie_editValueSize", formatCount(bytes), formatCount(MAX_COOKIE_BYTES));
  note.className = bytes > MAX_COOKIE_BYTES ? "field-note error" : "field-note muted";
}

// The expiry shortcuts. Each sets the date that many seconds from now.
export function expireIn(seconds) {
  el("field-session").checked = false;
  syncExpiryEnabled();
  el("field-expiry").value = toLocalDateTimeValue(Date.now() / 1000 + seconds);
}

// Turns the editor into a new cookie with the details already filled in,
// including anything typed since it was opened. The cookie being edited is
// left alone. Saving goes the usual way, so Undo works on it.
//
// A partitioned cookie's copy goes in the same partition, with the box
// ticked. Unticking it makes an ordinary cookie instead.
export function duplicateCookie() {
  if (state.editing && state.editing.partitionKey) {
    duplicatePartition = state.editing.partitionKey;
    el("field-partitioned").checked = true;
    const site = String(state.editing.partitionKey.topLevelSite || "").replace(/^https?:\/\//, "");
    el("partitioned-site").textContent = site || baseHostOf(state.page.hostname);
  }
  el("partitioned-row").hidden = false;
  state.editing = null;
  el("edit-title").textContent = t("cookie_editTitleNew");
  el("edit-duplicate").hidden = true;
  el("edit-changed").hidden = true;
  showFormErrors([]);

  const name = el("field-name");
  name.value = name.value.trim() + "_copy";
  showValueSize();
  name.focus();
  name.select();
}

// Shows the value decoded, laid out or as a date, when that's easier to
// read. Updated as the value is typed. See describeValue() in format.js.
// Not while editing as JSON: the box above already shows it laid out.
export function showDecoded() {
  const shown = el("field-json").checked ? null : describeValue(el("field-value").value);
  el("value-decoded").hidden = shown === null;
  el("value-decoded-label").textContent = shown ? shown.label : t("cookie_valueDecoded");
  el("value-decoded-text").textContent = shown ? shown.text : "";
}

// --- editing a value as JSON ---------------------------------------------

// The value as it will be saved: on one line again if it's being edited as
// JSON. Returns { value, error }; error is set if that JSON doesn't parse.
export function valueToSave() {
  const text = el("field-value").value;
  return el("field-json").checked ? compactJson(text) : { value: text, error: null };
}

// "Edit as JSON" is offered while the value is JSON, and stays while it's
// ticked, so a typing mistake doesn't make it vanish.
export function showJsonChoice() {
  el("value-json-row").hidden = !el("field-json").checked && !isJsonValue(el("field-value").value);
}

// Ticking lays the value out. Unticking puts it back on one line, unless
// it no longer parses, in which case it's left as typed.
export function toggleJson() {
  const box = el("field-value");
  if (el("field-json").checked) {
    if (isJsonValue(box.value)) {
      box.value = prettyJson(box.value.trim());
    }
  } else {
    const compact = compactJson(box.value);
    if (!compact.error) {
      box.value = compact.value;
    }
  }
  showJsonChoice();
  showDecoded();
  showValueSize();
}

// Copies the cookie in the editor as a Set-Cookie line, as it would be saved.
export function copySetCookie() {
  const values = readForm();
  copyWithFeedback(el("edit-setcookie"), toSetCookie({
    ...values,
    domain: values.domain,
    expirationDate: values.session ? null : values.expirationDate,
  }));
}

// Focus goes back to the cookie's row, for anyone using the keyboard.
export function closeEditor() {
  const key = state.editing ? cookieKey(state.editing) : null;
  state.editing = null;
  showState("main");
  const row = key ? [...el("cookie-rows").rows].find((r) => r.dataset.key === key) : null;
  if (row) {
    row.focus();
  }
}

// No expiry date while "Session cookie" is ticked.
export function syncExpiryEnabled() {
  el("field-expiry").disabled = el("field-session").checked;
}

function readForm() {
  const session = el("field-session").checked;

  return {
    name: el("field-name").value.trim(),
    value: valueToSave().value ?? el("field-value").value,
    domain: el("field-domain").value.trim(),
    path: el("field-path").value.trim() || "/",
    sameSite: el("field-samesite").value,
    secure: el("field-secure").checked,
    httpOnly: el("field-httponly").checked,
    hostOnly: el("field-hostonly").checked,
    session,
    expirationDate: session ? null : fromLocalDateTimeValue(el("field-expiry").value),
    storeId: state.editing ? state.editing.storeId : undefined,
    partitionKey: state.editing ? state.editing.partitionKey : newPartitionKey(),
  };
}

// The partition for a new cookie with "Partitioned" ticked: the copied
// cookie's for a duplicate, otherwise this site's. See partitionSites().
function newPartitionKey() {
  if (!el("field-partitioned").checked) {
    return undefined;
  }
  return duplicatePartition || { topLevelSite: partitionSites()[0] };
}

// Chrome only takes a partition named after a site, such as
// https://example.com: not https://www.example.com, and with no port. It
// refuses any other without saying why. Working out the site for certain
// needs the list of public suffixes (example.co.uk is a site, co.uk isn't),
// which cookieZ doesn't carry. So these are the page's host and each of its
// parent domains, longest first, and saveEditor() keeps the first one Chrome
// accepts. A wrong guess is refused, so nothing is written by mistake.
function partitionSites() {
  const scheme = state.page.origin.startsWith("https:") ? "https://" : "http://";
  const labels = state.page.hostname.split(".");
  return labels.map((label, index) => scheme + labels.slice(index).join("."));
}

// Saves the form. A new partitioned cookie tries each possible site in
// turn (see partitionSites()); everything else is one write.
async function writeFromEditor(values) {
  if (state.editing || !values.partitionKey || duplicatePartition) {
    return writeCookie(state.editing, values);
  }
  let result = null;
  for (const topLevelSite of partitionSites()) {
    result = await writeCookie(null, { ...values, partitionKey: { topLevelSite } });
    if (result.ok) {
      break;
    }
  }
  return result;
}

function showFormErrors(errors) {
  const list = el("edit-errors");
  list.textContent = "";

  for (const error of errors) {
    const item = document.createElement("li");
    item.textContent = error;
    list.appendChild(item);
  }

  list.hidden = errors.length === 0;
}

// Chrome won't let a cookie expire more than about 400 days ahead. If you ask
// for longer, it quietly shortens it. This compares what was saved with what
// was asked for, and returns a sentence if Chrome changed it. It doesn't assume
// 400 days, so it still works if Chrome changes the limit.
export function describeExpiryChange(values, saved) {
  if (!saved || values.session || typeof values.expirationDate !== "number") {
    return "";
  }
  if (typeof saved.expirationDate !== "number") {
    return "";
  }

  // Allow a minute's difference, because Chrome stores fractions of a second.
  if (Math.abs(saved.expirationDate - values.expirationDate) < 60) {
    return "";
  }

  return t("cookie_editExpiryShortened", formatExpiryWhen({ expirationDate: saved.expirationDate }));
}

export async function saveEditor() {
  // JSON that no longer parses would be saved as broken text, so stop.
  const json = valueToSave();
  if (json.error) {
    showFormErrors([t("cookie_editJsonFixIt", json.error)]);
    return;
  }
  const values = readForm();

  // Check first, because Chrome's own error doesn't say what's wrong.
  const errors = validateCookieValues(values);
  if (errors.length > 0) {
    showFormErrors(errors);
    return;
  }
  showFormErrors([]);

  const save = el("edit-save");
  save.disabled = true;

  try {
    state.saving = true;
    const { ok, cookie, error } = await writeFromEditor(values);
    state.saving = false;

    if (!ok) {
      showFormErrors([error]);
      return;
    }

    // What Undo needs. An edit puts the old cookie back. If the name, domain
    // or path changed, the saved cookie is a second cookie, so Undo takes
    // it away too. A new cookie is only taken away.
    const original = state.editing;
    const change = original
      ? {
          kind: "edit",
          restore: [original],
          remove: cookieKey(original) === cookieKey(cookie) ? [] : [cookie],
        }
      : { kind: "create", remove: [cookie] };

    closeEditor();
    const shortened = describeExpiryChange(values, cookie);
    showMainMessage(
      (original ? t("cookie_editSaved", values.name) : t("cookie_editCreated", values.name)) +
        (shortened ? " " + shortened : ""),
      false
    );
    await offerUndo(el("main-message"), change);
    await refresh();
  } catch (error) {
    // Shouldn't happen, since writeCookie() catches its own errors. Show it
    // anyway so the form doesn't look stuck.
    showFormErrors([describeError(error)]);
  } finally {
    state.saving = false;
    save.disabled = false;
  }
}
