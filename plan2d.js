/* plan2d.js: flat 2D floor plan of the MSC 1st floor with map-search style value pins
 * (the price-pill pattern used by Airbnb / Google Maps search, here showing dBA).
 * The plan is our traced SVG (assets/msc-floor1.svg). Pan and zoom are plain viewBox math
 * (wheel, drag, pinch, buttons); pins are HTML so they keep a constant on-screen size.
 * API: createPlan(container, { svgText, places, markers, areaNames, onPick, onHover, callout })
 *   -> { update(markers), setVisible(layers), select(id, fly), hover(id), fit(), dispose() } */
const NS = 'http://www.w3.org/2000/svg';

const ICONS = {
  water: '<path d="M12 3.6c3.1 3.7 5.6 6.7 5.6 9.7a5.6 5.6 0 0 1-11.2 0c0-3 2.5-6 5.6-9.7z"/>',
  vending: '<rect x="6" y="3.5" width="12" height="17" rx="1.6"/><path d="M8.8 7.5h4.2M8.8 10.5h4.2M8.8 13.5h4.2M15.4 7.2v6.6M9 17.4h6"/>',
  microwave: '<rect x="3.5" y="6" width="17" height="12" rx="1.6"/><rect x="6" y="8.6" width="8.6" height="6.8" rx="1"/><path d="M17.4 9.2v.1M17.4 12v.1M17.4 14.8v.1"/>',
  printer: '<path d="M7.2 9V4.2h9.6V9"/><rect x="4" y="9" width="16" height="7.4" rx="1.6"/><path d="M7.2 13.6h9.6v6.2H7.2z"/>'
};

function el(tag, attrs = {}, parent) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}
function div(cls, parent, tag = 'div') {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (parent) parent.appendChild(n);
  return n;
}
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function wrapWords(name, max = 15) {
  const out = [];
  let line = '';
  name.split(/\s+/).forEach((w) => {
    if (line && (line + ' ' + w).length > max) { out.push(line); line = w; } else line = line ? line + ' ' + w : w;
  });
  if (line) out.push(line);
  return out;
}

