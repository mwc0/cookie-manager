// The Site report: what the site has stored, by purpose, and what's worth
// checking. It reads the cookies already on the main screen. Nothing here is
// saved, and the purposes are looked up on this computer only.

import { passesFilter } from "../lib/cookies.js";
import { knownCookie, loadKnownCookies, joinNames } from "../lib/known.js";
import { t, tn } from "../lib/i18n.js";
import { state } from "./state.js";
import { el, showState } from "./ui.js";

// In the order a reader cares about. The database's own word, then the key
// of the label's message.
const PURPOSES = [
  ["Marketing", "cookie_reportPurposeMarketing"],
  ["Analytics", "cookie_reportPurposeAnalytics"],
  ["Personalization", "cookie_reportPurposePersonalisation"],
  ["Functional", "cookie_reportPurposeFunctional"],
  ["Security", "cookie_reportPurposeSecurity"],
  ["Necessary", "cookie_reportPurposeNecessary"],
];

// Each one is a quick filter, so the two can never disagree. "Show them"
// switches it on. The filter, then the keys of its title and note.
const CHECKS = [
  ["notsecure", "cookie_reportCheckNotSecure", "cookie_reportCheckNotSecureNote"],
  ["readable", "cookie_reportCheckReadable", "cookie_reportCheckReadableNote"],
  ["samesitenone", "cookie_reportCheckSameSiteNone", "cookie_reportCheckSameSiteNoneNote"],
  ["large", "cookie_reportCheckLarge", "cookie_reportCheckLargeNote"],
  ["soon", "cookie_reportCheckSoon", "cookie_reportCheckSoonNote"],
];

const MAX_NAMES = 3;

function cell(text, className) {
  const td = document.createElement("td");
  td.textContent = text;
  if (className) {
    td.className = className;
  }
  return td;
}

// "Google, Meta and 2 others"
function joinCompanies(names) {
  const shown = names.slice(0, MAX_NAMES);
  const others = names.length - shown.length;
  if (others > 0) {
    return tn("cookie_reportCompaniesOthers", others, shown.join(", "));
  }
  return joinNames(shown);
}

function drawPurposes(cookies) {
  const groups = new Map();
  for (const cookie of cookies) {
    const known = knownCookie(cookie.name);
    const kind = known ? known.kind : null;
    const group = groups.get(kind) || { count: 0, companies: new Set() };
    group.count += 1;
    if (known) {
      group.companies.add(known.by[0]);
    }
    groups.set(kind, group);
  }

  const rows = el("report-rows");
  rows.textContent = "";
  const addRow = (label, group) => {
    const row = document.createElement("tr");
    row.append(
      cell(label),
      cell(String(group.count), "report-count"),
      cell(joinCompanies([...group.companies].sort()))
    );
    rows.appendChild(row);
  };
  for (const [kind, label] of PURPOSES) {
    if (groups.has(kind)) {
      addRow(t(label), groups.get(kind));
    }
  }
  // A kind the database adds later still gets counted.
  for (const [kind, group] of groups) {
    if (kind !== null && !PURPOSES.some(([name]) => name === kind)) {
      addRow(String(kind), group);
    }
  }
  if (groups.has(null)) {
    addRow(t("cookie_reportNotRecognised"), groups.get(null));
  }
}

function drawChecks(cookies, isKept) {
  const rows = el("report-check-rows");
  rows.textContent = "";
  const https = state.page.origin.startsWith("https:");

  for (const [filter, titleKey, detailKey] of CHECKS) {
    const count = cookies.filter((cookie) => passesFilter(cookie, filter, isKept)).length;
    // On a plain HTTP page no cookie can be Secure, so this says nothing.
    if (count === 0 || (filter === "notsecure" && !https)) {
      continue;
    }

    const title = t(titleKey);
    const words = cell(title);
    const note = document.createElement("span");
    note.className = "report-note";
    note.textContent = t(detailKey);
    words.append(document.createElement("br"), note);

    const show = document.createElement("button");
    show.type = "button";
    show.className = "row-button";
    show.textContent = t("cookie_reportShowThem");
    show.setAttribute("aria-label", tn("cookie_reportShowThemLabel", count, title));
    show.addEventListener("click", () => {
      closeReport();
      const chip = document.querySelector('#filters .chip[data-filter="' + filter + '"]');
      if (chip && chip.getAttribute("aria-pressed") !== "true") {
        chip.click();
      }
    });
    const action = document.createElement("td");
    action.className = "report-action";
    action.appendChild(show);

    const row = document.createElement("tr");
    row.append(words, cell(String(count), "report-count"), action);
    rows.appendChild(row);
  }
  el("report-checks").hidden = rows.childElementCount === 0;
  el("report-checks-none").hidden = rows.childElementCount !== 0 || cookies.length === 0;
}

export async function openReport(cookies, isKept) {
  // Without the list every cookie would read "Not recognised", which isn't
  // true, so say that instead.
  const listReady = await loadKnownCookies();
  const empty = cookies.length === 0;

  el("report-site").textContent = state.page.hostname;
  el("report-empty").hidden = !empty;
  el("report-body").hidden = empty;
  el("report-no-list").hidden = listReady;
  drawPurposes(cookies);
  drawChecks(cookies, isKept);

  showState("report");
  el("report-back").focus();
}

export function closeReport() {
  showState("main");
  el("report-open").focus();
}
