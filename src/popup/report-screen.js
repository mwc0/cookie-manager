// The Site report: what the site has stored, by purpose, and what's worth
// checking. It reads the cookies already on the main screen. Nothing here is
// saved, and the purposes are looked up on this computer only.

import { passesFilter } from "../lib/cookies.js";
import { knownCookie, loadKnownCookies } from "../lib/known.js";
import { pluralise } from "../lib/format.js";
import { state } from "./state.js";
import { el, showState } from "./ui.js";

// In the order a reader cares about. The database's own word is the key.
const PURPOSES = [
  ["Marketing", "Advertising and marketing"],
  ["Analytics", "Analytics"],
  ["Personalization", "Personalisation"],
  ["Functional", "Site features"],
  ["Security", "Security"],
  ["Necessary", "Needed to run the site"],
];

// Each one is a quick filter, so the two can never disagree. "Show them"
// switches it on.
const CHECKS = [
  ["notsecure", "Also sent over plain HTTP", "They don't have the Secure flag."],
  ["readable", "Readable by the page's scripts", "They don't have the HttpOnly flag."],
  ["samesitenone", "Sent when another site loads this one", "They have SameSite None."],
  ["large", "Close to Chrome's 4 KB limit", "A site with too many of these can stop logins working."],
  ["soon", "Expire within a day", "A sign-in held in one of these won't last."],
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
    return shown.join(", ") + " and " + pluralise(others, "other", "others");
  }
  return shown.length > 1 ? shown.slice(0, -1).join(", ") + " and " + shown[shown.length - 1] : shown.join("");
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
      addRow(label, groups.get(kind));
    }
  }
  // A kind the database adds later still gets counted.
  for (const [kind, group] of groups) {
    if (kind !== null && !PURPOSES.some(([name]) => name === kind)) {
      addRow(String(kind), group);
    }
  }
  if (groups.has(null)) {
    addRow("Not recognised", groups.get(null));
  }
}

function drawChecks(cookies, isKept) {
  const rows = el("report-check-rows");
  rows.textContent = "";
  const https = state.page.origin.startsWith("https:");

  for (const [filter, title, detail] of CHECKS) {
    const count = cookies.filter((cookie) => passesFilter(cookie, filter, isKept)).length;
    // On a plain HTTP page no cookie can be Secure, so this says nothing.
    if (count === 0 || (filter === "notsecure" && !https)) {
      continue;
    }

    const words = cell(title);
    const note = document.createElement("span");
    note.className = "report-note";
    note.textContent = detail;
    words.append(document.createElement("br"), note);

    const show = document.createElement("button");
    show.type = "button";
    show.className = "row-button";
    show.textContent = "Show them";
    show.setAttribute("aria-label", "Show the " + pluralise(count, "cookie", "cookies") + ": " + title);
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
