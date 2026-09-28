// Single-icon theme control for static chrome.
//
// Replaces ranui's three-segment <r-theme-switch> with a disclosure matching
// the language trigger: one icon face, a short list of System / Light / Dark.
// Preference lives in localStorage `ran-theme` and on <html data-ran-theme>,
// the same contract workspace and the editor already use.

var STORAGE_KEY = 'ran-theme';
var ORDER = ['system', 'light', 'dark'];
var ICONS = {
  system: 'M4 5h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5zM8 19h8M12 16v3',
  light:
    'M12 3v2M12 19v2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M3 12h2M19 12h2M5.6 18.4l1.4-1.4M17 7l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  dark: 'M21 14.3A8.5 8.5 0 1 1 9.7 3a7 7 0 0 0 11.3 11.3z',
};

var mediaQuery = null;
var mediaHandler = null;

function readStored() {
  try {
    var value = localStorage.getItem(STORAGE_KEY);
    if (value === 'light' || value === 'dark' || value === 'system') return value;
  } catch {
    /* private mode */
  }
  return 'system';
}

function writeStored(theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* private mode */
  }
}

function rootEl() {
  return document.documentElement;
}

function setResolved(dark) {
  var value = dark ? 'dark' : 'light';
  rootEl().setAttribute('data-ran-theme', value);
  rootEl().setAttribute('theme', value);
}

function clearMedia() {
  if (mediaQuery && mediaHandler) {
    if (mediaQuery.removeEventListener) mediaQuery.removeEventListener('change', mediaHandler);
    else if (mediaQuery.removeListener) mediaQuery.removeListener(mediaHandler);
  }
  mediaQuery = null;
  mediaHandler = null;
}

function applyTheme(theme) {
  clearMedia();
  writeStored(theme);
  if (theme === 'system') {
    if (typeof window === 'undefined' || !window.matchMedia) {
      setResolved(false);
      return;
    }
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaHandler = function (event) {
      setResolved(!!event.matches);
    };
    setResolved(!!mediaQuery.matches);
    if (mediaQuery.addEventListener) mediaQuery.addEventListener('change', mediaHandler);
    else if (mediaQuery.addListener) mediaQuery.addListener(mediaHandler);
    return;
  }
  rootEl().setAttribute('data-ran-theme', theme);
  rootEl().setAttribute('theme', theme);
}

function paintControls(theme) {
  var path = ICONS[theme] || ICONS.system;
  var icons = document.querySelectorAll('[data-theme-icon] path');
  for (var i = 0; i < icons.length; i++) {
    icons[i].setAttribute('d', path);
  }
  var options = document.querySelectorAll('.theme-option[data-theme]');
  for (var j = 0; j < options.length; j++) {
    var option = options[j];
    var selected = option.getAttribute('data-theme') === theme;
    option.classList.toggle('is-current', selected);
    if (selected) option.setAttribute('aria-selected', 'true');
    else option.removeAttribute('aria-selected');
  }
}

function closeMenus() {
  var menus = document.querySelectorAll('r-popover.theme-menu[open]');
  for (var i = 0; i < menus.length; i++) {
    menus[i].removeAttribute('open');
  }
}

function onOptionClick(event) {
  var theme = event.currentTarget.getAttribute('data-theme');
  if (ORDER.indexOf(theme) < 0) return;
  applyTheme(theme);
  paintControls(theme);
  closeMenus();
}

function onStorage(event) {
  if (event.key !== STORAGE_KEY) return;
  var theme = readStored();
  applyTheme(theme);
  paintControls(theme);
}

document.addEventListener('DOMContentLoaded', function () {
  var theme = readStored();
  applyTheme(theme);
  paintControls(theme);

  var options = document.querySelectorAll('.theme-option[data-theme]');
  for (var i = 0; i < options.length; i++) {
    options[i].addEventListener('click', onOptionClick);
  }

  window.addEventListener('storage', onStorage);
});
