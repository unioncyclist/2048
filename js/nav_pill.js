// The app bar's blue highlight is a single element that slides between the
// items it can mark: the brand (this page) or a nav link (another page).
// Hovering any of them moves the highlight there; leaving the bar returns it
// to the current page. CSS alone cannot move one background between siblings,
// which is why this exists — everything it needs is in the markup it reads.
(function () {
  function init() {
    var inner = document.querySelector(".appbar-inner");
    var pill = document.querySelector(".nav-pill");
    if (!inner || !pill) return;

    var items = Array.prototype.slice.call(
      inner.querySelectorAll(".brand, .nav-link")
    );
    // The page marks itself with aria-current; index.html's brand is the
    // current page and carries the same attribute.
    var current = inner.querySelector('[aria-current="page"]') ||
                  inner.querySelector(".brand");
    var hovered = null;

    function place(el, offsetX) {
      if (!el) return;
      var host = inner.getBoundingClientRect();
      var rect = el.getBoundingClientRect();
      var x = rect.left - host.left + (offsetX || 0);
      pill.style.width = rect.width + "px";
      pill.style.height = rect.height + "px";
      pill.style.transform =
        "translate(" + x + "px," + (rect.top - host.top) + "px)";
    }

    function moveTo(el) {
      place(el, 0);
      pill.style.opacity = "1";
    }

    function moveWithoutTransition(el) {
      pill.style.transition = "none";
      place(el, 0);
      void pill.offsetWidth;
      pill.style.transition = "";
    }

    // First paint: sit the highlight a little to the left of the current item,
    // invisible, then let it slide in. A page that opened with a static block
    // of blue would read as a hover state instead of the current page.
    pill.style.transition = "none";
    pill.style.opacity = "0";
    place(current, -12);
    void pill.offsetWidth;
    pill.style.transition = "";
    window.requestAnimationFrame(function () { moveTo(current); });

    items.forEach(function (item) {
      item.addEventListener("pointerenter", function () {
        hovered = item;
        moveTo(item);
      });
      // Keyboard users get the same feedback without a pointer.
      item.addEventListener("focus", function () {
        hovered = item;
        moveTo(item);
      });
    });

    inner.addEventListener("pointerleave", function () {
      hovered = null;
      moveTo(current);
    });

    // The bar rewraps into three rows below 960px, so the cached position has
    // to be recomputed rather than animated across rows.
    window.addEventListener("resize", function () {
      moveWithoutTransition(hovered || current);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}());
