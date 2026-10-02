// The icons used on the table's buttons. Each is drawn as SVG lines on a
// 24 x 24 grid, 2px thick, the same as the sun, moon and other icons in
// popup.html. The look (line width, colour) comes from svg.icon in
// popup.css.
//
// Built with createElementNS, never innerHTML, like everything in the table.

const SVG_NS = "http://www.w3.org/2000/svg";

const PATHS = {
  // A bookmark: kept.
  keep: ["M7 4h10v16l-5-3.6L7 20Z"],
  // A pencil.
  edit: ["M4 20h4L19 9l-4-4L4 16Z", "M13.5 6.5l4 4"],
  // A bin.
  delete: ["M4 7h16", "M9.5 7V4.5h5V7", "M6.5 7l1 13h9l1-13", "M10 11v5.5", "M14 11v5.5"],
  // A cross: back out of the "Sure?" step.
  cancel: ["M6.5 6.5l11 11", "M17.5 6.5l-11 11"],
};

// Returns an <svg> for the named icon. `filled` fills the shape in, which is
// how a kept cookie's bookmark looks.
export function icon(name, { filled = false } = {}) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("icon");
  if (filled) {
    svg.classList.add("filled");
  }

  for (const d of PATHS[name]) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}

// A small square button with an icon, and its name in a visually hidden
// span so screen readers still read it. The name is also the tooltip
// unless a fuller one is set afterwards.
export function iconButton(name, label, options = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "row-button icon-only";
  button.title = label;
  setIconContent(button, name, label, options);
  return button;
}

// Replaces what a button shows with an icon and a hidden name.
export function setIconContent(button, name, label, options = {}) {
  const text = document.createElement("span");
  text.className = "visually-hidden";
  text.textContent = label;
  button.replaceChildren(icon(name, options), text);
}
