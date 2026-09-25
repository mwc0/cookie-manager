// Arrows and dots for the screenshot carousel on the home page.
//
// The carousel works without this file, as a strip you can scroll sideways
// (see .slides in style.css). This adds the buttons and keeps the dots in
// step with the screenshot showing.

(function () {
  const carousel = document.querySelector(".showcase");
  if (!carousel) return;

  const scroller = carousel.querySelector(".slides");
  const slides = Array.from(scroller.querySelectorAll(".slide"));
  const controls = carousel.querySelector(".carousel-controls");
  const dotsBox = carousel.querySelector(".carousel-dots");
  const [prev, next] = carousel.querySelectorAll(".carousel-arrow");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  let current = 0;

  const dots = slides.map((slide, i) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "carousel-dot";
    dot.setAttribute("aria-label", "Show screenshot " + (i + 1) + " of " + slides.length);
    dot.addEventListener("click", () => goTo(i));
    dotsBox.appendChild(dot);
    return dot;
  });

  function goTo(i) {
    i = Math.max(0, Math.min(slides.length - 1, i));
    // Scrolls only the strip. scrollIntoView would move the whole page too.
    scroller.scrollTo({
      left: slides[i].offsetLeft,
      behavior: reduceMotion.matches ? "auto" : "smooth",
    });
    setCurrent(i);
  }

  function setCurrent(i) {
    current = i;
    dots.forEach((dot, n) => {
      if (n === i) dot.setAttribute("aria-current", "true");
      else dot.removeAttribute("aria-current");
    });
    prev.disabled = i === 0;
    next.disabled = i === slides.length - 1;
  }

  prev.addEventListener("click", () => goTo(current - 1));
  next.addEventListener("click", () => goTo(current + 1));

  // Keeps the dots right when someone swipes instead of clicking. Chrome and
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

  setCurrent(0);
  controls.hidden = false;
  carousel.classList.add("has-controls");
})();
