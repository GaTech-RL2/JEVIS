// Results radar: multi-/single-agent switch (multi-agent by default), hover readouts per axis,
// and a legend that shows/hides methods. Data: static/js/radar-data.js, generated from the
// paper's results tables.
(function () {
  'use strict';
  var DATA = window.RADAR_DATA, root = document.getElementById('radar');
  if (!DATA || !root) return;

  var SVGNS = 'http://www.w3.org/2000/svg';
  // clockwise from the top, as on the GAVIS radar, with T_UP and UQ merged into T_UQ
  var AXES = [
    { key: 'PSNR', name: 'PSNR', unit: 'dB', digits: 2 },
    { key: 'T_UQ', name: 'T', sub: 'UQ', unit: 'ms', digits: 2, lowerIsBetter: true, log: true },
    { key: 'VIS', name: 'VIS', digits: 3 },
    { key: 'CR', name: 'CR', digits: 3 },
    { key: 'LPIPS', name: 'LPIPS', digits: 3, lowerIsBetter: true },
    { key: 'SSIM', name: 'SSIM', digits: 3 }
  ];
  var N = AXES.length;
  // validated categorical order; color follows the method, never its rank
  var COLORS = { 'JEVIS': '#2a78d6', 'GAVIS': '#eb6834', 'MAGICIAN': '#1baf7a', 'COVER': '#eda100',
                 'VIMC': '#e87ba4', 'FisherRF': '#008300', 'FisherRF-B': '#4a3aa7' };
  var ORDER = DATA.methods;  // paper order, ours last so it is drawn on top
  var C = [320, 278], R = 214;

  var svg = root.querySelector('.radar-chart'), tip = root.querySelector('.radar-tip');
  var title = root.querySelector('.radar-title'), legendEl = root.querySelector('.radar-legend');
  var state = { setting: 'multi', hidden: {} }, current = null, lastRadii = null, series = {}, spokes = [], labels = [];

  // ---------- helpers ----------
  function s(tag, attrs, parent) {
    var el = document.createElementNS(SVGNS, tag);
    for (var k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
  }
  function angle(i) { return -Math.PI / 2 + i * 2 * Math.PI / N; }
  function xy(r, i) { var a = angle(i); return [C[0] + R * r * Math.cos(a), C[1] + R * r * Math.sin(a)]; }
  function points(rs) { return rs.map(function (r, i) { return xy(r, i).map(function (v) { return v.toFixed(2); }).join(','); }).join(' '); }
  function fmt(axis, v) { return v.toFixed(axis.digits) + (axis.unit ? ' ' + axis.unit : ''); }
  function displayName(m) { return m === 'JEVIS' ? 'JEVIS (ours)' : m; }
  function labelHTML(axis) {  // "T<sub>UQ</sub> (ms)" built as DOM
    var span = document.createElement('span');
    span.appendChild(document.createTextNode(axis.name));
    if (axis.sub) { var sub = document.createElement('sub'); sub.textContent = axis.sub; span.appendChild(sub); }
    if (axis.unit) span.appendChild(document.createTextNode(' (' + axis.unit + ')'));
    return span;
  }
  function ranked(rows, methods, axis) {
    return methods.slice().sort(function (p, q) {
      var a = rows[p][axis.key], b = rows[q][axis.key];
      return a === b ? 0 : ((axis.lowerIsBetter ? a < b : a > b) ? -1 : 1);
    });
  }

  // ---------- scales ----------
  // Each axis maps values to a radius in [0, 1]; the rings sit at 1/3, 2/3 and 1. Linear axes put the
  // worst method around r = 0.33-0.5 and the best near the rim, with round tick labels; T_UQ is
  // log-scaled (like T_UP on the GAVIS radar). LPIPS and T_UQ are flipped so farther out is better.
  var NICE = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  function niceAtLeast(x) { var p = Math.pow(10, Math.floor(Math.log10(x))); for (var i = 0; i < NICE.length; i++) if (NICE[i] * p >= x * (1 - 1e-9)) return NICE[i] * p; }
  function niceAtMost(x) { var p = Math.pow(10, Math.floor(Math.log10(x))); for (var i = NICE.length - 1; i >= 0; i--) if (NICE[i] * p <= x * (1 + 1e-9)) return NICE[i] * p; }
  function decimalsOf(x) { for (var d = 0; d < 6; d++) if (Math.abs(x * Math.pow(10, d) - Math.round(x * Math.pow(10, d))) < 1e-6) return d; return 6; }

  function linearScale(axis, vals) {
    var sign = axis.lowerIsBetter ? -1 : 1, g = vals.map(function (v) { return sign * v; });
    var gmin = Math.min.apply(null, g), gmax = Math.max.apply(null, g), span = (gmax - gmin) || Math.abs(gmax) * 0.1 || 1;
    var step = niceAtLeast(span * 1.55 / 3), d = decimalsOf(step), unit = Math.pow(10, -d);
    var hi = Math.ceil((gmax + 0.03 * span) / unit - 1e-9) * unit, lo = hi - 3 * step;
    return { r: function (v) { return (sign * v - lo) / (hi - lo); },
             ticks: [1, 2, 3].map(function (k) { return { r: k / 3, text: (sign * (lo + k * step)).toFixed(d) }; }) };
  }
  function logScale(vals) {
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    var hi = niceAtMost(mn * 0.97), f = 2, center = hi * 8, FACTORS = [1.5, 2, 2.5, 3, 4, 5, 8, 10];
    for (var i = 0; i < FACTORS.length; i++) {
      f = FACTORS[i]; center = hi * Math.pow(f, 3);
      if (Math.log(center / mx) / Math.log(center / hi) >= 0.25) break;
    }
    var L = Math.log(center / hi);
    return { r: function (v) { return Math.log(center / v) / L; },
             ticks: [1, 2, 3].map(function (k) { var v = hi * Math.pow(f, 3 - k); return { r: k / 3, text: String(+v.toFixed(v >= 100 ? 0 : 1)) }; }) };
  }
  function scales(rows, keys) {
    var out = {};
    AXES.forEach(function (a) {
      var vals = keys.map(function (k) { return rows[k][a.key]; });
      out[a.key] = a.log ? logScale(vals) : linearScale(a, vals);
    });
    return out;
  }
  // one scale per axis covering both settings, so the rings and the maximum stay put when switching
  var SCALES = (function () {
    var both = {}, keys = [];
    Object.keys(DATA.settings).forEach(function (k) {
      ORDER.forEach(function (m) { both[k + ':' + m] = DATA.settings[k].mean[m]; keys.push(k + ':' + m); });
    });
    return scales(both, keys);
  })();

  // ---------- drawing ----------
  var gGrid = s('g', {}, svg);
  [1 / 3, 2 / 3, 1].forEach(function (r, k) { s('circle', { cx: C[0], cy: C[1], r: R * r, 'class': k === 2 ? 'radar-ring radar-ring-outer' : 'radar-ring' }, gGrid); });
  AXES.forEach(function (a, i) { var e = xy(1, i); spokes.push(s('line', { x1: C[0], y1: C[1], x2: e[0], y2: e[1], 'class': 'radar-spoke' }, gGrid)); });
  var gTicks = s('g', {}, svg), gSeries = s('g', {}, svg), gLabels = s('g', {}, svg);
  AXES.forEach(function (a, i) {
    var p = xy(1.15, i), cos = Math.cos(angle(i));
    var g = s('g', { 'class': 'radar-label', tabindex: 0, 'data-axis': i }, gLabels);
    var t = s('text', { x: p[0], y: p[1], 'text-anchor': Math.abs(cos) < 0.2 ? 'middle' : (cos > 0 ? 'start' : 'end'), 'dominant-baseline': 'central' }, g);
    s('tspan', {}, t).textContent = a.name;
    if (a.sub) { s('tspan', { dy: '0.32em', 'font-size': '0.7em' }, t).textContent = a.sub; s('tspan', { dy: '-0.32em' }, t).textContent = ' (' + a.unit + ')'; }
    else if (a.unit) s('tspan', {}, t).textContent = ' (' + a.unit + ')';
    labels.push(g);
  });
  ORDER.forEach(function (m) {
    var ours = m === 'JEVIS', g = s('g', { 'class': 'radar-series', 'data-method': m }, gSeries);
    var poly = s('polygon', { fill: ours ? COLORS[m] : 'none', 'fill-opacity': ours ? 0.12 : 0, stroke: COLORS[m],
                              'stroke-width': ours ? 2.75 : 1.75, 'stroke-linejoin': 'round' }, g);
    var dots = AXES.map(function () { return s('circle', { r: ours ? 4.5 : 4, fill: COLORS[m], stroke: '#fff', 'stroke-width': 2 }, g); });
    series[m] = { g: g, poly: poly, dots: dots };
  });

  function draw(radii) {
    ORDER.forEach(function (m) {
      series[m].poly.setAttribute('points', points(radii[m]));
      series[m].dots.forEach(function (d, i) { var p = xy(radii[m][i], i); d.setAttribute('cx', p[0].toFixed(2)); d.setAttribute('cy', p[1].toFixed(2)); });
    });
  }
  function drawTicks(sc) {
    gTicks.textContent = '';
    AXES.forEach(function (a, i) {
      sc[a.key].ticks.forEach(function (t) {
        var ang = angle(i) + 0.07 / Math.max(t.r, 0.34), rr = R * t.r;
        s('text', { x: C[0] + rr * Math.cos(ang), y: C[1] + rr * Math.sin(ang), 'class': 'radar-tick', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, gTicks).textContent = t.text;
      });
    });
  }

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function render(animate) {
    var rows = DATA.settings[state.setting].mean, sc = SCALES, target = {};
    ORDER.forEach(function (m) { target[m] = AXES.map(function (a) { return Math.max(0, sc[a.key].r(rows[m][a.key])); }); });
    current = rows;
    title.textContent = DATA.settings[state.setting].title;
    drawTicks(sc);
    ORDER.forEach(function (m) { series[m].g.classList.toggle('is-hidden', !!state.hidden[m]); });
    if (activeAxis >= 0) fillTip(activeAxis);
    var from = lastRadii;
    lastRadii = target;
    if (!animate || !from || reduceMotion) { draw(target); return; }
    var t0 = null;
    requestAnimationFrame(function frame(ts) {  // ease between the two settings
      if (t0 === null) t0 = ts;
      var t = Math.min(1, (ts - t0) / 480), e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2, mid = {};
      ORDER.forEach(function (m) { mid[m] = target[m].map(function (v, i) { return from[m][i] * (1 - e) + v * e; }); });
      draw(mid);
      if (t < 1) requestAnimationFrame(frame);
    });
  }

  // ---------- hover readout ----------
  var activeAxis = -1;
  function fillTip(i) {
    var axis = AXES[i];
    tip.textContent = '';
    var h = document.createElement('div'); h.className = 'radar-tip-h';
    h.appendChild(labelHTML(axis));
    var hint = document.createElement('span'); hint.className = 'radar-tip-hint';
    hint.textContent = axis.lowerIsBetter ? 'lower is better' : 'higher is better';
    h.appendChild(hint); tip.appendChild(h);
    ranked(current, ORDER.filter(function (m) { return !state.hidden[m]; }), axis).forEach(function (m) {
      var row = document.createElement('div'); row.className = 'radar-tip-row';
      var key = document.createElement('span'); key.className = 'radar-tip-key'; key.style.borderColor = COLORS[m];
      var val = document.createElement('span'); val.className = 'radar-tip-val'; val.textContent = fmt(axis, current[m][axis.key]);
      var nm = document.createElement('span'); nm.className = 'radar-tip-name'; nm.textContent = displayName(m);
      row.appendChild(key); row.appendChild(val); row.appendChild(nm); tip.appendChild(row);
    });
  }
  function showAxis(i, clientX, clientY) {
    if (i !== activeAxis) {
      activeAxis = i;
      spokes.forEach(function (l, k) { l.classList.toggle('is-on', k === i); });
      labels.forEach(function (l, k) { l.classList.toggle('is-on', k === i); });
      if (i >= 0) fillTip(i);
    }
    if (i < 0) { tip.classList.remove('is-shown'); return; }
    var box = root.querySelector('.radar-wrap').getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
    var x = clientX - box.left + 16, y = clientY - box.top + 16;
    if (x + tw > box.width) x = clientX - box.left - tw - 16;
    if (y + th > box.height) y = Math.max(0, clientY - box.top - th - 16);
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
    tip.classList.add('is-shown');
  }
  function axisAt(e) {  // which axis wedge a pointer is over, or -1
    var pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    var p = pt.matrixTransform(svg.getScreenCTM().inverse()), dx = p.x - C[0], dy = p.y - C[1], d = Math.sqrt(dx * dx + dy * dy);
    if (d < R * 0.12 || d > R * 1.3) return -1;
    var a = ((Math.atan2(dy, dx) + Math.PI / 2) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    return Math.round(a / (2 * Math.PI / N)) % N;
  }
  // mouse/pen: the readout follows the pointer. Touch: a tap shows that axis until the next tap
  // elsewhere, and the chart never blocks page scrolling.
  svg.addEventListener('pointermove', function (e) { if (e.pointerType !== 'touch') showAxis(axisAt(e), e.clientX, e.clientY); });
  svg.addEventListener('pointerleave', function (e) { if (e.pointerType !== 'touch') showAxis(-1); });
  svg.addEventListener('pointerdown', function (e) { if (e.pointerType === 'touch') showAxis(axisAt(e), e.clientX, e.clientY); });
  document.addEventListener('pointerdown', function (e) { if (e.pointerType === 'touch' && !svg.contains(e.target)) showAxis(-1); });
  svg.addEventListener('focusin', function (e) {  // keyboard: focus an axis label for the same readout
    var g = e.target.closest('[data-axis]');
    if (g) { var b = g.getBoundingClientRect(); showAxis(+g.getAttribute('data-axis'), b.left + b.width / 2, b.top + b.height / 2); }
  });
  svg.addEventListener('focusout', function () { showAxis(-1); });

  // ---------- legend: click to show/hide, hover to highlight ----------
  function highlight(m) {
    ORDER.forEach(function (k) { series[k].g.classList.toggle('is-dim', !!m && k !== m); });
    if (m) gSeries.appendChild(series[m].g);
    else ORDER.forEach(function (k) { gSeries.appendChild(series[k].g); });  // restore draw order
  }
  ORDER.forEach(function (m) {
    var b = document.createElement('button');
    b.type = 'button'; b.setAttribute('aria-pressed', 'true'); b.dataset.method = m;
    var lk = document.createElement('span'); lk.className = 'radar-key'; lk.style.borderColor = COLORS[m]; lk.style.color = COLORS[m];
    var nm = document.createElement('span'); nm.textContent = displayName(m); if (m === 'JEVIS') nm.className = 'radar-ours';
    b.appendChild(lk); b.appendChild(nm);
    b.addEventListener('click', function () {
      state.hidden[m] = !state.hidden[m];
      b.setAttribute('aria-pressed', String(!state.hidden[m]));
      series[m].g.classList.toggle('is-hidden', state.hidden[m]);
    });
    b.addEventListener('pointerenter', function () { highlight(m); });
    b.addEventListener('pointerleave', function () { highlight(null); });
    b.addEventListener('focus', function () { highlight(m); });
    b.addEventListener('blur', function () { highlight(null); });
    legendEl.appendChild(b);
  });

  // ---------- setting switch ----------
  root.querySelectorAll('.seg button').forEach(function (b) {
    b.addEventListener('click', function () {
      if (b.getAttribute('aria-pressed') === 'true') return;
      root.querySelectorAll('.seg button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      state.setting = b.dataset.setting;
      render(true);
    });
  });

  render(false);
})();
