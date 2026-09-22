// Night mode. The visible switch is a single button; everything else is CSS
// keyed off `data-theme` on <html>, so this file only has to move that
// attribute and remember the choice.
//
// The attribute is set twice on purpose:
//   1. an inline script in <head> applies the stored theme before the first
//      paint, so a dark-mode reload never flashes white;
//   2. this module wires up the button and keeps the choice in sync.
//
// No matchMedia / prefers-color-scheme here. The player asked for a switch, so
// the switch is the only thing that decides — a system preference silently
// overriding it would be worse than ignoring it.
(function () {
  var STORAGE_KEY = "theme";
  var DARK = "dark";
  var LIGHT = "light";

  var root = document.documentElement;

  function stored() {
    try {
      var value = window.localStorage.getItem(STORAGE_KEY);
      return value === DARK || value === LIGHT ? value : null;
    } catch (error) {
      return null;
    }
  }

  // The attribute wins when it is already set — the head script uses it to
  // suppress the light flash before first paint. Otherwise fall back to the
  // stored preference, so this module stands on its own even if that script
  // is missing.
  function current() {
    var attr = root.getAttribute("data-theme");
    if (attr === DARK) return DARK;
    if (attr === LIGHT) return LIGHT;
    return stored() || LIGHT;
  }

  function apply(theme) {
    root.setAttribute("data-theme", theme);

    // The button shows the theme you would switch TO, so it advertises the
    // action rather than the current state.
    var toggle = document.querySelector(".theme-toggle");
    if (toggle) {
      var next = theme === DARK ? "light" : "dark";
      var label = "Switch to " + next + " mode";
      toggle.setAttribute("aria-label", label);
      toggle.setAttribute("title", label);
      toggle.setAttribute("aria-pressed", theme === DARK ? "true" : "false");
    }
  }

  function store(theme) {
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch (error) {
      // Private browsing, or storage turned off. The theme still applies for
      // this session; it just will not be remembered.
    }
  }

  // Clear the remembered preference. Not wired to any control — the switch is
  // a straight two-way toggle — but it is what the fallback path is tested
  // through, and it keeps that path honest.
  function forget() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      // Nothing to do; there was no stored preference to begin with.
    }
  }

  // Idempotent on purpose: calling init twice must not bind two click
  // listeners, or a single click would toggle the theme and immediately
  // toggle it back. The flag lives on the element so a re-render that
  // replaces the button is still wired up.
  function init() {
    apply(current());

    var toggle = document.querySelector(".theme-toggle");
    if (!toggle) return;
    if (toggle.dataset.themeBound === "1") return;
    toggle.dataset.themeBound = "1";

    toggle.addEventListener("click", function () {
      var theme = current() === DARK ? LIGHT : DARK;
      apply(theme);
      store(theme);
    });
  }

  // Exposed so tests can drive the switch without a real click.
  window.ThemeManager = {
    init: init,
    apply: apply,
    current: current,
    forget: forget,
    storageKey: STORAGE_KEY
  };

  init();
}());