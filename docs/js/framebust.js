/*
 * Anti-clickjacking. GitHub Pages cannot send the X-Frame-Options or CSP "frame-ancestors"
 * headers, and browsers ignore frame-ancestors inside a <meta> tag, so this script is the
 * best protection available on GitHub Pages: if the site is loaded inside someone else's
 * frame, it hides the page and tries to break out to the top window.
 * Loaded first and synchronously (no defer) from index.html.
 */
(function () {
  'use strict';
  var framed;
  try { framed = window.self !== window.top; } catch (e) { framed = true; }
  if (!framed) return;
  window.__APP_FRAMED__ = true;
  document.documentElement.style.display = 'none';
  try { window.top.location.replace(window.self.location.href); } catch (e) { /* sandboxed frame: stay hidden */ }
})();
