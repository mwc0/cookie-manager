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