export function createPlan(container, spec) {
  const doc = new DOMParser().parseFromString(spec.svgText, 'image/svg+xml');
  const outlineD = doc.querySelector('.plan-outline')?.getAttribute('d') || '';
  const pts = (outlineD.match(/-?\d+(\.\d+)?/g) || []).map(Number);
  const xs = pts.filter((_, i) => i % 2 === 0), ys = pts.filter((_, i) => i % 2 === 1);
  const B = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  B.w = B.x1 - B.x0; B.h = B.y1 - B.y0;

  /* ---------- DOM ---------- */
  const root = div('plan2d', container);
  const stage = div('plan-stage', root);   // tilted as one 3D plane in 3D view
  const svg = el('svg', { class: 'plan-svg', role: 'img', 'aria-label': 'Floor plan of the MSC 1st floor' }, stage);
  const defs = el('defs', {}, svg);
  const hatch = el('pattern', { id: 'p2d-hatch', width: 8, height: 8, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
  el('rect', { width: 8, height: 8, class: 'hatch-bg' }, hatch);
  el('line', { x1: 0, y1: 0, x2: 0, y2: 8, class: 'hatch-line' }, hatch);
  const shadow = el('filter', { id: 'p2d-shadow', x: '-10%', y: '-10%', width: '120%', height: '120%' }, defs);
  el('feDropShadow', { dx: 0, dy: 10, stdDeviation: 14, 'flood-color': '#2a2118', 'flood-opacity': 0.14 }, shadow);

  const world = el('g', { class: 'world' }, svg);
  el('path', { d: outlineD, class: 'floor', filter: 'url(#p2d-shadow)' }, world);
  const roomsG = el('g', { class: 'rooms' }, world);
  const areaPaths = new Map();
  doc.querySelectorAll('path.room').forEach((r) => {
    const d = r.getAttribute('d');
    const cls = ['room'];
    if (r.classList.contains('open')) cls.push('open');
    if (r.classList.contains('service')) cls.push('service');
    const p = el('path', { d, class: cls.join(' ') }, roomsG);
    const a = r.getAttribute('data-area');
    if (a) {
      p.setAttribute('data-area', a);
      if (!areaPaths.has(a)) areaPaths.set(a, []);
      areaPaths.get(a).push(d);
    }
  });
  el('path', { d: outlineD, class: 'outline' }, world);

  const iconsG = el('g', { class: 'fixtures' }, world);
  doc.querySelectorAll('.icon.stairs rect').forEach((r) => {
    el('rect', { x: r.getAttribute('x'), y: r.getAttribute('y'), width: r.getAttribute('width'), height: r.getAttribute('height'), class: 'stairs' }, iconsG);
  });
  doc.querySelectorAll('.icon.elevator rect').forEach((r) => {
    el('rect', { x: r.getAttribute('x'), y: r.getAttribute('y'), width: r.getAttribute('width'), height: r.getAttribute('height'), rx: 4, class: 'elevator' }, iconsG);
  });
  doc.querySelectorAll('.icon.restroom circle').forEach((c) => {
    el('circle', { cx: c.getAttribute('cx'), cy: c.getAttribute('cy'), r: 9, class: 'restroom' }, iconsG);
  });
  doc.querySelectorAll('.icon.entrance path').forEach((p) => el('path', { d: p.getAttribute('d'), class: 'entrance' }, iconsG));

  /* ---------- area names, placed where they collide least with pins ---------- */
  const labelsG = el('g', { class: 'area-labels' }, world);
  const ctx = document.createElement('canvas').getContext('2d');
  // Walls for the 3D view: the room outlines repeated on thin layers stacked in z (CSS 3D), which reads as solid low walls.
  const WALL_LAYERS = 12;
  const wallDs = [...doc.querySelectorAll('path.room')].map((r) => r.getAttribute('d'));
  const walls = [];
  for (let i = 1; i <= WALL_LAYERS; i++) {
    const w = el('svg', { class: 'plan-svg wall-layer' + (i === WALL_LAYERS ? ' wall-top' : ''), 'aria-hidden': 'true' }, stage);
    const g = el('g', {}, w);
    wallDs.forEach((d) => el('path', { d, class: 'wall' }, g));
    el('path', { d: outlineD, class: 'wall outer' }, g);
    walls.push(w);
  }

  const placesXY = spec.places.map((p) => [p.x, p.y]);
  Object.entries(spec.areaNames || {}).forEach(([num, name]) => {
    const ds = areaPaths.get(String(num));
    if (!ds || !name) return;
    const paths = ds.map((d) => new Path2D(d));
    const nums = ds.join(' ').match(/-?\d+(\.\d+)?/g).map(Number);
    const ax = nums.filter((_, i) => i % 2 === 0), ay = nums.filter((_, i) => i % 2 === 1);
    const bx0 = Math.min(...ax), bx1 = Math.max(...ax), by0 = Math.min(...ay), by1 = Math.max(...ay);
    const lines = wrapWords(name.toUpperCase(), (bx1 - bx0) > 300 ? 22 : 13);
    const fs = 15;
    const lw = Math.max(...lines.map((l) => l.length)) * fs * 0.68, lh = lines.length * fs * 1.25;
    if (lw > (bx1 - bx0) * 1.15 && lines.length > 2) return;
    const cxm = (bx0 + bx1) / 2, cym = (by0 + by1) / 2;
    let best = null;
    for (let i = 0; i <= 8; i++) {
      for (let j = 0; j <= 8; j++) {
        const x = bx0 + (bx1 - bx0) * (0.1 + 0.8 * i / 8), y = by0 + (by1 - by0) * (0.1 + 0.8 * j / 8);
        if (!paths.some((p) => ctx.isPointInPath(p, x, y))) continue;
        // distance from the label box to the nearest pin (pins are ~36 px wide at fit zoom)
        let clear = Infinity;
        placesXY.forEach(([px, py]) => {
          const dx = Math.max(0, Math.abs(px - x) - lw / 2), dy = Math.max(0, Math.abs(py - y) - lh / 2);
          clear = Math.min(clear, Math.hypot(dx, dy));
        });
        const score = Math.min(clear, 70) * 3 - Math.hypot(x - cxm, y - cym) * 0.25;
        if (!best || score > best.score) best = { x, y, score };
      }
    }
    if (!best) return;
    const t = el('text', { x: best.x, y: best.y - lh / 2 + fs * 0.95, class: 'area-name' }, labelsG);
    lines.forEach((l, i) => { const ts = el('tspan', { x: best.x, dy: i ? fs * 1.25 : 0 }, t); ts.textContent = l; });
  });

  const pinsLayer = div('pins', root);
  const tip = div('plan-tip', root);
  tip.hidden = true;
  const ctrls = div('plan-zoom', root);
  const mkBtn = (label, title, fn) => { const b = div('', ctrls, 'button'); b.type = 'button'; b.textContent = label; b.title = title; b.setAttribute('aria-label', title); b.addEventListener('click', fn); return b; };
  mkBtn('+', 'Zoom in', () => zoomAt(W / 2, H / 2, 1.6, true));
  mkBtn('−', 'Zoom out', () => zoomAt(W / 2, H / 2, 1 / 1.6, true));
  mkBtn('⤢', 'Show the whole floor', () => fit(true));
  const tiltBtn = mkBtn('3D', 'Switch between 3D and flat view', () => setTilt(tiltTarget ? 0 : 1, true));
  tiltBtn.classList.add('tilt-btn');

  /* ---------- pins ---------- */
  const pins = new Map();
  spec.places.forEach((p) => {
    const b = div('pin pin-' + p.layer, pinsLayer, 'button');
    b.type = 'button';
    b.dataset.id = p.id;
    b.style.setProperty('--d', Math.round(((p.x - B.x0) / B.w) * 600 + 250) + 'ms');
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const pin = pins.get(p.id);
      if (pin.clusterOf && pin.clusterOf.length > 1) {
        const cx = pin.clusterOf.reduce((s, q) => s + q.x, 0) / pin.clusterOf.length;
        const cy = pin.clusterOf.reduce((s, q) => s + q.y, 0) / pin.clusterOf.length;
        flyTo(cx, cy, Math.min(kMax, k * 2.4));
        return;
      }
      spec.onPick && spec.onPick(p.id);
    });
    b.addEventListener('mouseenter', () => { setHover(p.id); spec.onHover && spec.onHover(p.id); });
    b.addEventListener('mouseleave', () => { setHover(null); spec.onHover && spec.onHover(null); });
    b.addEventListener('focus', () => setHover(p.id));
    b.addEventListener('blur', () => setHover(null));
    pins.set(p.id, { p, el: b, visible: true, clusterOf: null });
  });

  function update(markers) {
    pins.forEach(({ p, el: b }) => {
      const m = markers[p.id] || {};
      b.style.setProperty('--c', m.color || '#888');
      b.classList.toggle('is-unmeasured', !m.measured);
      if (p.layer === 'study') {
        b.innerHTML = m.measured ? `<i></i><b>${m.label}</b><small>dB</small>` : '<i></i>';
      } else {
        b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[p.layer] || ''}</svg><em></em>`;
      }
      b.setAttribute('aria-label', spec.callout ? spec.callout(p.id).title + ': ' + spec.callout(p.id).sub : p.id);
    });
    pins.forEach((pin) => { pin.size = null; });
    layout();
    if (hovered) setHover(hovered);
  }

  function setVisible(keys) {
    const on = new Set(keys);
    pins.forEach((pin) => { pin.visible = on.has(pin.p.layer); });
    layout();
  }

  let selected = null, hovered = null;
  function select(id, fly) {
    if (selected && pins.get(selected)) pins.get(selected).el.classList.remove('is-selected');
    selected = id;
    const pin = id && pins.get(id);
    if (!pin) return;
    pin.el.classList.add('is-selected');
    pin.el.classList.remove('bump'); void pin.el.offsetWidth; pin.el.classList.add('bump');
    if (fly) {
      const want = Math.max(k, fitK * 2.2);
      flyTo(pin.p.x, pin.p.y, Math.min(kMax, want));
    } else layout();
  }
  function setHover(id) {
    if (hovered && pins.get(hovered)) pins.get(hovered).el.classList.remove('is-hover');
    hovered = id;
    const pin = id && pins.get(id);
    if (!pin || !pin.visible) { tip.hidden = true; return; }
    pin.el.classList.add('is-hover');
    if (spec.callout) {
      const c = spec.callout(id);
      tip.replaceChildren();
      const b = div('', tip, 'b'); b.textContent = c.title;
      const s = div('', tip, 'span'); s.textContent = c.sub;
    }
    tip.hidden = false;
    placeTip();
  }
  function placeTip() {
    if (!hovered || tip.hidden) return;
    const pin = pins.get(hovered);
    const [x, y] = pin.screen || toScreen(pin.p.x, pin.p.y);
    const below = y < 90;
    tip.classList.toggle('below', below);
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y + (below ? 24 : -24))}px)`;
  }

  /* ---------- view: centre (cx, cy) in plan units, k = screen px per unit ---------- */
  let W = 1, H = 1, k = 1, cx = B.x0 + B.w / 2, cy = B.y0 + B.h / 2, fitK = 1, kMax = 6;
  // 3D view: the stage is tilted with perspective(P) rotateX(RX·tilt) rotateZ(RZ·tilt) about its centre.
  const P = 1500, RX = 54 * Math.PI / 180, RZ = -16 * Math.PI / 180;
  let tilt = 0, tiltTarget = 0;
  const ang = () => [RX * tilt, RZ * tilt];
  // planar offset from the stage centre (px) -> screen px; z = height above the floor (px)
  function project(px, py, z = 0) {
    const [a, b] = ang();
    const x1 = px * Math.cos(b) - py * Math.sin(b), y1 = px * Math.sin(b) + py * Math.cos(b);
    const y2 = y1 * Math.cos(a) - z * Math.sin(a), z2 = y1 * Math.sin(a) + z * Math.cos(a);
    const s = P / (P - z2);
    return [W / 2 + x1 * s, H / 2 + y2 * s];
  }
  // screen px -> planar offset (exact inverse of project for z = 0)
  function unproject(sx, sy) {
    const [a, b] = ang();
    const X = sx - W / 2, Y = sy - H / 2;
    const y1 = (Y * P) / (P * Math.cos(a) + Y * Math.sin(a));
    const s = P / (P - y1 * Math.sin(a));
    const x1 = X / s;
    return [x1 * Math.cos(b) + y1 * Math.sin(b), -x1 * Math.sin(b) + y1 * Math.cos(b)];
  }
  const toScreen = (x, y) => project((x - cx) * k, (y - cy) * k);
  const toUnits = (sx, sy) => { const [px, py] = unproject(sx, sy); return [px / k + cx, py / k + cy]; };

  // Home view: the whole floor on wide screens; on narrow screens the part where our places are.
  const D = (() => {
    const px = spec.places.map((p) => p.x), py = spec.places.map((p) => p.y);
    const x0 = Math.min(...px) - 80, x1 = Math.max(...px) + 80, y0 = Math.min(...py) - 50, y1 = Math.max(...py) + 50;
    return { x0, y0, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  })();
  let home = { cx, cy, k: 1 };
  function measure() {
    const r = root.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    const pad = W < 600 ? 12 : 48;
    fitK = Math.min((W - pad * 2) / B.w, (H - pad * 2) / B.h);
    kMax = fitK * 6;
    home = W < 820
      ? { cx: D.cx, cy: D.cy, k: Math.min((W - pad * 2) / D.w, (H - 110) / D.h) }
      : { cx: B.x0 + B.w / 2, cy: B.y0 + B.h / 2, k: fitK };
  }
  function clamp() {
    k = Math.max(fitK * 0.85, Math.min(kMax, k));
    const extra = (60 + tilt * 220) / k;
    const mx = Math.max(0, (B.w * k - W) / 2 / k + extra), my = Math.max(0, (B.h * k - H) / 2 / k + extra);
    const ccx = B.x0 + B.w / 2, ccy = B.y0 + B.h / 2;
    cx = Math.max(ccx - mx, Math.min(ccx + mx, cx));
    cy = Math.max(ccy - my, Math.min(ccy + my, cy));
  }
  let raf = 0;
  function layout() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; draw(); });
  }
  function draw() {
    const vb = `${cx - W / 2 / k} ${cy - H / 2 / k} ${W / k} ${H / k}`;
    svg.setAttribute('viewBox', vb);
    const [a, b] = ang();
    stage.style.transform = tilt > 0.001 ? `perspective(${P}px) rotateX(${a}rad) rotateZ(${b}rad)` : '';
    root.classList.toggle('is-3d', tilt > 0.001);
    const wallH = tilt * Math.min(30, 9 * Math.max(1, k / fitK)) * Math.max(0.5, fitK / 0.5);
    walls.forEach((w, i) => {
      w.style.display = tilt > 0.001 ? '' : 'none';
      if (tilt <= 0.001) return;
      w.setAttribute('viewBox', vb);
      w.style.transform = `translateZ(${(((i + 1) / WALL_LAYERS) * wallH).toFixed(2)}px)`;
    });
    const compact = k < 0.42;
    if (compact !== root.classList.contains('compact')) { root.classList.toggle('compact', compact); pins.forEach((pin) => { pin.size = null; }); }
    // cluster amenity pins of the same layer that would overlap on screen
    // (single link: a pin joins a group if it is near any member; the group shows at its mean position)
    const groups = new Map();
    pins.forEach((pin) => { pin.clusterOf = null; pin.hiddenByCluster = false; });
    pins.forEach((pin) => {
      if (!pin.visible || pin.p.layer === 'study') return;
      const [x, y] = toScreen(pin.p.x, pin.p.y);
      const list = groups.get(pin.p.layer) || [];
      const near = list.find((g) => g.pts.some(([gx, gy]) => Math.hypot(gx - x, gy - y) < 34));
      if (near) { near.members.push(pin); near.pts.push([x, y]); pin.hiddenByCluster = true; } else list.push({ pts: [[x, y]], lead: pin, members: [pin] });
      groups.set(pin.p.layer, list);
    });
    const at = new Map();
    groups.forEach((list) => list.forEach((g) => {
      g.lead.clusterOf = g.members.length > 1 ? g.members.map((m) => m.p) : null;
      at.set(g.lead, [g.pts.reduce((s, q) => s + q[0], 0) / g.pts.length, g.pts.reduce((s, q) => s + q[1], 0) / g.pts.length]);
      if (g.members.some((m) => m.p.id === selected)) g.lead.el.classList.add('has-selected'); else g.lead.el.classList.remove('has-selected');
    }));
    // screen positions, then push overlapping pins apart a little (max ~26 px from their true spot)
    const shown = [];
    pins.forEach((pin) => {
      const show = pin.visible && !pin.hiddenByCluster;
      pin.el.hidden = !show;
      if (!show) return;
      const [x0, y0] = at.get(pin) || toScreen(pin.p.x, pin.p.y);
      if (!pin.size) pin.size = [pin.el.offsetWidth || 30, pin.el.offsetHeight || 28];
      shown.push({ pin, x0, y0, x: x0, y: y0, w: pin.size[0] + 4, h: pin.size[1] + 4 });
    });
    for (let it = 0; it < 24; it++) {
      let movedAny = false;
      for (let i = 0; i < shown.length; i++) {
        for (let j = i + 1; j < shown.length; j++) {
          const a = shown[i], b = shown[j];
          const ox = (a.w + b.w) / 2 - Math.abs(a.x - b.x), oy = (a.h + b.h) / 2 - Math.abs(a.y - b.y);
          if (ox <= 0 || oy <= 0) continue;
          movedAny = true;
          if (ox < oy) { const s = (a.x < b.x || (a.x === b.x && i < j) ? -1 : 1) * ox / 2; a.x += s; b.x -= s; }
          else { const s = (a.y < b.y || (a.y === b.y && i < j) ? -1 : 1) * oy / 2; a.y += s; b.y -= s; }
        }
      }
      shown.forEach((q) => {
        const dx = q.x - q.x0, dy = q.y - q.y0, d = Math.hypot(dx, dy);
        if (d > 26) { q.x = q.x0 + dx * 26 / d; q.y = q.y0 + dy * 26 / d; }
      });
      if (!movedAny) break;
    }
    shown.forEach(({ pin, x, y }) => {
      pin.screen = [x, y];
      pin.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
      const badge = pin.el.querySelector('em');
      if (badge) badge.textContent = pin.clusterOf ? '×' + pin.clusterOf.length : '';
      pin.el.classList.toggle('is-cluster', !!pin.clusterOf);
    });
    placeTip();
  }

  function zoomAt(sx, sy, f, animate) {
    const [px, py] = unproject(sx, sy);
    const ux = px / k + cx, uy = py / k + cy;
    const nk = Math.max(fitK * 0.85, Math.min(kMax, k * f));
    const ncx = ux - px / nk, ncy = uy - py / nk;
    if (animate) flyTo(ncx, ncy, nk, 320);
    else { k = nk; cx = ncx; cy = ncy; clamp(); layout(); }
  }
  let anim = 0;
  function flyTo(tx, ty, tk, ms = 750) {
    cancelAnimationFrame(anim);
    const s = { cx, cy, k }, t0 = performance.now();
    if (reduced()) ms = 1;
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms), e = ease(t);
      k = s.k * Math.pow(tk / s.k, e);
      cx = s.cx + (tx - s.cx) * e; cy = s.cy + (ty - s.cy) * e;
      clamp(); draw();
      if (t < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }
  // the home view for a given tilt: tilted floors are foreshortened, so zoom in a little and look a bit further up
  const homeFor = (t) => ({ cx: home.cx, cy: home.cy + t * 30, k: home.k * (1 - 0.1 * t) });
  function fit(animate) {
    measure();
    const hm = homeFor(tiltTarget);
    if (animate) flyTo(hm.cx, hm.cy, hm.k); else { k = hm.k; cx = hm.cx; cy = hm.cy; clamp(); layout(); }
  }
  // animate between flat (0) and 3D (1); keeps the view centre, eases the zoom toward the matching home zoom
  let tanim = 0;
  function setTilt(to, animate = true, ms = 1300) {
    tiltTarget = to;
    tiltBtn.textContent = to ? '2D' : '3D';
    tiltBtn.setAttribute('aria-pressed', String(!!to));
    cancelAnimationFrame(tanim);
    const t0 = performance.now(), from = tilt, kf = k, kt = k * (1 - 0.1 * to) / (1 - 0.1 * from);
    if (!animate || reduced()) { tilt = to; k = kt; clamp(); layout(); return; }
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms), e = ease(t);
      tilt = from + (to - from) * e;
      k = kf * Math.pow(kt / kf, e);
      clamp(); draw();
      if (t < 1) tanim = requestAnimationFrame(step);
    };
    tanim = requestAnimationFrame(step);
  }

  /* ---------- input: wheel, drag, pinch, double-click ---------- */
  const ptrs = new Map();
  let last = null, moved = 0;
  const onWheel = (e) => {
    e.preventDefault();
    cancelAnimationFrame(anim);
    const r = root.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), false);
  };
  const onDown = (e) => {
    if (e.target.closest('.pin, .plan-zoom')) return;
    cancelAnimationFrame(anim);
    root.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    last = null; moved = 0;
    root.classList.add('dragging');
  };
  const onMove = (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    const r = root.getBoundingClientRect();
    const T = [...ptrs.values()];
    const mx = T.reduce((s, p) => s + p[0], 0) / T.length - r.left, my = T.reduce((s, p) => s + p[1], 0) / T.length - r.top;
    const dist = T.length > 1 ? Math.hypot(T[0][0] - T[1][0], T[0][1] - T[1][1]) : 0;
    if (last && last.n === T.length) {
      // keep the floor point under the pointer under the pointer (exact in the tilted view too)
      const [ax, ay] = toUnits(last.mx, last.my), [bx, by] = toUnits(mx, my);
      cx += ax - bx; cy += ay - by;
      moved += Math.abs(mx - last.mx) + Math.abs(my - last.my);
      if (T.length > 1 && last.dist) zoomAt(mx, my, dist / last.dist, false);
      clamp(); layout();
    }
    last = { mx, my, dist, n: T.length };
  };
  const onUp = (e) => {
    ptrs.delete(e.pointerId);
    last = null;
    if (!ptrs.size) root.classList.remove('dragging');
  };
  const onDbl = (e) => {
    if (e.target.closest('.pin, .plan-zoom')) return;
    const r = root.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, 1.8, true);
  };
  root.addEventListener('wheel', onWheel, { passive: false });
  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerup', onUp);
  root.addEventListener('pointercancel', onUp);
  root.addEventListener('dblclick', onDbl);
  const ro = new ResizeObserver(() => { const before = fitK; measure(); k = k * (fitK / before); clamp(); layout(); });
  ro.observe(root);

  fit(false);
  update(spec.markers || {});
  requestAnimationFrame(() => root.classList.add('is-in'));
  // 3D by default on wide screens: the plan lands flat, then tilts up while the walls rise
  const want3d = spec.tilt != null ? spec.tilt : W >= 820;
  if (want3d) setTimeout(() => setTilt(1, true, 1600), reduced() ? 0 : 450);
  else setTilt(0, false);

  return {
    update, setVisible, select, fit, setTilt,
    hover: (id) => setHover(id),
    dispose() { ro.disconnect(); cancelAnimationFrame(anim); root.remove(); }
  };
}
