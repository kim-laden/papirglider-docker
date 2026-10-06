/* Laden SoundCloud player. Each property keeps its own widget.
   Shell properties swap page content underneath a persistent iframe so
   playback never reloads or seeks while you stay on that property.
   Crossing to another property is a real page load, so its player takes over.
   Business is the shell that is on. */
(function () {
  'use strict';
  if (window.__ladenSoundCloudPlayer) return;
  window.__ladenSoundCloudPlayer = true;

  /* Start SoundCloud's network work before the player is mounted. The site
     shell keeps the iframe alive between business-page navigations. */
  function addEarlyNetworkHints() {
    var head = document.head || document.getElementsByTagName('head')[0];
    if (!head) return;
    [['preconnect', 'https://w.soundcloud.com'],
     ['preconnect', 'https://api.soundcloud.com'],
     ['dns-prefetch', 'https://w.soundcloud.com']].forEach(function (hint) {
      if (head.querySelector('link[rel=\"' + hint[0] + '\"][href=\"' + hint[1] + '\"]')) return;
      var link = document.createElement('link');
      link.rel = hint[0];
      link.href = hint[1];
      if (hint[0] === 'preconnect') link.crossOrigin = 'anonymous';
      head.appendChild(link);
    });
  }
  addEarlyNetworkHints();

  /* Phones: primary pointer is coarse and hover is unavailable.
     A narrow desktop window stays on the desktop volumes. */
  var mobileAudio = false;
  try {
    mobileAudio = window.matchMedia('(pointer: coarse)').matches &&
      window.matchMedia('(hover: none)').matches;
  } catch (err) {}

  var LAB_ROOTS = {
    llz: true, labs: true, forum: true, gear: true, oracle: true,
    challenges: true, community: true, messages: true, account: true,
    games: true, lla: true, lld: true, terminal: true, tips: true,
    zocial: true, store: true
  };

  function propertyOf(pathname) {
    var path = String(pathname || '/').replace(/\/+$/, '') || '/';
    var lower = path.toLowerCase();
    if (lower === '/docker/levi' || lower.indexOf('/docker/levi/') === 0) return 'papirglider';
    if (lower === '/levi' || lower.indexOf('/levi/') === 0 || lower === '/llz/levi' || lower.indexOf('/llz/levi/') === 0) return 'papirglider';
    if (lower === '/demo/skarverakk' || lower.indexOf('/demo/skarverakk/') === 0) return 'skarverakk';
    if (lower === '/llz' || lower.indexOf('/llz/') === 0) return 'lab';
    if (lower === '/v1.1' || lower.indexOf('/v1.1/') === 0) return 'lab';
    var seg = lower.split('/')[1] || '';
    if (LAB_ROOTS[seg]) return 'lab';
    if (lower === '/demo' || lower.indexOf('/demo/') === 0) return 'demo';
    return 'business';
  }

  var hereProp = propertyOf(location.pathname);
  var isPapirGlider = hereProp === 'papirglider';
  var isLab = hereProp === 'lab';
  var isSkarverakk = hereProp === 'skarverakk';
  /* The business site gets continuity; the three embedded properties keep their
     own players and never read or write the business player's position. */
  var isBusinessSite = hereProp === 'business';
  var daycoreTrack = {
    title: 'After Dark · daycore',
    url: 'https://soundcloud.com/sh4ru/mrkitty-after-dark-daycore-slowed-down'
  };
  var jessicaTrack = {
    title: 'Jessica',
    url: 'https://soundcloud.com/pickandwhammy/the-allman-brothers-band-jessica'
  };
  /* Skarverakk starts with daycore; its double-tap control can switch to Jessica. */
  var TRACK = isPapirGlider ? {
    title: 'Jessica · PapirGlider Klubben',
    url: jessicaTrack.url
  } : daycoreTrack;
  /* Business and Skarverakk start at 12. PapirGlider and Lab'z stay at 3.
     The hover slider can change this
     for the current visit only; it is not written to storage. */
  function startingVolume() {
    /* Mobile start is 12 on every property. Desktop stays 12 on the business
       site and Skarverakk, and 3 on PapirGlider and Lab'z. */
    if (mobileAudio) return 12;
    return (isSkarverakk || isBusinessSite) ? 12 : 3;
  }
  var volume = startingVolume();
  /* Visit-only slider. PapirGlider keeps the corner control; default stays 3. */
  /* Business volume is the Caleb corner, not this hover slider.
     Skarverakk volume and mute live inside Råkky, not a second floating control. */
  var volumeControl = isPapirGlider;
  /* These two must come back audible on every load. An off flag must not survive refresh. */
  /* Lab'z also must not keep a saved off flag across loads. Mute is visit-only. */
  var stayAudible = isSkarverakk || isPapirGlider || isLab;
  var storageKey = isPapirGlider ? 'papirglider-sc-player-v1' :
    (isLab ? 'llz-sc-player-v1' :
      (isSkarverakk ? 'skarverakk-sc-player-v1' : 'laden-business-sc-player-v1'));
  var legacyStorageKey = 'laden-sc-player-v2';
  var state = { enabled: true, position: 0 };
  var currentPosition = 0;
  var lastPositionSave = 0;
  var widget = null;
  var widgetReady = false;
  var apiLoading = false;
  var apiQueue = [];
  /* Ask the SoundCloud widget to autoplay on every fresh embed. Browsers may
     still reject audible autoplay; the page-level gesture handlers below
     retry it on the first pointer or keyboard interaction. */
  var AUTOPLAY = true;
  var autoplayRetryTimer = null;
  var autoplayAttempts = 0;
  var playbackStarted = false;
  var mutedAutoplay = false;
  var userHasInteracted = false;
  /* Visit-only mute. Never written to storage, so a reload starts audible.
     Volume stays in memory; unmute restores the level from before mute. */
  var userMuted = false;
  /* Shared, persistent music choice for every laden.no property (same origin).
     Read before any widget or autoplay parameter exists, so 'off' never plays. */
  var MUSIC_KEY = 'laden-music';
  function musicPref() { try { return localStorage.getItem(MUSIC_KEY); } catch (_) { return null; } }
  function rememberMusic(on) { try { localStorage.setItem(MUSIC_KEY, on ? 'on' : 'off'); } catch (_) {} }
  if (musicPref() === 'off') userMuted = true;
  var volumeBeforeMute = volume;

  function readState() {
    /* Main site: daycore from the start, every full load. Do not restore
       Jessica, a saved position, or a saved off flag. */
    if (isBusinessSite) {
      state.enabled = true;
      state.position = 0;
      currentPosition = 0;
      return;
    }
    /* Skarverakk must start playing on every load. A saved off flag from a
       tap, or a home-button reload, must not silence the next visit. */
    if (stayAudible) {
      state.enabled = true;
      try { localStorage.removeItem(storageKey); } catch (_) {}
      return;
    }
    try {
      var raw = localStorage.getItem(storageKey);
      /* Preserve the previous business-site on/off choice once, but never its
         position: the old player did not track position safely. */
      if (!raw && isBusinessSite) raw = localStorage.getItem(legacyStorageKey);
      var saved = JSON.parse(raw || '{}');
      if (typeof saved.enabled === 'boolean') state.enabled = saved.enabled;
      if (isBusinessSite && typeof saved.position === 'number' && isFinite(saved.position) && saved.position >= 0) {
        state.position = saved.position;
        currentPosition = saved.position;
      }
    } catch (_) {}
  }
  function saveState() {
    if (stayAudible) return;
    try {
      var payload = { enabled: state.enabled };
      if (isBusinessSite) payload.position = Math.max(0, currentPosition || 0);
      localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch (_) {}
  }
  function savePosition(force) {
    if (!isBusinessSite) return;
    var now = Date.now();
    if (force || now - lastPositionSave >= 800) {
      saveState();
      lastPositionSave = now;
    }
  }
  function loadApi(done) {
    if (window.SC && window.SC.Widget) return done();
    apiQueue.push(done);
    if (apiLoading) return;
    apiLoading = true;
    var script = document.createElement('script');
    script.src = 'https://w.soundcloud.com/player/api.js';
    script.async = true;
    script.fetchPriority = 'high';
    script.onload = function () {
      apiLoading = false;
      apiQueue.splice(0).forEach(function (fn) { fn(); });
    };
    script.onerror = function () {
      apiLoading = false;
      apiQueue.splice(0);
      setStatus('Sound unavailable');
    };
    document.head.appendChild(script);
  }
  /* Begin downloading the widget API while the document is still parsing. */
  loadApi(function () {});

  function embedUrl() {
    var params = new URLSearchParams({
      url: TRACK.url,
      color: isPapirGlider ? '8b5a3c' : (isLab ? '00ff9d' : '9ed9d3'),
      auto_play: AUTOPLAY && !userMuted,
      hide_related: 'true',
      show_comments: 'false',
      show_user: 'false',
      show_reposts: 'false',
      visual: 'false'
    });
    return 'https://w.soundcloud.com/player/?' + params.toString();
  }
  function setStatus(text) {
    var status = document.querySelector('.laden-sc-player__status');
    if (status) status.textContent = text;
  }
  function audible() {
    return state.enabled && !userMuted;
  }
  function updateUi() {
    var on = audible();
    var panel = document.querySelector('.laden-sc-player');
    if (panel) {
      var toggle = panel.querySelector('[data-sc-toggle]');
      var icon = panel.querySelector('[data-sc-icon]');
      var label = panel.querySelector('[data-sc-label]');
      if (toggle && icon && label) {
        toggle.setAttribute('aria-pressed', String(on));
        toggle.setAttribute('aria-label', on ? 'Mute background music' : 'Unmute background music');
        toggle.title = on ? 'Background music on' : 'Background music muted';
        toggle.classList.toggle('is-on', on);
        icon.textContent = on ? '♪' : '×';
        label.textContent = on ? 'Sound on' : 'Sound muted';
      }
      panel.classList.toggle('is-on', on);
    }
    if (!isSkarverakk) return;
    var buttons = document.querySelectorAll('[data-rakky-mute]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute('aria-pressed', String(on));
      buttons[i].setAttribute('aria-label', on ? 'Skru av musikken' : 'Skru på musikken');
      buttons[i].textContent = on ? 'Lyd på' : 'Lyd av';
      buttons[i].classList.toggle('is-on', on);
    }
  }
  function setVolume(level) {
    if (widget && widgetReady) {
      try { widget.setVolume(typeof level === 'number' ? level : volume); } catch (_) {}
    }
  }
  function applyAudibleVolume() {
    /* Phones ignore HTMLMediaElement.volume, so setVolume(0) does not mute.
       Pause is what actually goes silent. Unmute plays again. Nothing here
       is written to storage. */
    if (userMuted) {
      setVolume(0);
      if (widget && widgetReady) {
        try { widget.pause(); } catch (_) {}
      }
      return;
    }
    setVolume(volume);
  }
  function toggleMute() {
    userHasInteracted = true;
    mutedAutoplay = false;
    stopAutoplayRetry();
    if (!state.enabled) {
      /* Re-enable playback, then mute/unmute via volume only. */
      state.enabled = true;
      /* Do not save an off flag — mute is visit-only. */
    }
    if (userMuted) {
      userMuted = false;
      rememberMusic(true);
      if (!(typeof volumeBeforeMute === 'number' && volumeBeforeMute > 0)) {
        volumeBeforeMute = startingVolume();
      }
      volume = volumeBeforeMute;
      if (!widget) createWidget();
      applyAudibleVolume();
      if (widgetReady) {
        try { widget.play(); } catch (_) {}
      }
      setStatus(isBusinessSite ? 'playing softly · continuing' : 'playing softly · repeating from start');
      updateUi();
      syncVolumeSlider();
      return false;
    }
    volumeBeforeMute = volume > 0 ? volume : volumeBeforeMute;
    userMuted = true;
    rememberMusic(false);
    applyAudibleVolume();
    setStatus('muted');
    updateUi();
    syncVolumeSlider();
    return true;
  }
  function syncVolumeSlider() {
    var inputs = document.querySelectorAll('[data-sc-volume]');
    var value = String(userMuted ? 0 : volume);
    for (var i = 0; i < inputs.length; i++) inputs[i].value = value;
  }
  function bindVolumeInput(volumeInput) {
    if (!volumeInput || volumeInput.getAttribute('data-sc-bound') === '1') return;
    volumeInput.setAttribute('data-sc-bound', '1');
    volumeInput.addEventListener('input', function () {
      var next = Number(volumeInput.value);
      if (!isFinite(next)) return;
      volume = Math.max(0, Math.min(100, Math.round(next)));
      /* A volume change is not a stored mute. Dragging up also unmutes. */
      if (!state.enabled) return;
      userHasInteracted = true;
      mutedAutoplay = false;
      userMuted = volume === 0;
      rememberMusic(!userMuted);
      if (volume > 0) volumeBeforeMute = volume;
      stopAutoplayRetry();
      applyAudibleVolume();
      updateUi();
      syncVolumeSlider();
      if (!userMuted && !playbackStarted && widgetReady) {
        try { widget.play(); } catch (_) {}
      }
    });
    volumeInput.addEventListener('pointerdown', function (event) { event.stopPropagation(); });
    volumeInput.addEventListener('click', function (event) { event.stopPropagation(); });
  }
  function stopAutoplayRetry() {
    if (autoplayRetryTimer) {
      clearInterval(autoplayRetryTimer);
      autoplayRetryTimer = null;
    }
  }
  function playWhenReady(fromGesture) {
    if (!widget || !widgetReady || !state.enabled) return;
    /* A later tap anywhere on the page must not undo a visit mute.
       On a phone, playing again is audible even when volume was set to 0. */
    if (userMuted) {
      if (fromGesture) {
        userHasInteracted = true;
        mutedAutoplay = false;
        stopAutoplayRetry();
      }
      applyAudibleVolume();
      return;
    }
    if (fromGesture) {
      userHasInteracted = true;
      mutedAutoplay = false;
      applyAudibleVolume();
      stopAutoplayRetry();
    } else {
      /* A muted start is the standards-compliant fallback when audible
         autoplay is blocked. Keep it muted until a real page gesture.
         Visit mute also stays at 0 without touching storage. */
      setVolume(mutedAutoplay ? 0 : volume);
    }
    try {
      widget.play();
      setStatus(isBusinessSite ? 'playing softly · continuing' : 'playing softly · repeating from start');
    } catch (_) {
      setStatus('click or press a key to start');
    }
  }
  function beginAutoplay() {
    if (!widget || !widgetReady || !state.enabled || userHasInteracted) return;
    stopAutoplayRetry();
    autoplayAttempts = 0;
    mutedAutoplay = false;
    /* Call play() immediately on READY, then retry briefly for slow embeds. */
    function attempt() {
      if (!widget || !widgetReady || !state.enabled || playbackStarted || userHasInteracted) {
        stopAutoplayRetry();
        return;
      }
      autoplayAttempts += 1;
      /* Skarverakk stays at its real volume. A muted lock made a reload
         sound like the track had stopped. */
      if (!stayAudible && autoplayAttempts >= 5) mutedAutoplay = true;
      playWhenReady(false);
      if (autoplayAttempts >= (stayAudible ? 40 : 12)) stopAutoplayRetry();
    }
    attempt();
    autoplayRetryTimer = setInterval(attempt, 250);
  }
  function loadTrack(next) {
    TRACK = next;
    var tries = 0;
    function apply() {
      if (!widget || !widgetReady) return false;
      try {
        widget.load(TRACK.url, {
          auto_play: AUTOPLAY && !userMuted,
          hide_related: true,
          show_comments: false,
          show_user: false,
          show_reposts: false,
          visual: false
        }, function () {
          userHasInteracted = true;
          mutedAutoplay = false;
          stopAutoplayRetry();
          if (state.enabled) playWhenReady(true);
          else setStatus('off');
        });
        return true;
      } catch (_) {
        setStatus('track switch unavailable');
        return true;
      }
    }
    if (apply()) return;
    setStatus('track switched · loading');
    var timer = setInterval(function () {
      tries += 1;
      if (TRACK.url !== next.url || apply() || tries > 40) clearInterval(timer);
    }, 100);
  }
  function nudgeBusinessVolume(delta) {
    volume = Math.max(0, Math.min(40, Math.round(volume + delta)));
    userHasInteracted = true;
    mutedAutoplay = false;
    userMuted = false;
    rememberMusic(true);
    volumeBeforeMute = volume;
    stopAutoplayRetry();
    state.enabled = true;
    updateUi();
    if (!widget) createWidget();
    setVolume(volume);
    if (widgetReady) playWhenReady(true);
    syncVolumeSlider();
    return volume;
  }
  function exposeBusinessAudio() {
    if (!isBusinessSite) return;
    window.__ladenBusinessAudio = {
      volumeUp: function () { return nudgeBusinessVolume(4); },
      volumeDown: function () { return nudgeBusinessVolume(-4); },
      toggleMute: function () { return toggleMute(); },
      isMuted: function () { return userMuted; },
      switchTrack: function () {
        var next = TRACK.url === daycoreTrack.url ? jessicaTrack : daycoreTrack;
        loadTrack(next);
        return next.url === jessicaTrack.url ? 'jessica' : 'daycore';
      },
      playDaycore: function () {
        if (TRACK.url !== daycoreTrack.url) loadTrack(daycoreTrack);
        return 'daycore';
      },
      volume: function () { return volume; },
      track: function () { return TRACK.url === jessicaTrack.url ? 'jessica' : 'daycore'; }
    };
  }
  function switchSkarverakkTrack() {
    if (!isSkarverakk) return;
    TRACK = TRACK.url === daycoreTrack.url ? jessicaTrack : daycoreTrack;
    if (!widget || !widgetReady) {
      setStatus('track switched · loading');
      return;
    }
    try {
      widget.load(TRACK.url, {
        auto_play: AUTOPLAY && !userMuted,
        hide_related: true,
        show_comments: false,
        show_user: false,
        show_reposts: false,
        visual: false
      }, function () {
        if (state.enabled) {
          /* Track switching is itself a user gesture: unmute immediately. */
          userHasInteracted = true;
          mutedAutoplay = false;
          stopAutoplayRetry();
          playWhenReady(true);
        } else {
          setStatus('off');
        }
      });
    } catch (_) {
      setStatus('track switch unavailable');
    }
  }
  function kickPlayback() {
    if (!state.enabled || userMuted || !widget || !widgetReady) return;
    try {
      widget.isPaused(function (paused) {
        if (!paused || !state.enabled || userMuted) return;
        applyAudibleVolume();
        try { widget.play(); } catch (err) {}
      });
    } catch (err) {
      applyAudibleVolume();
      try { widget.play(); } catch (err2) {}
    }
  }

  var widgetBuilding = false;
  function createWidget() {
    if (widget || widgetBuilding) return;
    widgetBuilding = true;
    var iframe = document.createElement('iframe');
    iframe.className = 'laden-sc-player__embed';
    iframe.title = 'SoundCloud background music';
    iframe.allow = 'autoplay; encrypted-media';
    iframe.loading = 'eager';
    iframe.fetchPriority = 'high';
    /* Keep the widget inside the visual viewport. iOS suspends media that
       lives at left:-9999, which is what cut the song while scrolling,
       when the address bar moved, and after the home button. */
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:8px;height:8px;opacity:0.02;border:0;pointer-events:none;z-index:1;';
    iframe.src = embedUrl();
    document.querySelector('.laden-sc-player').appendChild(iframe);
    loadApi(function () {
      if (!window.SC || !window.SC.Widget) return;
      widget = window.SC.Widget(iframe);
      if (window.SC.Widget.Events.PLAY) {
        widget.bind(window.SC.Widget.Events.PLAY, function () {
          playbackStarted = true;
          if (stayAudible) applyAudibleVolume();
          else stopAutoplayRetry();
        });
      }
      widget.bind(window.SC.Widget.Events.READY, function () {
        widgetReady = true;
        applyAudibleVolume();
        if (isBusinessSite && state.position > 0) {
          try { widget.seekTo(state.position); } catch (_) {}
        }
        setStatus(state.enabled ? (isBusinessSite ? 'ready · resuming softly' : 'ready · starting softly') : 'ready');
        if (state.enabled && !userMuted) {
          if (userHasInteracted) playWhenReady(true);
          else beginAutoplay();
        }
      });
      if (window.SC.Widget.Events.PLAY_PROGRESS) {
        widget.bind(window.SC.Widget.Events.PLAY_PROGRESS, function (data) {
          if (isBusinessSite && data && typeof data.currentPosition === 'number') {
            currentPosition = Math.max(0, data.currentPosition);
            savePosition(false);
          }
        });
      }
      if (window.SC.Widget.Events.PAUSE) {
        widget.bind(window.SC.Widget.Events.PAUSE, function () { savePosition(true); });
      }
      if (window.SC.Widget.Events.FINISH) {
        widget.bind(window.SC.Widget.Events.FINISH, function () {
          if (isBusinessSite) {
            currentPosition = 0;
            saveState();
          }
          if (state.enabled) {
            applyAudibleVolume();
            playWhenReady(false);
          }
        });
      }
    });
  }
  function resumeOnGesture() {
    if (state.enabled && widgetReady) playWhenReady(true);
  }
  function ensureVolumeStyles() {
    if (document.getElementById('laden-sc-volume-style')) return;
    var style = document.createElement('style');
    style.id = 'laden-sc-volume-style';
    style.textContent = [
      '.laden-sc-player__vol{pointer-events:none;position:absolute;right:100%;bottom:0;display:flex;align-items:center;height:34px;width:112px;margin:0;padding:0 14px 0 12px;box-sizing:border-box;border-radius:999px;opacity:0;visibility:hidden;background:rgba(20,24,22,.92);border:1px solid rgba(158,217,211,.38);box-shadow:0 8px 22px rgba(20,24,22,.18)}',
      '.laden-sc-player__vol::after{content:"";position:absolute;right:-10px;top:0;width:10px;height:100%}',
      '@media (hover:hover) and (pointer:fine){.laden-sc-player:hover .laden-sc-player__vol,.laden-sc-player:focus-within .laden-sc-player__vol{pointer-events:auto;opacity:1;visibility:visible}}',
      '.laden-sc-player__vol input{width:100%;height:18px;margin:0;padding:0;cursor:pointer;accent-color:#9ed9d3;background:transparent}',
      '.laden-sc-player--skarverakk .laden-sc-player__vol{background:rgba(11,11,10,.94);border-color:rgba(226,255,58,.42)}',
      '.laden-sc-player--skarverakk .laden-sc-player__vol input{accent-color:#e2ff3a}',
      '.laden-sc-player--papirglider .laden-sc-player__vol{background:rgba(42,28,18,.94);border-color:rgba(139,90,60,.55)}',
      '.laden-sc-player--papirglider .laden-sc-player__vol input{accent-color:#8b5a3c}',
      '.laden-sc-player--papirglider .laden-sc-player__vol{pointer-events:auto;opacity:1;visibility:visible}',
      '@media (hover:none),(pointer:coarse){.laden-sc-player--skarverakk .laden-sc-player__vol{pointer-events:auto;opacity:1;visibility:visible}}'
    ].join('');
    document.head.appendChild(style);
  }
  function mount() {
    if (document.querySelector('.laden-sc-player')) return;
    var panel = document.createElement('aside');
    panel.className = 'laden-sc-player ' + (isPapirGlider ? 'laden-sc-player--papirglider' : (isLab ? 'laden-sc-player--lab' : (isSkarverakk ? 'laden-sc-player--skarverakk' : 'laden-sc-player--site')));
    if (isBusinessSite) panel.classList.add('laden-sc-player--in-caleb');
    if (isSkarverakk) panel.classList.add('laden-sc-player--in-rakky');
    panel.setAttribute('aria-label', 'Laden background music');
    panel.innerHTML = '<button type="button" class="laden-sc-player__toggle" data-sc-toggle aria-pressed="true" aria-label="Turn background music off" title="Background music on">' +
      '<span class="laden-sc-player__icon" data-sc-icon aria-hidden="true">♪</span><span class="sr-only" data-sc-label>Sound on</span></button>' +
      (volumeControl ?
        '<label class="laden-sc-player__vol"><span class="sr-only">Volume</span>' +
        '<input type="range" min="0" max="100" step="1" value="' + volume + '" data-sc-volume aria-label="Background music volume"></label>' : '') +
      '<span class="laden-sc-player__status" data-sc-status aria-live="polite">ready · low volume · repeat</span>';
    document.body.appendChild(panel);
    if (volumeControl) ensureVolumeStyles();
    var toggle = panel.querySelector('[data-sc-toggle]');
    var volumeInput = panel.querySelector('[data-sc-volume]');
    var lastToggleAt = 0;
    var lastSkarverakkTap = 0;
    bindVolumeInput(volumeInput);
    function toggleSound() {
      /* Legacy pause path kept unused by the UI. Mute is visit-only volume. */
      state.enabled = !state.enabled;
      saveState();
      rememberMusic(state.enabled);
      updateUi();
      if (state.enabled) {
        createWidget();
        if (widgetReady) playWhenReady(true);
      } else if (widget) {
        try { widget.pause(); } catch (_) {}
        setStatus('off');
      }
    }
    /* Don't let this tap bubble into resumeOnGesture, which would play
       before the click can mute. A phone then stays audible. */
    toggle.addEventListener('pointerdown', function (event) {
      event.stopPropagation();
    });
    function handleSoundClick() {
      var now = Date.now();
      /* One finger can produce two click events. The second would undo mute. */
      if (now - lastToggleAt < 50) return;
      lastToggleAt = now;
      /* Skarverakk still switches songs on a quick second tap, but the first
         tap mutes immediately. Waiting for the second tap is what made mute
         feel dead on a phone. */
      var quick = isSkarverakk && lastSkarverakkTap && (now - lastSkarverakkTap) < 340;
      lastSkarverakkTap = quick ? 0 : now;
      toggleMute();
      if (quick) switchSkarverakkTrack();
    }
    toggle.addEventListener('click', handleSoundClick);
    function fillRakkySlot(slot) {
      if (!slot || slot.querySelector('[data-rakky-sound]')) return;
      /* Collapsed dock stays name + note only. Mute/volume live in open Råkky. */
      if (slot.getAttribute('data-rakky-slot') === 'dock') return;
      var row = document.createElement('div');
      row.className = 'rakky-sound';
      row.setAttribute('data-rakky-sound', '');
      row.innerHTML = '<button type="button" class="rakky-sound__mute" data-rakky-mute>Lyd på</button>' +
        '<label class="rakky-sound__vol"><span>Volum</span>' +
        '<input type="range" min="0" max="100" step="1" value="' + (userMuted ? 0 : volume) + '" data-sc-volume aria-label="Volum"></label>';
      slot.appendChild(row);
      var muteBtn = row.querySelector('[data-rakky-mute]');
      muteBtn.addEventListener('pointerdown', function (event) { event.stopPropagation(); });
      muteBtn.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        handleSoundClick();
      });
      bindVolumeInput(row.querySelector('[data-sc-volume]'));
      updateUi();
      syncVolumeSlider();
    }
    if (isSkarverakk) {
      var rakkyScanLock = false;
      function scanRakkySlots() {
        if (rakkyScanLock) return;
        rakkyScanLock = true;
        try {
          var slots = document.querySelectorAll('[data-rakky-slot]');
          for (var i = 0; i < slots.length; i++) fillRakkySlot(slots[i]);
        } finally {
          rakkyScanLock = false;
        }
      }
      scanRakkySlots();
      var rakkyObs = new MutationObserver(scanRakkySlots);
      rakkyObs.observe(document.body, { childList: true, subtree: true });
    }
    updateUi();
    if (userMuted) setStatus('muted');
    /* Another tab turned music off: follow it here. */
    window.addEventListener('storage', function (event) {
      if (event.key === MUSIC_KEY && event.newValue === 'off' && !userMuted) toggleMute();
    });
    /* Retry outside the icon too: autoplay policies commonly unlock on any
       first page gesture, not just a click on our control. */
    document.addEventListener('pointerdown', resumeOnGesture, { passive: true });
    document.addEventListener('keydown', resumeOnGesture);
    window.addEventListener('pagehide', function () { savePosition(true); });
    /* Home button, tab switch, and the iOS address bar all pause the widget.
       Resume whenever the page is visible again. Never pause on hide, and
       never write an off flag. An explicit mute stays paused. */
    function onForeground() {
      if (document.hidden) return;
      if (!state.enabled) return;
      if (userMuted) return;
      if (!widget) { createWidget(); return; }
      if (widgetReady) kickPlayback();
    }
    window.addEventListener('pageshow', onForeground);
    window.addEventListener('focus', onForeground);
    document.addEventListener('visibilitychange', onForeground);
    if (mobileAudio) {
      document.documentElement.style.overscrollBehaviorY = 'none';
      document.body.style.overscrollBehaviorY = 'none';
      setInterval(function () {
        if (document.hidden || !state.enabled || userMuted || !widget || !widgetReady) return;
        try {
          widget.isPaused(function (paused) {
            if (paused && state.enabled && !userMuted && !document.hidden) kickPlayback();
          });
        } catch (err) {}
      }, 1200);
    }
    if (state.enabled && !userMuted) createWidget();
  }

  /* Standard Laden pattern: persistent player per property.
     Stay inside the property -> swap HTML, same iframe, no seek.
     Leave the property -> full navigation, this player stops. */
  /* Keep one iframe alive while navigating inside every property. */
  var SHELL_PROPERTIES = { business: true, lab: true, papirglider: true, skarverakk: true };

  function installPropertyShell() {
    var here = propertyOf(location.pathname);
    if (!SHELL_PROPERTIES[here]) return;
    /* Skarverakk is one React page. This shell fetches index.html, finds no
       header.site-header or main (they render later), and hard-reloads.
       That reload is what the home control does, and it destroys the iframe.
       Leave routing to the app so the same player keeps playing. */
    if (here === 'skarverakk') return;
    if (window.__ladenPropertyShell) return;
    window.__ladenPropertyShell = here;
    try { history.scrollRestoration = 'manual'; } catch (err) {}

    var navSeq = 0;
    var navAbort = null;
    var FILE_RE = /\.(?:exe|pkg|dmg|zip|appimage|deb|rpm|msi|pdf|mp3|wav|png|jpe?g|gif|svg|webp|gz|tgz|tar|bz2|7z|iso|apk|woff2?)(?:$|\?)/i;

    function stampHistory() {
      try {
        var prev = history.state && typeof history.state === 'object' ? history.state : {};
        var next = {};
        for (var key in prev) {
          if (Object.prototype.hasOwnProperty.call(prev, key)) next[key] = prev[key];
        }
        next.ladenShell = here;
        next.y = window.scrollY || 0;
        history.replaceState(next, '', location.href);
      } catch (err) {}
    }

    function hardGo(url) {
      window.location.assign(typeof url === 'string' ? url : url.href);
    }

    function copyMeta(doc, attr, key) {
      var sel = 'meta[' + attr + '="' + key + '"]';
      var src = doc.querySelector(sel);
      if (!src) return;
      var dst = document.querySelector(sel);
      if (!dst) {
        dst = document.createElement('meta');
        dst.setAttribute(attr, key);
        document.head.appendChild(dst);
      }
      dst.setAttribute('content', src.getAttribute('content') || '');
    }

    function syncHead(doc) {
      if (doc.title) document.title = doc.title;
      var lang = doc.documentElement.getAttribute('lang');
      if (lang) document.documentElement.lang = lang;
      ['description', 'robots', 'theme-color'].forEach(function (name) { copyMeta(doc, 'name', name); });
      ['og:title', 'og:description', 'og:url', 'og:locale', 'og:type', 'og:image'].forEach(function (prop) {
        copyMeta(doc, 'property', prop);
      });
      var canon = doc.querySelector('link[rel="canonical"]');
      if (canon) {
        var existing = document.querySelector('link[rel="canonical"]');
        if (!existing) {
          existing = document.createElement('link');
          existing.rel = 'canonical';
          document.head.appendChild(existing);
        }
        existing.setAttribute('href', canon.getAttribute('href') || '');
      }
      var have = {};
      document.querySelectorAll('link[rel="stylesheet"]').forEach(function (link) {
        have[link.getAttribute('href')] = true;
      });
      doc.querySelectorAll('link[rel="stylesheet"]').forEach(function (link) {
        var href = link.getAttribute('href');
        if (!href || have[href]) return;
        document.head.appendChild(document.importNode(link, true));
      });
      document.querySelectorAll('script[type="application/ld+json"]').forEach(function (node) { node.remove(); });
      doc.querySelectorAll('script[type="application/ld+json"]').forEach(function (node) {
        document.head.appendChild(document.importNode(node, true));
      });
    }

    function swapBody(doc) {
      /* The player stays mounted for the whole swap. Detaching an iframe
         reloads it, which would cut the music. */
      var player = document.querySelector('.laden-sc-player');
      var caleb = document.getElementById('laden-caleb');
      var className = doc.body.className || '';
      Array.prototype.slice.call(document.body.childNodes).forEach(function (node) {
        if (node === player || node === caleb) return;
        if (node.nodeType === 1) {
          var id = node.id || '';
          if (id === 'laden-app-tabs' || id === 'laden-more-sheet' || id === 'laden-more-backdrop') return;
        }
        node.parentNode.removeChild(node);
      });
      Array.prototype.slice.call(doc.body.childNodes).forEach(function (node) {
        if (node.nodeType === 1 && node.tagName === 'SCRIPT') return;
        var copy = document.importNode(node, true);
        if (copy.querySelectorAll) copy.querySelectorAll('script').forEach(function (script) { script.remove(); });
        if (player && player.parentNode === document.body) document.body.insertBefore(copy, player);
        else document.body.appendChild(copy);
      });
      document.body.className = className;
    }

    function reveal(url, restoreY) {
      var hash = url.hash;
      if (hash && hash.length > 1) {
        var id = decodeURIComponent(hash.slice(1));
        var target = document.getElementById(id) || document.querySelector('[name="' + id.replace(/"/g, '') + '"]');
        if (target && target.scrollIntoView) {
          target.scrollIntoView();
          return;
        }
      }
      window.scrollTo(0, restoreY || 0);
    }

    function softNavigate(url, push, restoreY) {
      var seq = ++navSeq;
      if (navAbort) navAbort.abort();
      navAbort = typeof AbortController === 'function' ? new AbortController() : null;
      var requestUrl = url.pathname + url.search;
      fetch(requestUrl, {
        credentials: 'same-origin',
        headers: { Accept: 'text/html' },
        signal: navAbort ? navAbort.signal : undefined
      }).then(function (res) {
        var type = (res.headers.get('content-type') || '').toLowerCase();
        var finalUrl = new URL(res.url, location.href);
        if (propertyOf(finalUrl.pathname) !== here) {
          hardGo(finalUrl.href);
          return null;
        }
        if (type && type.indexOf('text/html') === -1) {
          hardGo(url.href);
          return null;
        }
        return res.text().then(function (html) { return { html: html, finalUrl: finalUrl }; });
      }).then(function (payload) {
        if (!payload || seq !== navSeq) return;
        var head = payload.html.slice(0, 300).toLowerCase();
        if (head.indexOf('<!doctype html') === -1 && head.indexOf('<html') === -1) {
          hardGo(url.href);
          return;
        }
        var doc = new DOMParser().parseFromString(payload.html, 'text/html');
        /* PapirGlider uses header.nav and sections. Lab'z uses header.nav too.
           Requiring header.site-header hard-navigates those and destroys the iframe. */
        if (here === 'business' && (!doc.querySelector('header.site-header') || !doc.querySelector('main'))) {
          hardGo(url.href);
          return;
        }
        if (here === 'lab' && (!doc.querySelector('header') || !doc.querySelector('main'))) {
          hardGo(url.href);
          return;
        }
        if (here === 'papirglider' && !doc.body) {
          hardGo(url.href);
          return;
        }
        var player = document.querySelector('.laden-sc-player');
        var iframe = player ? player.querySelector('iframe') : null;
        swapBody(doc);
        syncHead(doc);
        if (iframe && !iframe.isConnected) document.body.appendChild(player);
        if (here === 'lab') reviveLabScripts(doc);
        kickPlayback();
        var shown = payload.finalUrl.pathname + payload.finalUrl.search + (url.hash || '');
        if (push) {
          stampHistory();
          history.pushState({ ladenShell: here, y: 0 }, '', shown);
        }
        reveal(url, restoreY);
        if (window.__ladenBindPage) window.__ladenBindPage();
      }).catch(function (err) {
        if (err && err.name === 'AbortError') return;
        if (seq !== navSeq) return;
        hardGo(url.href);
      });
    }

    function linkToSoftUrl(link) {
      if (!link) return null;
      if (link.hasAttribute('download')) return null;
      var targetAttr = (link.getAttribute('target') || '').toLowerCase();
      if (targetAttr && targetAttr !== '_self') return null;
      var href = link.getAttribute('href');
      if (!href || href.charAt(0) === '#') return null;
      if (/^(mailto:|tel:|javascript:)/i.test(href)) return null;
      var url;
      try { url = new URL(link.href, location.href); } catch (err) { return null; }
      if (url.origin !== location.origin) return null;
      if (propertyOf(url.pathname) !== here) return null;
      var pathLower = url.pathname.toLowerCase();
      if (pathLower.indexOf('/downloads/') === 0 || FILE_RE.test(pathLower)) return null;
      return url;
    }

    function closestLink(node) {
      return node && node.closest ? node.closest('a') : (node && node.parentElement ? node.parentElement.closest('a') : null);
    }

    var lastSoftAt = 0;
    function followSoft(url, event) {
      if (url.pathname === location.pathname && url.search === location.search) {
        /* Same document. A normal click reloads and destroys the iframe. */
        if (here === 'papirglider' || here === 'business' || here === 'lab') {
          event.preventDefault();
          if (url.hash && url.hash.length > 1) reveal(url, 0);
          else window.scrollTo(0, 0);
        }
        return;
      }
      event.preventDefault();
      lastSoftAt = Date.now();
      softNavigate(url, true, 0);
    }

    function onClick(event) {
      if (event.defaultPrevented) return;
      if (event.button !== 0 && event.button != null) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (Date.now() - lastSoftAt < 700) return;
      var url = linkToSoftUrl(closestLink(event.target));
      if (!url) return;
      followSoft(url, event);
    }

    /* iOS starts the load on touchend, before click can preventDefault.
       That full load is what destroyed the iframe on a phone. */
    var touchPoint = null;
    document.addEventListener('touchstart', function (event) {
      var t = event.changedTouches && event.changedTouches[0];
      touchPoint = t ? { x: t.clientX, y: t.clientY } : null;
    }, { capture: true, passive: true });
    document.addEventListener('touchend', function (event) {
      if (event.defaultPrevented) return;
      var t = event.changedTouches && event.changedTouches[0];
      if (!t || !touchPoint) return;
      if (Math.abs(t.clientX - touchPoint.x) > 14 || Math.abs(t.clientY - touchPoint.y) > 14) return;
      var url = linkToSoftUrl(closestLink(event.target));
      if (!url) return;
      followSoft(url, event);
    }, { capture: true, passive: false });

    function reviveLabScripts(doc) {
      var tracked = window.__ladenPageListeners || [];
      tracked.forEach(function (rec) {
        try { rec.t.removeEventListener(rec.type, rec.fn, rec.opt); } catch (err) {}
      });
      window.__ladenPageListeners = [];
      var timers = window.__ladenPageTimers || [];
      timers.forEach(function (id) {
        clearInterval(id);
        clearTimeout(id);
      });
      window.__ladenPageTimers = [];
      var origAdd = EventTarget.prototype.addEventListener;
      var origSI = window.setInterval;
      var origST = window.setTimeout;
      EventTarget.prototype.addEventListener = function (type, fn, opt) {
        window.__ladenPageListeners.push({ t: this, type: type, fn: fn, opt: opt });
        return origAdd.call(this, type, fn, opt);
      };
      window.setInterval = function () {
        var id = origSI.apply(window, arguments);
        window.__ladenPageTimers.push(id);
        return id;
      };
      window.setTimeout = function () {
        var id = origST.apply(window, arguments);
        window.__ladenPageTimers.push(id);
        return id;
      };
      function restore() {
        EventTarget.prototype.addEventListener = origAdd;
        window.setInterval = origSI;
        window.setTimeout = origST;
        try { if (window.LadenI18n && LadenI18n.apply) LadenI18n.apply(document); } catch (err) {}
        kickPlayback();
      }
      var list = Array.prototype.slice.call(doc.querySelectorAll('script'));
      var i = 0;
      function step() {
        if (i >= list.length) { restore(); return; }
        var node = list[i++];
        var src = node.getAttribute('src') || '';
        var abs = '';
        try { abs = src ? new URL(src, location.href).pathname : ''; } catch (err) {}
        if (abs === '/js/soundcloud-player.js') { step(); return; }
        if (src.indexOf('impactcdn.com') !== -1 || (node.textContent || '').indexOf('impactStat') !== -1) { step(); return; }
        var type = node.getAttribute('type') || '';
        if (type.indexOf('json') !== -1) { step(); return; }
        var el = document.createElement('script');
        if (type) el.type = type;
        if (src) {
          el.src = src;
          el.async = false;
          el.onload = step;
          el.onerror = step;
          document.body.appendChild(el);
        } else {
          el.text = node.textContent || '';
          document.body.appendChild(el);
          step();
        }
      }
      step();
    }

    window.__ladenSoftGo = function (href) {
      var url;
      try { url = new URL(href, location.href); } catch (err) { return; }
      if (url.origin !== location.origin || propertyOf(url.pathname) !== here) {
        hardGo(url.href);
        return;
      }
      softNavigate(url, true, 0);
    };

    stampHistory();
    document.addEventListener('click', onClick, true);
    window.addEventListener('popstate', function (event) {
      if (propertyOf(location.pathname) !== here) {
        window.location.reload();
        return;
      }
      var y = event.state && typeof event.state.y === 'number' ? event.state.y : 0;
      softNavigate(new URL(location.href), false, y);
    });
  }

  readState();
  exposeBusinessAudio();
  installPropertyShell();
  /* With a deferred head script, body already exists before execution. Mount
     immediately so the iframe and API can race in parallel; retain the
     fallback for unusual embeds that execute before body creation. */
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount, { once: true });
})();
