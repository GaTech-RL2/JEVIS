// A slim scrub bar under every video (the teaser included) and a playback-speed menu under the
// result videos. Click or drag the bar to scrub; with the bar focused, the arrow keys step 2 s.
(function () {
  'use strict';
  var SPEEDS = [0.5, 1, 1.5, 2];
  var GAUGE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.6 17a8.5 8.5 0 1 1 14.8 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
              '<path d="M12 15l4.2-5.2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="15" r="1.8" fill="currentColor"/></svg>';

  // one speed menu open at a time; it closes on a click elsewhere or Escape
  var openMenu = null;
  document.addEventListener('pointerdown', function (e) { if (openMenu && !openMenu.wrap.contains(e.target)) openMenu.close(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && openMenu) { var m = openMenu; m.close(); m.btn.focus(); }
  });

  // speedometer button showing the current speed; clicking it opens the list of speeds to pick from
  function speedMenu(video) {
    var wrap = document.createElement('div');
    wrap.className = 'vspeed';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'vspeed-btn';
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = GAUGE;  // static icon markup, no data in it
    var label = document.createElement('span');
    btn.appendChild(label);
    var menu = document.createElement('div');
    menu.className = 'vspeed-menu';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;
    var head = document.createElement('div');
    head.className = 'vspeed-head';
    head.textContent = 'Playback speed';
    menu.appendChild(head);
    var api;
    var items = SPEEDS.map(function (s) {
      var it = document.createElement('button');
      it.type = 'button';
      it.className = 'vspeed-item';
      it.setAttribute('role', 'menuitemradio');
      it.textContent = s + '×';
      it.addEventListener('click', function () { set(s); api.close(); btn.focus(); });
      menu.appendChild(it);
      return it;
    });
    function set(s) {
      video.defaultPlaybackRate = s;  // survives the lazy src load
      video.playbackRate = s;
      label.textContent = s + '×';
      btn.setAttribute('aria-label', 'Playback speed ' + s + 'x');
      items.forEach(function (it, k) { it.setAttribute('aria-checked', String(SPEEDS[k] === s)); });
    }
    api = {
      wrap: wrap, btn: btn,
      open: function () {
        if (openMenu && openMenu !== api) openMenu.close();
        menu.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
        wrap.classList.add('is-open');
        openMenu = api;
        var current = menu.querySelector('[aria-checked="true"]');
        if (current) current.focus();
      },
      close: function () {
        menu.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
        wrap.classList.remove('is-open');
        if (openMenu === api) openMenu = null;
      }
    };
    btn.addEventListener('click', function () { if (menu.hidden) api.open(); else api.close(); });
    menu.addEventListener('keydown', function (e) {  // up/down move through the options
      var k = items.indexOf(document.activeElement);
      if (k < 0 || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
      e.preventDefault();
      items[(k + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
    });
    wrap.appendChild(btn);
    wrap.appendChild(menu);
    set(1);
    return wrap;
  }

  function attach(video, withSpeed) {
    var row = document.createElement('div');
    row.className = 'vbar';
    var track = document.createElement('div');
    track.className = 'vbar-track';
    track.tabIndex = 0;
    track.setAttribute('role', 'slider');
    track.setAttribute('aria-label', 'Video position');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    var fill = document.createElement('div');
    fill.className = 'vbar-fill';
    var knob = document.createElement('div');
    knob.className = 'vbar-knob';
    track.appendChild(fill);
    track.appendChild(knob);
    row.appendChild(track);
    if (withSpeed) row.appendChild(speedMenu(video));
    video.insertAdjacentElement('afterend', row);

    // while dragging, the bar follows the pointer at once and the video catches up
    var dragFrac = null, wasPlaying = false, pending = null, seeking = false;
    function paint() {
      var f = dragFrac !== null ? dragFrac
            : (video.duration ? Math.max(0, Math.min(1, video.currentTime / video.duration)) : 0);
      fill.style.clipPath = 'inset(0 ' + (100 - f * 100).toFixed(3) + '% 0 0 round 2px)';
      knob.style.left = (f * 100).toFixed(3) + '%';
      track.setAttribute('aria-valuenow', String(Math.round(f * 100)));
    }
    var raf = 0;
    function frame() { paint(); raf = video.paused ? 0 : requestAnimationFrame(frame); }
    video.addEventListener('play', function () { if (!raf) raf = requestAnimationFrame(frame); });
    ['pause', 'seeked', 'loadedmetadata', 'timeupdate'].forEach(function (t) { video.addEventListener(t, paint); });

    // only the newest position is sought: a new seek starts once the previous frame is on screen,
    // so fast drags don't pile up seeks and the picture tracks the pointer smoothly both ways
    function requestSeek(t) {
      pending = t;
      if (!seeking) flush();
    }
    function flush() {
      if (pending === null) return;
      seeking = true;
      video.currentTime = pending;
      pending = null;
    }
    video.addEventListener('seeked', function () { seeking = false; flush(); });

    function scrubTo(clientX) {
      var r = track.getBoundingClientRect();
      dragFrac = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      paint();
      requestSeek(dragFrac * video.duration);
    }
    function endDrag() {
      if (dragFrac === null) return;
      track.classList.remove('is-drag');
      dragFrac = null;
      if (wasPlaying) { var p = video.play(); if (p && p.catch) p.catch(function () {}); }
    }
    track.addEventListener('pointerdown', function (e) {
      if (!video.duration) return;
      e.preventDefault();
      track.setPointerCapture(e.pointerId);
      track.classList.add('is-drag');
      wasPlaying = !video.paused;
      video.pause();
      scrubTo(e.clientX);
    });
    track.addEventListener('pointermove', function (e) { if (dragFrac !== null && track.hasPointerCapture(e.pointerId)) scrubTo(e.clientX); });
    track.addEventListener('pointerup', endDrag);
    track.addEventListener('pointercancel', endDrag);
    track.addEventListener('keydown', function (e) {
      var step = e.key === 'ArrowRight' ? 2 : (e.key === 'ArrowLeft' ? -2 : 0);
      if (!step || !video.duration) return;
      e.preventDefault();
      requestSeek(Math.max(0, Math.min(video.duration - 0.05, video.currentTime + step)));
    });
    paint();
    return row;
  }

  document.querySelectorAll('.video-fig video').forEach(function (v) { attach(v, true); });

  // teaser: bar only, as wide as the visible (letterboxed) picture rather than the full-width box
  var teaser = document.querySelector('.teaser-anim video');
  if (teaser) {
    var row = attach(teaser, false);
    var size = function () {
      var r = teaser.getBoundingClientRect();
      row.style.width = Math.round(Math.min(r.width, r.height * 16 / 9)) + 'px';
    };
    size();
    // follow the video's own box, which settles only after the page's resize handlers have run (one of them sets
    // the title block's height the teaser is sized from); a window resize listener could measure it half-way
    if ('ResizeObserver' in window) new ResizeObserver(size).observe(teaser);
    else window.addEventListener('resize', size);
  }
})();
