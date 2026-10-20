import { setIconContent } from "./icons.js";

// Copies text and says so on the button that was clicked, then puts the
// button's label back. Copying from a click needs no extra permission.
export async function copyWithFeedback(button, text) {
  const label = button.dataset.label || button.textContent;
  button.dataset.label = label;

  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied";
  } catch (error) {
    button.textContent = "Couldn't copy";
    button.title = error && error.message ? error.message : String(error);
  }

  setTimeout(() => {
    button.textContent = label;
  }, 1500);
}

// The same for a small icon button, which has no room for words. Its icon
// becomes a tick (or a cross if copying failed) for a moment, and its
// hidden name says "Copied", so screen readers hear it too. `icon` and
// `label` are what to put back afterwards.
export async function copyWithIconFeedback(button, text, icon, label) {
  try {
    await navigator.clipboard.writeText(text);
    setIconContent(button, "done", "Copied");
  } catch (error) {
    setIconContent(button, "cancel", "Couldn't copy");
    button.title = error && error.message ? error.message : String(error);
  }

  setTimeout(() => {
    setIconContent(button, icon, label);
  }, 1500);
}
