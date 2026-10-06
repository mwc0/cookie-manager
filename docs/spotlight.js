// The soft glow that follows the pointer over the feature list on the home
// page.
//
// It only sets two numbers that style.css reads (--spot-x and --spot-y, see
// .ledger there). Without this file the glow stays at the top of the list.

(function () {
  const box = document.querySelector(".ledger");
  if (!box) return;

  box.addEventListener("pointermove", (event) => {
    const edge = box.getBoundingClientRect();
    box.style.setProperty("--spot-x", event.clientX - edge.left + "px");
    box.style.setProperty("--spot-y", event.clientY - edge.top + "px");
  });

  // Back to where the stylesheet puts it.
  box.addEventListener("pointerleave", () => {
    box.style.removeProperty("--spot-x");
    box.style.removeProperty("--spot-y");
  });
})();
