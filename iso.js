/* iso.js: turns the flat traced plan (assets/msc-floor1.svg) into an isometric "miniature MSC".
 * Every room path is extruded into a block; a morph parameter p blends flat (p=0) and isometric (p=1),
 * so the same projection drives the load-in "grow" animation and the flat/3D toggle.
 * Exposes window.IsoMap. Plain script, no dependencies. */
(() => {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const C30 = Math.cos(Math.PI / 6);
  const S30 = 0.5;
  const K = 0.72;                 // iso scale so the island fits roughly the same box as the plan
  const CX = 980, CY = 780;       // projection centre (plan units)
  const FLAT_VB = [150, 270, 1660, 1020];
  const SLAB = 16;                // floor slab thickness (drawn below z=0)
  const HEIGHTS = { default: 30, service: 18, open: 2, area: { 9: 40, 14: 34 } };
  const GROUPS = { study: [5, 8, 9, 15, 16], shop: [13, 14, 17, 18, 19] };

  const ease = {
    inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    outBack: (t) => { const c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
    outCubic: (t) => 1 - Math.pow(1 - t, 3)
  };
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let svg = null;
  let rooms = [];
  let outline = null;
  let movers = [];          // labels and icons that follow the projection
  let gWorld = null;
  let morph = 1;            // eased flat→iso blend actually used for drawing
  let morphFrom = 1, morphTo = 1, morphStart = 0, morphDur = 700;
  let growStart = -1e9;
  let rafId = 0;
  let mode = 'iso';
  const frameCallbacks = [];

  /* ---------- geometry helpers ---------- */
  function parsePath(d) {
    const pts = [];
    const re = /[ML]\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/g;
    let m;
    while ((m = re.exec(d))) pts.push([+m[1], +m[2]]);
    return pts;
  }
  function signedArea(poly) {
    let a = 0;
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
      a += x1 * y2 - x2 * y1;
    }
    return a / 2;
  }
  function centroid(poly) {
    let x = 0, y = 0;
    poly.forEach(([px, py]) => { x += px; y += py; });
    return [x / poly.length, y / poly.length];
  }
  function inside([x, y], poly) {
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  }
  // Outward normal of each edge, and which side faces the viewer (+x+y is "toward the camera").
  function sideFaces(poly) {
    const cw = signedArea(poly) > 0; // in SVG's y-down frame, positive area = clockwise on screen
    const faces = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const n = cw ? [-dy, dx] : [dy, -dx];
      if (n[0] + n[1] <= 0) continue; // faces away from the camera
      faces.push({ a, b, side: n[0] > n[1] ? 'right' : 'left', depth: a[0] + a[1] + b[0] + b[1] });
    }
    return faces.sort((f, g) => f.depth - g.depth);
  }

  /* ---------- projection ---------- */
  function isoPoint(x, y, z) {
    const dx = x - CX, dy = y - CY;
    return [(dx - dy) * C30 * K + CX, (dx + dy) * S30 * K + CY - z];
  }
  function project(x, y, z = 0) {
    const [ix, iy] = isoPoint(x, y, z);
    return { x: x + (ix - x) * morph, y: y + (iy - y) * morph };
  }
  function toD(points) {
    return 'M' + points.map((p) => p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' L') + ' Z';
  }

  function roomAt(x, y) {
    // Highest room containing the point (rooms do not overlap, so "first hit" is fine).
    return rooms.find((r) => inside([x, y], r.poly)) || null;
  }
  function growthOf(room, now) {
    if (reducedMotion()) return 1;
    const t = clamp01((now - growStart - room.delay) / 620);
    return t >= 1 ? 1 : Math.max(0, ease.outBack(t));
  }
  function currentHeight(room, now = performance.now()) {
    return room.h * growthOf(room, now);
  }
  function elevationAt(x, y) {
    const r = roomAt(x, y);
    return r ? currentHeight(r) : 0;
  }

  /* ---------- building the iso layer ---------- */
  function el(tag, attrs, parent) {
    const node = document.createElementNS(NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => node.setAttribute(k, v));
    if (parent) parent.appendChild(node);
    return node;
  }

  function groupFor(area, cls) {
    if (cls === 'service') return 'service';
    if (cls === 'open') return 'open';
    if (GROUPS.study.includes(area)) return 'study';
    if (GROUPS.shop.includes(area)) return 'shop';
    return 'other';
  }

  function attach(svgEl) {
    svg = svgEl;
    const defs = el('defs', {}, null);
    svg.insertBefore(defs, svg.firstChild);
    const filter = el('filter', { id: 'iso-shadow', x: '-20%', y: '-20%', width: '140%', height: '160%' }, defs);
    el('feDropShadow', { dx: '0', dy: '22', stdDeviation: '18', class: 'iso-shadow-flood' }, filter);

    const flatRooms = svg.querySelector('.rooms');
    if (flatRooms) flatRooms.style.display = 'none';
    const bg = svg.querySelector('.plan-bg');
    if (bg) bg.style.display = 'none';

    gWorld = el('g', { id: 'iso-world' }, null);
    svg.insertBefore(gWorld, flatRooms ? flatRooms.nextSibling : null);

    // Floor slab from the building outline.
    const outlineEl = svg.querySelector('.plan-outline');
    if (outlineEl) {
      outlineEl.style.display = 'none';
      const poly = parsePath(outlineEl.getAttribute('d'));
      const g = el('g', { class: 'iso-floor', filter: 'url(#iso-shadow)' }, gWorld);
      outline = {
        poly,
        sides: sideFaces(poly).map((f) => ({ ...f, node: el('path', { class: 'slab-' + f.side }, g) })),
        top: el('path', { class: 'slab-top' }, g)
      };
    }

    // Rooms, painter-sorted back to front.
    const center = [CX, CY];
    rooms = Array.from(svg.querySelectorAll('.rooms path.room')).map((p) => {
      const poly = parsePath(p.getAttribute('d'));
      const area = Number(p.dataset.area) || null;
      const cls = p.classList.contains('service') ? 'service' : p.classList.contains('open') ? 'open' : 'room';
      const h = cls === 'service' ? HEIGHTS.service : cls === 'open' ? HEIGHTS.open
        : (HEIGHTS.area[area] || HEIGHTS.default);
      const c = centroid(poly);
      const dist = Math.hypot(c[0] - center[0], c[1] - center[1]);
      return { poly, area, cls, h, c, depth: c[0] + c[1], group: groupFor(area, cls), delay: 120 + dist * 0.32 };
    }).sort((a, b) => a.depth - b.depth);

    const gRooms = el('g', { class: 'iso-rooms' }, gWorld);
    rooms.forEach((r) => {
      const g = el('g', { class: 'iso-room grp-' + r.group, 'data-area': r.area || '' }, gRooms);
      r.sides = sideFaces(r.poly).map((f) => ({ ...f, node: el('path', { class: 'face-' + f.side }, g) }));
      r.top = el('path', { class: 'face-top' }, g);
    });

    // Labels and icons that ride on top of the blocks.
    movers = [];
    svg.querySelectorAll('.room-labels text, .area-names text').forEach((t) => {
      const x = +t.getAttribute('x'), y = +t.getAttribute('y');
      t.removeAttribute('x'); t.removeAttribute('y');
      movers.push({ node: t, x, y, onPlane: true });
      gWorld.appendChild(t); // keep labels above the blocks
    });
    t0IconMovers();

    growStart = performance.now();
    mode = readMode();
    morph = mode === 'iso' ? 1 : 0;
    morphFrom = morphTo = morph;
    startLoop();
    return api;
  }

  function t0IconMovers() {
    const icons = svg.querySelector('.plan-icons');
    if (!icons) return;
    gWorld.appendChild(icons);
    icons.querySelectorAll(':scope > g').forEach((group) => {
      const isOne = group.classList.contains('you-are-here');
      const items = isOne ? [group] : Array.from(group.children);
      items.forEach((node) => {
        let box;
        try { box = node.getBBox(); } catch (e) { return; }
        const wrap = isOne ? node : el('g', {}, null);
        if (!isOne) { node.parentNode.insertBefore(wrap, node); wrap.appendChild(node); }
        movers.push({ node: wrap, x: box.x + box.width / 2, y: box.y + box.height / 2, translate: true });
      });
    });
  }

  /* ---------- drawing ---------- */
  function draw(now) {
    // Floor slab.
    if (outline) {
      outline.top.setAttribute('d', toD(outline.poly.map(([x, y]) => project(x, y, 0))));
      outline.sides.forEach((f) => {
        f.node.setAttribute('d', toD([project(...f.a, 0), project(...f.b, 0), project(...f.b, -SLAB), project(...f.a, -SLAB)]));
      });
    }
    rooms.forEach((r) => {
      const h = currentHeight(r, now);
      const growth = h / r.h;
      r.top.setAttribute('d', toD(r.poly.map(([x, y]) => project(x, y, h))));
      // Roof "lands" a beat after the walls: fade it in with the growth.
      r.top.style.opacity = reducedMotion() ? '1' : String(clamp01(growth * 1.6 - 0.2));
      r.sides.forEach((f) => {
        f.node.setAttribute('d', toD([project(...f.a, 0), project(...f.b, 0), project(...f.b, h), project(...f.a, h)]));
      });
    });
    // Plane transform for labels: lerp identity → iso top-plane basis.
    const e = morph;
    const ax = 1 + (C30 - 1) * e, ay = S30 * e, bx = -C30 * e, by = 1 + (S30 - 1) * e;
    movers.forEach((m) => {
      const z = elevationAt(m.x, m.y);
      const p = project(m.x, m.y, z);
      if (m.translate) {
        m.node.setAttribute('transform', `translate(${(p.x - m.x).toFixed(1)} ${(p.y - m.y).toFixed(1)})`);
      } else {
        m.node.setAttribute('transform', `matrix(${ax.toFixed(4)} ${ay.toFixed(4)} ${bx.toFixed(4)} ${by.toFixed(4)} ${p.x.toFixed(1)} ${p.y.toFixed(1)})`);
      }
    });
    svg.setAttribute('viewBox', currentViewBox().map((v) => v.toFixed(1)).join(' '));
  }

  function isoBounds() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const add = (x, y, z) => {
      const [ix, iy] = isoPoint(x, y, z);
      minX = Math.min(minX, ix); maxX = Math.max(maxX, ix);
      minY = Math.min(minY, iy); maxY = Math.max(maxY, iy);
    };
    (outline ? outline.poly : []).forEach(([x, y]) => { add(x, y, 0); add(x, y, -SLAB); });
    rooms.forEach((r) => r.poly.forEach(([x, y]) => add(x, y, r.h)));
    const m = 24;
    return [minX - m, minY - m - 30, maxX - minX + 2 * m, maxY - minY + 2 * m + 30];
  }
  let isoVB = null;
  function baseViewBox() {
    if (!isoVB) isoVB = isoBounds();
    return FLAT_VB.map((v, i) => v + (isoVB[i] - v) * morph);
  }
  // Camera: zoom z (1 = whole floor) and centre offset (x, y) in SVG units from the base centre.
  let cam = { z: 1, x: 0, y: 0 }, camFrom = cam, camTo = cam, camStart = 0;
  const CAM_MS = 420;
  function clampCam(c) {
    const b = baseViewBox();
    const z = Math.min(6, Math.max(1, c.z));
    const mx = (b[2] - b[2] / z) / 2, my = (b[3] - b[3] / z) / 2;
    return { z, x: Math.max(-mx, Math.min(mx, c.x)), y: Math.max(-my, Math.min(my, c.y)) };
  }
  function currentViewBox() {
    const b = baseViewBox();
    const w = b[2] / cam.z, h = b[3] / cam.z;
    const cx = b[0] + b[2] / 2 + cam.x, cy = b[1] + b[3] / 2 + cam.y;
    return [cx - w / 2, cy - h / 2, w, h];
  }
  function setCamera(c, animate = true) {
    const next = clampCam({ ...camTo, ...c });
    if (!animate || reducedMotion()) { cam = camFrom = camTo = next; startLoop(); return; }
    camFrom = { ...cam }; camTo = next; camStart = performance.now();
    startLoop();
  }
  // Zoom by `factor` keeping SVG point (px, py) fixed on screen.
  function zoomAt(factor, px, py, animate = false) {
    const b = baseViewBox();
    const base = animate ? camTo : cam;
    const z = Math.min(6, Math.max(1, base.z * factor));
    const f = z / base.z;
    const cx = b[0] + b[2] / 2 + base.x, cy = b[1] + b[3] / 2 + base.y;
    const ncx = px + (cx - px) / f, ncy = py + (cy - py) / f;
    setCamera({ z, x: ncx - (b[0] + b[2] / 2), y: ncy - (b[1] + b[3] / 2) }, animate);
  }
  function panBy(dx, dy) { setCamera({ x: cam.x + dx, y: cam.y + dy }, false); }
  function focusOn(px, py, z) {
    const b = baseViewBox();
    setCamera({ z: Math.max(camTo.z, z), x: px - (b[0] + b[2] / 2), y: py - (b[1] + b[3] / 2) }, true);
  }

  function animating(now) {
    const growing = !reducedMotion() && rooms.some((r) => now - growStart - r.delay < 620);
    return growing || morphTo !== morph || cam !== camTo;
  }

  function tick(now) {
    if (morph !== morphTo) {
      const t = reducedMotion() ? 1 : clamp01((now - morphStart) / morphDur);
      morph = morphFrom + (morphTo - morphFrom) * ease.inOut(t);
      if (t >= 1) morph = morphTo;
    }
    if (cam !== camTo) {
      const t = clamp01((now - camStart) / CAM_MS);
      const k = ease.inOut(t);
      cam = t >= 1 ? camTo : { z: camFrom.z + (camTo.z - camFrom.z) * k, x: camFrom.x + (camTo.x - camFrom.x) * k, y: camFrom.y + (camTo.y - camFrom.y) * k };
    }
    draw(now);
    frameCallbacks.forEach((cb) => { try { cb(morph); } catch (e) { console.error(e); } });
    rafId = animating(now) ? requestAnimationFrame(tick) : 0;
  }
  function startLoop() {
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  /* ---------- mode ---------- */
  function readMode() {
    try { return localStorage.getItem('msc-map-mode') === 'flat' ? 'flat' : 'iso'; } catch (e) { return 'iso'; }
  }
  function setMode(next, animate = true) {
    mode = next === 'flat' ? 'flat' : 'iso';
    try { localStorage.setItem('msc-map-mode', mode); } catch (e) { /* storage unavailable */ }
    morphFrom = morph;
    morphTo = mode === 'iso' ? 1 : 0;
    morphStart = performance.now();
    if (!animate) morph = morphTo;
    startLoop();
  }

  const api = {
    attach,
    setMode,
    getMode: () => mode,
    project,
    elevationAt,
    onFrame: (cb) => frameCallbacks.push(cb),
    refresh: () => startLoop(),
    morph: () => morph,
    setCamera,
    getCamera: () => ({ ...camTo }),
    zoomAt,
    panBy,
    focusOn,
    resetCamera: () => setCamera({ z: 1, x: 0, y: 0 }, true)
  };
  window.IsoMap = api;
})();
