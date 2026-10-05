/* Laden accent theme: hack (green, ops/booth) | code (cyan, editor/terminal).
   Genres are not touched. Accent colors live in CSS via html[data-accent]. */
(function () {
  var KEY = 'laden_accent';
  var VALID = { hack: 1, code: 1 };

  function read() {
    try {
      var v = localStorage.getItem(KEY);
      return VALID[v] ? v : 'hack';
    } catch (e) {
      return 'hack';
    }
  }

  function flavorLabel(accent) {
    return accent === 'code' ? 'IDE' : 'OPS';
  }

  function hintCopy(accent) {
    if (accent === 'code') {
      return 'IDE · terminal flavor — the Code chapter matches this theme. Genre frames stay fixed.';
    }
    return 'OPS · booth flavor — the Hack chapter matches this theme. Genre frames stay fixed.';
  }

  function syncChrome(accent) {
    var root = document.documentElement;
    root.setAttribute('data-accent', accent);
    var b = document.body;
    if (b) {
      b.classList.toggle('theme-code', accent === 'code');
      b.classList.toggle('theme-hack', accent !== 'code');
    }
    document.querySelectorAll('.accent-toggle button').forEach(function (btn) {
      var on = btn.getAttribute('data-accent') === accent;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    document.querySelectorAll('.theme-flavor').forEach(function (el) {
      el.textContent = flavorLabel(accent);
    });
    var hint = document.getElementById('theme-chapter-hint');
    if (hint) hint.textContent = hintCopy(accent);
  }

  function apply(accent) {
    if (!VALID[accent]) accent = 'hack';
    try { localStorage.setItem(KEY, accent); } catch (e) {}
    syncChrome(accent);
  }

  apply(read());

  function mountHint() {
    var knobs = document.getElementById('chapter-knobs');
    if (!knobs || document.getElementById('theme-chapter-hint')) return;
    var hint = document.createElement('p');
    hint.id = 'theme-chapter-hint';
    hint.className = 'theme-chapter-hint';
    hint.textContent = hintCopy(read());
    knobs.insertAdjacentElement('afterend', hint);
  }

  function mount() {
    syncChrome(read());
    mountHint();
    // Keep the accent/OPS control on the Account page only; it is not global nav chrome.
    if (!/^\/account(?:\/|$)/.test(window.location.pathname)) return;
    if (document.getElementById('accent-toggle')) return;
    var host =
      document.querySelector('.nav-cta') ||
      document.querySelector('.nav-inner') ||
      document.querySelector('nav .wrap') ||
      null;
    if (!host) return;

    var wrap = document.createElement('div');
    wrap.className = 'accent-toggle';
    wrap.id = 'accent-toggle';
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', 'Theme: Hack or Code');
    wrap.innerHTML =
      '<span class="theme-flavor" aria-hidden="true">' + flavorLabel(read()) + '</span>' +
      '<button type="button" data-accent="hack" title="Hack theme — pentest ops / booth, green chrome">Hack</button>' +
      '<button type="button" data-accent="code" title="Code theme — editor / terminal, cyan chrome">Code</button>';

    wrap.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-accent]');
      if (!btn) return;
      apply(btn.getAttribute('data-accent'));
    });

    host.appendChild(wrap);
    syncChrome(read());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  window.LadenAccent = { get: read, set: apply };
})();
