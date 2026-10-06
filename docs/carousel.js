// The row of icons under the screenshot fan on the home page.
//
// The fan works without this file, as a strip you can scroll sideways
// (see .slides in style.css). This makes the icons under it work, and keeps
// them in step with the screenshot showing.

(function () {
  const carousel = document.querySelector(".showcase");
  if (!carousel) return;

  const scroller = carousel.querySelector(".slides");
  const slides = Array.from(scroller.querySelectorAll(".slide"));
  const rail = carousel.querySelector(".rail");
  const nodes = Array.from(rail.querySelectorAll(".rail-node"));
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  // The strip opens on the screenshot marked data-start in the HTML: the
  // overview, in the middle of the five.
  const start = Math.max(0, slides.findIndex((slide) => slide.hasAttribute("data-start")));
  let current = start;

  // Screen readers aren't told when the strip scrolls, so this hidden line
  // says which screenshot is showing.
  const status = document.createElement("p");
  status.className = "visually-hidden";
  status.setAttribute("aria-live", "polite");
  carousel.appendChild(status);

  nodes.forEach((node, i) => {
    node.addEventListener("click", () => goTo(i));
  });

  function goTo(i, smooth = true) {
    const slide = slides[i];
    // Scrolls only the strip, to where this screenshot sits in the middle.
    // scrollIntoView would move the whole page too.
    scroller.scrollTo({
      left: slide.offsetLeft - (scroller.clientWidth - slide.offsetWidth) / 2,
      behavior: smooth && !reduceMotion.matches ? "smooth" : "instant",
    });
    setCurrent(i, smooth);
  }

  function setCurrent(i, announce = true) {
    if (announce && i !== current) {
      const caption = slides[i].querySelector("figcaption");
      status.textContent = "Screenshot " + (i + 1) + " of " + slides.length +
        (caption ? ": " + caption.textContent : "");
    }
    current = i;
    nodes.forEach((node, n) => {
      if (n === i) node.setAttribute("aria-current", "true");
      else node.removeAttribute("aria-current");
    });
  }

  // Keeps the icons right when someone swipes instead of clicking. Chrome and
  // Edge have scrollsnapchange for this. Other browsers watch which slide is
  // in the middle of the strip.
  if ("onscrollsnapchange" in HTMLElement.prototype) {
    scroller.addEventListener("scrollsnapchange", (event) => {
      const i = slides.indexOf(event.snapTargetInline);
      if (i !== -1) setCurrent(i);
    });
  } else {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setCurrent(slides.indexOf(entry.target));
        });
      },
      { root: scroller, rootMargin: "0px -49%" }
    );
    slides.forEach((slide) => observer.observe(slide));
  }

  // Chrome already opens the strip in the right place (scroll-initial-target
  // in style.css). This does it for the browsers that don't.
  goTo(start, false);
  rail.hidden = false;
  carousel.classList.add("has-controls");
})();
