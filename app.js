/* MSC Field Map: app logic. Loads our CSVs, draws markers on the isometric plan (iso.js),
 * and drives the ranking, vending search, details, photo lightbox and 3D viewer (model3d.js). */
(() => {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const LATEST = 'latest';
  const LAYERS = [
    { key: 'study', label: 'Study places', one: 'Study place', color: 'var(--quiet)' },
    { key: 'water', label: 'Water fillers', one: 'Water filler', color: 'var(--water)', letter: 'W' },
    { key: 'vending', label: 'Vending', one: 'Vending machine', color: 'var(--vending)', letter: 'V' },
    { key: 'microwave', label: 'Microwaves', one: 'Microwaves', color: 'var(--microwave)', letter: 'M' },
    { key: 'printer', label: 'Printers', one: 'Printers', color: 'var(--printer)', letter: 'P' }
  ];
  const LAYER = Object.fromEntries(LAYERS.map((l) => [l.key, l]));
  const BANDS = [
    { key: 'quiet', label: 'Quiet', max: 50 },
    { key: 'moderate', label: 'Moderate', max: 60 },
    { key: 'loud', label: 'Loud', max: 70 },
    { key: 'vloud', label: 'Very loud', max: Infinity }
  ];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const S = {
    places: [], byId: new Map(), areas: new Map(),
    noise: [], obs: [], photos: [], items: [],
    rounds: [], round: LATEST,
    visible: new Set(LAYERS.map((l) => l.key)), glow: true,
    selected: null, tab: 'quiet', vendingQuery: '',
    map: null, view: (() => { try { return localStorage.getItem('msc-map-mode') === 'flat' ? 'flat' : 'iso'; } catch (e) { return 'iso'; } })(), firstPaint: true
  };
  const $ = (id) => document.getElementById(id);

  /* ---------------- data ---------------- */
  async function text(url, optional = false) {
    try {
      const r = await fetch(url, { cache: 'no-cache' });
      if (!r.ok) throw new Error(url + ' → HTTP ' + r.status);
      return await r.text();
    } catch (e) {
      if (optional) return '';
      throw e;
    }
  }
  const csv = (t) => (t ? Papa.parse(t.replace(/^﻿/, ''), { header: true, skipEmptyLines: true }).data : [])
    .map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [String(k).trim(), String(v ?? '').trim()])));
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  const time = (v) => { const d = v ? new Date(v) : null; return d && !isNaN(d) ? d : null; };

  async function load() {
    const [svgText, places, noise, obs, areas, photos, items] = await Promise.all([
      text('assets/msc-floor1.svg'), text('data/places.csv'), text('data/noise.csv'), text('data/observations.csv'),
      text('data/areas.csv', true), text('data/photos.csv', true), text('data/vending_items.csv', true)
    ]);
    S.places = csv(places).map((p) => ({ ...p, x: num(p.x), y: num(p.y), area: p.area ? Number(p.area) : null }))
      .filter((p) => p.place_id && LAYER[p.layer] && p.x != null && p.y != null);
    S.byId = new Map(S.places.map((p) => [p.place_id, p]));
    const known = (r) => { if (S.byId.has(r.place_id)) return true; console.warn('Unknown place_id', r.place_id); return false; };
    csv(areas).forEach((a) => S.areas.set(Number(a.area), a.name));
    S.noise = csv(noise).filter(known).map((r) => ({ ...r, t: time(r.ts), laeq: num(r.laeq_db), lmax: num(r.lmax_db), lcpeak: num(r.lcpeak_db), dur: num(r.duration_s) }));
    S.obs = csv(obs).filter(known).map((r) => ({ ...r, t: time(r.ts) }));
    S.photos = csv(photos).filter(known).map((r) => ({ ...r, t: time(r.ts) }));
    S.obs.filter((o) => o.photo).forEach((o) => S.photos.push({ place_id: o.place_id, round: o.round, file: o.photo, caption: o.note, t: o.t }));
    S.items = csv(items).filter(known).map((r) => ({ ...r, price: num(r.price_usd) }));
    const rs = new Set([...S.noise, ...S.obs, ...S.photos, ...S.items].map((r) => r.round).filter(Boolean));
    S.rounds = [...rs].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    return svgText;
  }

  /* ---------------- selection of values per round ---------------- */
  const inRound = (rows) => (S.round === LATEST ? rows : rows.filter((r) => r.round === S.round));
  function latest(rows) {
    return rows.reduce((best, r) => {
      if (!best) return r;
      const a = best.t ? best.t.getTime() : 0, b = r.t ? r.t.getTime() : 0;
      if (b !== a) return b > a ? r : best;
      return r.round.localeCompare(best.round, 'en', { numeric: true }) > 0 ? r : best;
    }, null);
  }
  const noiseFor = (id) => latest(inRound(S.noise.filter((n) => n.place_id === id && n.laeq != null)));
  const obsFor = (id) => latest(inRound(S.obs.filter((o) => o.place_id === id)));
  // An amenity's state: newest value of each field within the selected round (fields come from different rows).
  function stateFor(id) {
    const rows = inRound(S.obs.filter((o) => o.place_id === id)).sort((a, b) => (a.t?.getTime() || 0) - (b.t?.getTime() || 0));
    const out = {};
    rows.forEach((r) => Object.entries(r).forEach(([k, v]) => { if (v !== '' && v != null) out[k] = v; }));
    return out;
  }
  function itemsFor(id) {
    const all = S.items.filter((i) => i.place_id === id);
    if (S.round !== LATEST) return all.filter((i) => i.round === S.round);
    const last = all.map((i) => i.round).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).pop();
    return all.filter((i) => i.round === last);
  }
  const photosFor = (id) => S.photos.filter((p) => p.place_id === id)
    .sort((a, b) => b.round.localeCompare(a.round, 'en', { numeric: true }) || (b.t?.getTime() || 0) - (a.t?.getTime() || 0));
  const band = (db) => (db == null ? null : BANDS.find((b) => db < b.max));
  const areaName = (p) => (p.area ? `Area ${p.area}${S.areas.get(p.area) ? ' · ' + S.areas.get(p.area) : ''}` : '');
  function fmtTime(d) {
    if (!d) return '—';
    let h = d.getHours(); const m = String(d.getMinutes()).padStart(2, '0'); const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${DAYS[d.getDay()]} ${h}:${m} ${ap}`;
  }
  const money = (v) => (v == null ? '—' : '$' + v.toFixed(2));

  /* ---------------- DOM helpers ---------------- */
  function h(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'style') n.setAttribute('style', v);
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    kids.flat().forEach((c) => { if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c))); });
    return n;
  }
  function s(tag, attrs = {}, parent) {
    const n = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
    if (parent) parent.appendChild(n);
    return n;
  }

  /* ---------------- controls ---------------- */
  function renderChips() {
    const nav = $('layer-chips');
    nav.replaceChildren(...LAYERS.map((l) => h('button', {
      type: 'button', class: 'layer', 'aria-pressed': String(S.visible.has(l.key)), style: `--c:${l.color}`,
      onclick: (e) => {
        S.visible.has(l.key) ? S.visible.delete(l.key) : S.visible.add(l.key);
        e.currentTarget.setAttribute('aria-pressed', String(S.visible.has(l.key)));
        applyVisibility();
        renderQuiet();
      }
    }, h('i', { 'aria-hidden': 'true' }), l.label, h('span', { class: 'count' }, S.places.filter((p) => p.layer === l.key).length))));
  }

  function renderRounds() {
    const seg = $('round-control');
    const opts = [[LATEST, 'Latest'], ...S.rounds.map((r) => [r, r])];
    seg.replaceChildren(...opts.map(([v, label]) => h('button', {
      type: 'button', 'aria-pressed': String(S.round === v),
      onclick: () => { if (S.round === v) return; S.round = v; renderRounds(); refreshAll(true); }
    }, label)));
  }

  function bindView() {
    const buttons = document.querySelectorAll('#view-toggle button');
    const sync = () => buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === S.view)));
    buttons.forEach((b) => b.addEventListener('click', () => {
      S.view = b.dataset.mode;
      try { localStorage.setItem('msc-map-mode', S.view); } catch (e) { /* storage unavailable */ }
      if (S.map) S.map.easeTo({ pitch: S.view === 'iso' ? 52 : 0, bearing: S.view === 'iso' ? -17 : 0, duration: reduced() ? 0 : 900 });
      sync();
    }));
    sync();
  }

  /* ---------------- map (MapLibre GL) ---------------- */
  // Plan pixels (sign-photo frame, 2000×1379) → small fake lon/lat around 0,0. 1 px ≈ 0.17 m, so the floor is ~280 m wide.
  const SCALE = 0.0000015, OX = 980, OY = 780;
  const toLL = (x, y) => [(x - OX) * SCALE, -(y - OY) * SCALE];
  const STUDY_AREAS = [5, 8, 9, 15, 16], SHOP_AREAS = [13, 14, 17, 18, 19];
  const tok = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  function parseRings(d) {
    const t = d.match(/[MLZmlz]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
    const rings = []; let ring = null, i = 0, cmd = 'M';
    while (i < t.length) {
      if (/[MLZmlz]/.test(t[i])) { cmd = t[i++].toUpperCase(); if (cmd === 'Z') { if (ring && ring.length > 2) rings.push(ring); ring = null; } continue; }
      const x = +t[i++], y = +t[i++];
      if (cmd === 'M') { if (ring && ring.length > 2) rings.push(ring); ring = [[x, y]]; cmd = 'L'; } else if (ring) ring.push([x, y]);
    }
    if (ring && ring.length > 2) rings.push(ring);
    return rings;
  }
  const ringLL = (r) => { const ll = r.map(([x, y]) => toLL(x, y)); ll.push(ll[0]); return ll; };
  function inside([x, y], ring) {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  }

  function planGeo(svgText) {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const rooms = [], labels = [], plan = [];
    const outline = doc.querySelector('.plan-outline');
    const floor = outline ? parseRings(outline.getAttribute('d')).map((r) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ringLL(r)] } })) : [];
    doc.querySelectorAll('path.room').forEach((el) => {
      const area = Number(el.getAttribute('data-area')) || 0;
      const cls = el.getAttribute('class') || '';
      const group = cls.includes('open') ? 'open' : cls.includes('service') ? 'service' : STUDY_AREAS.includes(area) ? 'study' : SHOP_AREAS.includes(area) ? 'shop' : 'other';
      // Miniature diorama: low blocks; models and markers stand on their tops.
      const height = group === 'open' ? 0.05 : group === 'service' ? 0.8 : area === 9 ? 1.6 : area === 14 ? 1.4 : 1.2;
      parseRings(el.getAttribute('d')).forEach((r) => {
        const cx = r.reduce((s, p) => s + p[0], 0) / r.length, cy = r.reduce((s, p) => s + p[1], 0) / r.length;
        const delay = Math.min(0.6, Math.hypot(cx - OX, cy - OY) / 1500);   // rise as a wave from the centre
        plan.push({ ring: r, height });
        rooms.push({ type: 'Feature', properties: { area, group, height, delay }, geometry: { type: 'Polygon', coordinates: [ringLL(r)] } });
      });
    });
    doc.querySelectorAll('.room-labels text, .area-names text').forEach((el) => {
      const x = +el.getAttribute('x'), y = +el.getAttribute('y');
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      labels.push({ type: 'Feature', properties: { text: el.textContent.trim(), big: el.closest('.area-names') ? 1 : 0 }, geometry: { type: 'Point', coordinates: toLL(x, y) } });
    });
    return { floor, rooms, labels, plan };
  }
  const roofAt = (x, y) => (S.plan || []).reduce((h, r) => (inside([x, y], r.ring) ? Math.max(h, r.height) : h), 0.1);

  const fc = (features) => ({ type: 'FeatureCollection', features });

  function roomColor() {
    return ['match', ['get', 'group'], 'study', tok('--room-study'), 'shop', tok('--room-shop'), 'service', tok('--room-service'), 'open', tok('--room-open'), tok('--room')];
  }

  function placeFeatures() {
    return S.places.map((p, i) => {
      let color = tok('--' + p.layer), label = LAYER[p.layer].letter || '', text = '#ffffff', bandKey = '';
      if (p.layer === 'study') {
        const n = noiseFor(p.place_id); const b = band(n?.laeq);
        color = b ? tok('--' + b.key) : tok('--unmeasured');
        label = n ? String(Math.round(n.laeq)) : '–';
        bandKey = b ? b.key : '';
        if (bandKey === 'moderate') text = '#3a2b00';
      } else if (stateFor(p.place_id).working === 'n') { color = tok('--unmeasured'); }
      return { type: 'Feature', id: i, properties: { id: p.place_id, layer: p.layer, color, label, text, band: bandKey, study: p.layer === 'study' ? 1 : 0 }, geometry: { type: 'Point', coordinates: toLL(p.x, p.y) } };
    });
  }

  function installMap(svgText) {
    if (!window.maplibregl) throw new Error('MapLibre did not load (needs internet).');
    const geo = planGeo(svgText);
    S.plan = geo.plan;
    const pts = S.places.map((p) => toLL(p.x, p.y));
    const all = [...pts, ...geo.floor.flatMap((f) => f.geometry.coordinates[0])];
    const lo = [Math.min(...all.map((c) => c[0])), Math.min(...all.map((c) => c[1]))];
    const hi = [Math.max(...all.map((c) => c[0])), Math.max(...all.map((c) => c[1]))];
    const plo = [Math.min(...pts.map((c) => c[0])), Math.min(...pts.map((c) => c[1]))];
    const phi = [Math.max(...pts.map((c) => c[0])), Math.max(...pts.map((c) => c[1]))];
    const pad = 0.0008;
    const el = document.getElementById('map');
    el.replaceChildren();
    const w = el.clientWidth, p = Math.round(Math.min(90, w * 0.05));
    const map = new maplibregl.Map({
      container: 'map',
      style: { version: 8, glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf', sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': tok('--map-bg') } }] },
      bounds: [plo, phi], fitBoundsOptions: { padding: { top: Math.round(p * 0.8), bottom: Math.round(p * 0.8), left: p, right: p } },
      maxBounds: [[lo[0] - pad, lo[1] - pad], [hi[0] + pad, hi[1] + pad]],
      pitch: 0, bearing: 0, maxPitch: 70, attributionControl: false, renderWorldCopies: false
    });
    S.map = map;
    window.mscMap = map; // handy for debugging in the console
    map.on('error', (e) => console.warn('map:', e.error && e.error.message));
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');

    // Intro: start flat and a bit far, then glide into the tilted 3D view.
    const target = { center: map.getCenter(), zoom: map.getZoom() };
    if (!reduced()) map.jumpTo({ zoom: target.zoom - 1.1, bearing: 28 });

    map.on('load', () => {
      map.addSource('floor', { type: 'geojson', data: fc(geo.floor) });
      map.addSource('rooms', { type: 'geojson', data: fc(geo.rooms) });
      map.addSource('labels', { type: 'geojson', data: fc(geo.labels) });
      map.addSource('places', { type: 'geojson', data: fc(placeFeatures()) });
      map.addLayer({ id: 'floor', type: 'fill-extrusion', source: 'floor', paint: { 'fill-extrusion-color': tok('--floor'), 'fill-extrusion-height': 0.05, 'fill-extrusion-base': 0 } });
      map.addLayer({ id: 'rooms', type: 'fill-extrusion', source: 'rooms', paint: {
        'fill-extrusion-color': roomColor(), 'fill-extrusion-height': 0.06, 'fill-extrusion-base': 0.05, 'fill-extrusion-opacity': 0.96, 'fill-extrusion-vertical-gradient': true } });
      map.addLayer({ id: 'room-labels', type: 'symbol', source: 'labels', layout: {
        'text-field': ['get', 'text'], 'text-font': ['Open Sans Semibold'], 'text-size': ['case', ['==', ['get', 'big'], 1], 11, 10],
        'text-letter-spacing': ['case', ['==', ['get', 'big'], 1], 0.12, 0] },
        paint: { 'text-color': tok('--plan-label'), 'text-halo-color': tok('--map-bg'), 'text-halo-width': 1, 'text-opacity': 0, 'text-opacity-transition': { duration: 600, delay: 900 } } });
      map.addLayer({ id: 'noise-halo', type: 'circle', source: 'places', filter: ['==', ['get', 'study'], 1], paint: {
        'circle-color': ['get', 'color'], 'circle-opacity': 0, 'circle-blur': 0.55, 'circle-pitch-alignment': 'map', 'circle-pitch-scale': 'map',
        'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 16, 2, 22, 150],
        'circle-opacity-transition': { duration: 900, delay: 1500 }, 'circle-color-transition': { duration: 600 } } });
      map.addLayer({ id: 'pulse', type: 'circle', source: 'places', filter: ['==', ['get', 'id'], ''], paint: {
        'circle-radius': 12, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': tok('--accent'), 'circle-stroke-width': 2, 'circle-stroke-opacity': 0 } });
      map.addLayer({ id: 'sel', type: 'circle', source: 'places', filter: ['==', ['get', 'id'], ''], paint: {
        'circle-radius': 15, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': tok('--accent'), 'circle-stroke-width': 2.5 } });
      map.addLayer({ id: 'places', type: 'circle', source: 'places', filter: ['==', ['get', 'study'], 1], paint: {
        'circle-radius': 0, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5,
        'circle-radius-transition': { duration: 520, delay: 1300 }, 'circle-color-transition': { duration: 600 } } });
      map.addLayer({ id: 'place-labels', type: 'symbol', source: 'places', filter: ['==', ['get', 'study'], 1], layout: {
        'text-field': ['get', 'label'], 'text-font': ['Open Sans Semibold'], 'text-size': 11, 'text-allow-overlap': true, 'text-ignore-placement': true },
        paint: { 'text-color': ['get', 'text'], 'text-opacity': 0, 'text-opacity-transition': { duration: 400, delay: 1650 } } });

      // Entrance choreography: camera glides in, rooms rise as a wave, markers and labels pop in.
      map.easeTo({ center: target.center, zoom: target.zoom, pitch: S.view === 'iso' ? 52 : 0, bearing: S.view === 'iso' ? -17 : 0, duration: reduced() ? 0 : 2200, easing: easeOut });
      riseRooms(reduced() ? 0 : 1300);
      map.setPaintProperty('places', 'circle-radius', ['case', ['boolean', ['feature-state', 'hover'], false], 14, 11]);
      map.setPaintProperty('places', 'circle-radius-transition', { duration: 520, delay: 0 });
      setTimeout(() => map.setPaintProperty('places', 'circle-radius-transition', { duration: 160, delay: 0 }), 1900);
      map.setPaintProperty('place-labels', 'text-opacity', 1);
      map.setPaintProperty('room-labels', 'text-opacity', 1);
      map.setPaintProperty('noise-halo', 'circle-opacity', ['case', ['boolean', ['feature-state', 'hover'], false], 0.3, 0.16]);
      applyVisibility();
      loadModels(map);
      bindMapPointer(map);
      pulseLoop();
    });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => setTimeout(recolor, 50));
  }

  function riseRooms(ms) {
    const map = S.map, t0 = performance.now();
    const frame = () => {
      const k = ms ? Math.min(1, (performance.now() - t0) / ms) : 1;
      // Each room grows over the window [delay, delay + 0.4] of the shared clock k ∈ [0, 1].
      map.setPaintProperty('rooms', 'fill-extrusion-height',
        ['+', 0.06, ['*', ['-', ['get', 'height'], 0.06], ['min', 1, ['max', 0, ['/', ['-', k * 1.0, ['get', 'delay']], 0.4]]]]]);
      if (k < 1) requestAnimationFrame(frame); else map.setPaintProperty('rooms', 'fill-extrusion-height', ['get', 'height']);
    };
    frame();
  }

  async function loadModels(map) {
    try {
      const mod = await import('./model3d.js');
      const items = S.places.filter((p) => p.layer !== 'study').map((p) => ({
        id: p.place_id, kind: p.layer, lngLat: toLL(p.x, p.y), base: roofAt(p.x, p.y), heading: -0.3, data: modelData(p)
      }));
      S.models = mod.createMapLayer(maplibregl, items, { origin: toLL(OX, OY), delay: reduced() ? 0 : 1500 });
      map.addLayer(S.models.layer, 'noise-halo');
      applyVisibility();
      if (S.selected) S.models.setSelected(S.selected);
    } catch (e) {
      console.warn('3D models unavailable:', e.message);
      // Fallback: show amenity markers as plain circles.
      ['places', 'place-labels'].forEach((id) => map.setFilter(id, null));
      applyVisibility();
    }
  }

  function modelData(p) {
    const st = stateFor(p.place_id);
    if (p.layer === 'vending') return { working: st.working || '', items: itemsFor(p.place_id).map((i) => ({ ...i, price_usd: i.price })) };
    if (p.layer === 'water') return { working: st.working || '', cold: num(st.cold), counter: num(st.counter), filter_light: st.filter_light || '' };
    if (p.layer === 'microwave') return { units: num(st.units), units_working: num(st.units_working), extras: /utensil|napkin/i.test((p.note || '') + ' ' + (st.note || '')) ? ['utensils', 'napkins'] : [] };
    return { units: num(st.units), units_working: num(st.units_working), broken_note: st.note || '' };
  }

  function bindMapPointer(map) {
    const tip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 16, className: 'tip', maxWidth: '240px' });
    let hoverFid = null, hoverId = null;
    const idAt = (pt) => {
      const f = map.queryRenderedFeatures(pt, { layers: ['places'] })[0];
      if (f) return { id: f.properties.id, fid: f.id };
      const id = S.models ? S.models.pick(pt.x, pt.y) : null;
      return id ? { id, fid: null } : null;
    };
    map.on('mousemove', (e) => {
      const hit = idAt(e.point);
      const id = hit ? hit.id : null;
      if (hoverFid != null && (!hit || hit.fid !== hoverFid)) { map.setFeatureState({ source: 'places', id: hoverFid }, { hover: false }); hoverFid = null; }
      if (hit && hit.fid != null && hit.fid !== hoverFid) { hoverFid = hit.fid; map.setFeatureState({ source: 'places', id: hoverFid }, { hover: true }); }
      if (S.models) S.models.setHover(hit && hit.fid == null ? id : null);
      map.getCanvas().style.cursor = id ? 'pointer' : '';
      if (id !== hoverId) {
        hoverId = id;
        if (!id) tip.remove();
        else { const p = S.byId.get(id); tip.setLngLat(toLL(p.x, p.y)).setDOMContent(h('div', {}, h('b', {}, p.name), h('span', {}, describe(p)))).addTo(map); }
      }
    });
    map.getCanvas().addEventListener('mouseleave', () => { tip.remove(); hoverId = null; if (S.models) S.models.setHover(null); });
    map.on('click', (e) => { const hit = idAt(e.point); if (hit) select(hit.id, true); });
  }

  // Selected marker: an expanding ring that repeats while something is selected.
  function pulseLoop() {
    const map = S.map;
    const frame = (now) => {
      if (S.selected && S.map.getLayer('pulse') && !reduced()) {
        const t = (now % 1600) / 1600;
        map.setPaintProperty('pulse', 'circle-radius', 13 + 22 * easeOut(t));
        map.setPaintProperty('pulse', 'circle-stroke-opacity', 0.7 * (1 - t));
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  function recolor() {
    const map = S.map;
    if (!map || !map.getLayer('rooms')) return;
    map.setPaintProperty('bg', 'background-color', tok('--map-bg'));
    map.setPaintProperty('floor', 'fill-extrusion-color', tok('--floor'));
    map.setPaintProperty('rooms', 'fill-extrusion-color', roomColor());
    map.setPaintProperty('room-labels', 'text-color', tok('--plan-label'));
    map.setPaintProperty('room-labels', 'text-halo-color', tok('--map-bg'));
    ['sel', 'pulse'].forEach((id) => map.setPaintProperty(id, 'circle-stroke-color', tok('--accent')));
    updateMarkers();
  }

  function updateMarkers() {
    const src = S.map && S.map.getSource('places');
    if (src) src.setData(fc(placeFeatures()));
  }

  function applyVisibility() {
    const map = S.map;
    if (!map || !map.getLayer('places')) return;
    const vis = ['in', ['get', 'layer'], ['literal', [...S.visible]]];
    const studyOnly = S.models ? ['==', ['get', 'study'], 1] : true;
    ['places', 'place-labels'].forEach((id) => map.setFilter(id, ['all', studyOnly, vis]));
    map.setFilter('noise-halo', ['all', ['==', ['get', 'study'], 1], vis]);
    if (S.models) S.models.setVisible([...S.visible]);
  }

  function describe(p) {
    if (p.layer === 'study') {
      const n = noiseFor(p.place_id);
      const o = obsFor(p.place_id);
      if (!n) return 'Not measured yet';
      const b = band(n.laeq);
      return `${n.laeq.toFixed(1)} dBA · ${b.label}${o && o.people ? ' · ' + o.people + (o.people === '1' ? ' person' : ' people') : ''}`;
    }
    const st = stateFor(p.place_id);
    if (p.layer === 'vending') { const it = itemsFor(p.place_id); return it.length ? `${it.length} products logged` : 'Products not logged yet'; }
    if (p.layer === 'water') return st.counter ? `Counter ${Number(st.counter).toLocaleString('en-US')}` : 'Not measured yet';
    if (st.units) return `${st.units_working || '?'} of ${st.units} working`;
    return 'Not measured yet';
  }

  function select(id, fromMap = false) {
    S.selected = id;
    const map = S.map;
    if (map && map.getLayer('sel')) {
      const isStudy = S.byId.get(id).layer === 'study';
      map.setFilter('sel', isStudy ? ['==', ['get', 'id'], id] : ['==', ['get', 'id'], '']);
      map.setFilter('pulse', isStudy ? ['==', ['get', 'id'], id] : ['==', ['get', 'id'], '']);
    }
    if (S.models) S.models.setSelected(id);
    document.querySelectorAll('.rank').forEach((b) => b.classList.toggle('is-selected', b.dataset.id === id));
    setTab('details');
    renderDetails();
    if (map) {
      const p = S.byId.get(id);
      map.flyTo({ center: toLL(p.x, p.y), zoom: Math.max(map.getZoom(), fromMap ? map.getZoom() : 19), duration: reduced() ? 0 : 1000, essential: true });
      if (!fromMap && window.innerWidth < 820) document.getElementById('map').scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
    }
  }

  /* ---------------- panel ---------------- */
  function setTab(name) {
    if (S.tab === name && !S.firstPaint) return;
    S.tab = name;
    ['quiet', 'vending', 'details'].forEach((t) => {
      const on = t === name;
      $('tab-' + t).setAttribute('aria-selected', String(on));
      $('tab-' + t).tabIndex = on ? 0 : -1;
      const panel = $('panel-' + t);
      panel.hidden = !on;
      if (on) { panel.classList.remove('swap'); void panel.offsetWidth; panel.classList.add('swap'); }
    });
  }
  function bindTabs() {
    const tabs = ['quiet', 'vending', 'details'];
    tabs.forEach((t, i) => {
      $('tab-' + t).addEventListener('click', () => setTab(t));
      $('tab-' + t).addEventListener('keydown', (e) => {
        const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!d) return;
        const next = tabs[(i + d + tabs.length) % tabs.length];
        setTab(next); $('tab-' + next).focus();
      });
    });
    $('vending-search').addEventListener('input', (e) => { S.vendingQuery = e.target.value.trim().toLowerCase(); renderVending(); });
  }

  function renderQuiet(animate = false) {
    const list = $('quiet-list');
    const before = new Map([...list.children].map((li) => [li.dataset.id, li.getBoundingClientRect().top]));
    const rows = S.places.filter((p) => p.layer === 'study').map((p) => ({ p, n: noiseFor(p.place_id), o: obsFor(p.place_id) }))
      .sort((a, b) => (a.n ? a.n.laeq : Infinity) - (b.n ? b.n.laeq : Infinity) || a.p.name.localeCompare(b.p.name));
    if (!S.visible.has('study')) { list.replaceChildren(h('li', {}, h('p', { class: 'empty' }, 'Study places are hidden. Turn the layer on to rank them.'))); return; }
    let rank = 0;
    list.replaceChildren(...rows.map(({ p, n, o }, i) => {
      const b = band(n?.laeq);
      if (n) rank += 1;
      const li = h('li', { 'data-id': p.place_id, style: animate ? '' : `--delay:${700 + i * 45}ms` },
        h('button', { type: 'button', class: 'rank' + (S.selected === p.place_id ? ' is-selected' : ''), 'data-id': p.place_id, onclick: () => select(p.place_id) },
          h('span', { class: 'rank-no' }, n ? rank : '–'),
          h('span', {}, h('span', { class: 'rank-name' }, p.name),
            h('span', { class: 'rank-meta' }, [areaName(p), o && o.people ? `${o.people} ${o.people === '1' ? 'person' : 'people'}` : ''].filter(Boolean).join(' · '))),
          h('span', { class: 'rank-value' }, h('span', { class: 'rank-db' }, n ? n.laeq.toFixed(1) : '—', n ? h('small', {}, ' dBA') : ''),
            h('span', { class: 'band ' + (b ? b.key : '') }, b ? b.label : 'not measured'))));
      if (animate) li.style.animation = 'none';
      return li;
    }));
    if (animate && !reduced()) {
      [...list.children].forEach((li) => {
        const old = before.get(li.dataset.id);
        if (old == null) return;
        const dy = old - li.getBoundingClientRect().top;
        if (!dy) return;
        li.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], { duration: 380, easing: 'cubic-bezier(.22,.8,.24,1)' });
      });
    }
  }

  function renderVending() {
    const box = $('vending-list');
    const all = S.places.filter((p) => p.layer === 'vending').flatMap((p) => itemsFor(p.place_id).map((it) => ({ it, p })));
    if (!all.length) {
      box.replaceChildren(h('p', { class: 'empty' }, 'Products not transcribed yet. We read them from our photos of each machine; they will appear here with prices and sold-out slots.'));
      return;
    }
    const q = S.vendingQuery;
    const rows = all.filter(({ it }) => !q || (it.product || '').toLowerCase().includes(q))
      .sort((a, b) => (a.it.price ?? Infinity) - (b.it.price ?? Infinity));
    const cheapest = rows.find((r) => r.it.sold_out !== 'y');
    box.replaceChildren(
      h('p', { class: 'panel-intro' }, `${rows.length} of ${all.length} products` + (cheapest ? ` · cheapest available: ${cheapest.it.product} (${money(cheapest.it.price)}) in ${cheapest.p.name}` : '')),
      ...rows.map(({ it, p }) => h('button', { type: 'button', class: 'v-row', onclick: () => select(p.place_id) },
        h('span', {}, h('span', { class: 'v-name' }, it.product || 'Unknown product'),
          h('span', { class: 'v-meta' }, [p.name, it.slot && 'slot ' + it.slot, it.size].filter(Boolean).join(' · '))),
        h('span', { class: 'v-price' }, it.sold_out === 'y' ? h('span', { class: 'soldout' }, 'SOLD OUT') : money(it.price)))));
  }

  function stat(label, value, unit, hint) {
    return h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, label),
      h('span', { class: 'stat-value' }, value, unit ? h('small', {}, unit) : ''), hint ? h('span', { class: 'stat-hint' }, hint) : '');
  }

  function renderDetails() {
    const box = $('details');
    const p = S.byId.get(S.selected);
    if (!p) { box.replaceChildren(h('p', { class: 'empty' }, 'Pick a place on the map or in a list to see everything we measured there.')); return; }
    const L = LAYER[p.layer];
    const kids = [h('div', { class: 'd-head' },
      h('span', { class: 'd-layer', style: `--chip-color:${L.color}` }, h('i', {}), L.one),
      h('h2', { class: 'd-title' }, p.name),
      h('p', { class: 'd-sub' }, [areaName(p), p.location_note].filter(Boolean).join(' · ')))];
    if (p.note) kids.push(h('p', { class: 'note-box' }, p.note));

    const st = stateFor(p.place_id);
    if (p.layer === 'study') {
      const n = noiseFor(p.place_id), o = obsFor(p.place_id), b = band(n?.laeq);
      kids.push(h('div', { class: 'stats' },
        stat('Noise LAeq', n ? n.laeq.toFixed(1) : '—', n ? 'dBA' : '', b ? b.label : 'not measured'),
        stat('Peak (max)', n && n.lmax != null ? n.lmax.toFixed(1) : '—', n ? 'dB' : ''),
        stat('People', o && o.people ? o.people : '—', '', o && /area/i.test(o.note || '') ? 'whole area' : ''),
        p.seats_total ? stat('Seats', p.seats_total, '', p.outlets ? p.outlets + ' outlets' : '') : null));
    } else if (p.layer === 'water') {
      kids.push(h('div', { class: 'stats' },
        stat('Counter', st.counter ? Number(st.counter).toLocaleString('en-US') : '—', '', 'bottles saved'),
        stat('Working', st.working ? (st.working === 'y' ? 'Yes' : 'No') : '—'),
        stat('Cold', st.cold ? `${st.cold}/3` : '—')));
      const usage = counterUsage(p.place_id);
      if (usage) kids.push(h('p', { class: 'note-box' }, usage));
    } else if (p.layer === 'vending') {
      const it = itemsFor(p.place_id);
      const avail = it.filter((i) => i.sold_out !== 'y' && i.price != null).sort((a, b) => a.price - b.price);
      kids.push(h('div', { class: 'stats' },
        stat('Products', it.length || '—'), stat('Sold out', it.length ? it.filter((i) => i.sold_out === 'y').length : '—'),
        stat('Cheapest', avail[0] ? money(avail[0].price) : '—', '', avail[0] ? avail[0].product : '')));
    } else {
      kids.push(h('div', { class: 'stats' },
        stat('Units', st.units || '—'), stat('Working', st.units_working || '—', st.units ? `/ ${st.units}` : ''),
        p.layer === 'microwave' ? stat('Clean', st.clean ? `${st.clean}/5` : '—') : null,
        p.layer === 'microwave' ? stat('Waiting', st.waiting || '—') : null));
    }

    if (p.layer !== 'study') {
      kids.push(h('button', { type: 'button', class: 'btn', onclick: () => open3d(p) },
        cubeIcon(), 'View in 3D'));
    }

    const photos = photosFor(p.place_id);
    kids.push(h('h3', { class: 'section-title' }, `Photos (${photos.length})`));
    kids.push(photos.length ? h('div', { class: 'thumbs' }, photos.map((ph, i) => h('button', {
      type: 'button', class: 'thumb', 'aria-label': `Open photo ${i + 1}: ${ph.caption || p.name}`, onclick: (e) => openLightbox(photos, i, e.currentTarget)
    }, h('img', { src: ph.file, alt: ph.caption || p.name, loading: 'lazy' }), h('span', {}, ph.round))))
      : h('p', { class: 'empty' }, 'No photos yet.'));

    if (p.layer === 'vending') {
      const it = itemsFor(p.place_id);
      kids.push(h('h3', { class: 'section-title' }, 'Products'));
      kids.push(it.length ? productTable(it) : h('p', { class: 'empty' }, 'Products not transcribed yet. They are read from our photos of the machine.'));
    }

    kids.push(h('h3', { class: 'section-title' }, 'Every measurement'));
    kids.push(historyTable(p));
    box.replaceChildren(...kids);
    const panel = $('panel-details');
    panel.classList.remove('swap'); void panel.offsetWidth; panel.classList.add('swap');
  }

  function counterUsage(id) {
    const rows = S.obs.filter((o) => o.place_id === id && num(o.counter) != null && o.t).sort((a, b) => a.t - b.t);
    if (rows.length < 2) return rows.length === 1 ? 'One counter reading so far. A second reading in a later round gives bottles filled per hour.' : '';
    const a = rows[0], b = rows[rows.length - 1];
    const diff = num(b.counter) - num(a.counter);
    const hours = (b.t - a.t) / 3.6e6;
    return `${diff.toLocaleString('en-US')} bottles filled between ${fmtTime(a.t)} and ${fmtTime(b.t)} (≈ ${(diff / hours).toFixed(1)} per hour).`;
  }

  function productTable(items) {
    let sortKey = 'price';
    const wrap = h('div', { class: 'table-wrap' });
    const draw = () => {
      const sorted = [...items].sort((a, b) => sortKey === 'price' ? (a.price ?? Infinity) - (b.price ?? Infinity) : String(a.slot).localeCompare(String(b.slot), 'en', { numeric: true }));
      wrap.replaceChildren(h('table', {},
        h('thead', {}, h('tr', {},
          h('th', {}, h('button', { type: 'button', onclick: () => { sortKey = 'slot'; draw(); } }, 'Slot')),
          h('th', {}, 'Product'), h('th', {}, 'Size'),
          h('th', {}, h('button', { type: 'button', onclick: () => { sortKey = 'price'; draw(); } }, 'Price')))),
        h('tbody', {}, sorted.map((i) => h('tr', {}, h('td', { class: 'n' }, i.slot || '—'), h('td', {}, i.product || '—'),
          h('td', {}, i.size || '—'), h('td', { class: 'n' }, i.sold_out === 'y' ? h('span', { class: 'soldout' }, 'SOLD OUT') : money(i.price)))))));
    };
    draw();
    return wrap;
  }

  function historyTable(p) {
    const rows = [];
    S.noise.filter((n) => n.place_id === p.place_id).forEach((n) => rows.push({ t: n.t, round: n.round, what: 'Noise',
      value: `${n.laeq?.toFixed(1)} dBA (max ${n.lmax?.toFixed(1)}, peak ${n.lcpeak?.toFixed(1)}, ${n.dur} s)`, src: n.source_file, note: n.note }));
    S.obs.filter((o) => o.place_id === p.place_id).forEach((o) => {
      const parts = [];
      if (o.people) parts.push(`${o.people} ${o.people === '1' ? 'person' : 'people'}`);
      if (o.seats_taken) parts.push(`${o.seats_taken} seats taken`);
      if (o.working) parts.push(o.working === 'y' ? 'working' : 'not working');
      if (o.cold) parts.push(`cold ${o.cold}/3`);
      if (o.counter) parts.push(`counter ${Number(o.counter).toLocaleString('en-US')}`);
      if (o.units) parts.push(`${o.units_working || '?'} of ${o.units} working`);
      if (o.clean) parts.push(`clean ${o.clean}/5`);
      if (o.waiting) parts.push(`${o.waiting} waiting`);
      rows.push({ t: o.t, round: o.round, what: 'Check', value: parts.join(', ') || '—', note: o.note });
    });
    if (!rows.length) return h('p', { class: 'empty' }, 'Not measured yet. This place is on our collection route.');
    rows.sort((a, b) => (a.t?.getTime() || 0) - (b.t?.getTime() || 0));
    return h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Round'), h('th', {}, 'Time'), h('th', {}, 'Measured'), h('th', {}, 'Source'), h('th', {}, 'Note'))),
      h('tbody', {}, rows.map((r) => h('tr', {}, h('td', { class: 'n' }, r.round), h('td', {}, fmtTime(r.t)), h('td', {}, r.value),
        h('td', {}, r.src ? h('a', { href: r.src, target: '_blank', rel: 'noopener' }, 'PDF report') : 'field log'), h('td', {}, r.note || '—'))))));
  }

  function cubeIcon() {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = '<path d="M12 2 21 7v10l-9 5-9-5V7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M3 7l9 5 9-5M12 12v10" fill="none" stroke="currentColor" stroke-width="1.8"/>';
    return svg;
  }

  /* ---------------- global search (places + vending products) ---------------- */
  function searchResults(q) {
    const out = [];
    const seen = new Set();
    const add = (p, meta, val) => { if (seen.has(p.place_id)) return; seen.add(p.place_id); out.push({ p, meta, val }); };
    const wantsQuiet = ['quiet', 'study', 'noise', 'seat'].some((w) => w.startsWith(q) || q.startsWith(w));
    if (wantsQuiet) {
      S.places.filter((p) => p.layer === 'study').map((p) => ({ p, n: noiseFor(p.place_id) }))
        .sort((a, b) => (a.n ? a.n.laeq : 999) - (b.n ? b.n.laeq : 999))
        .forEach(({ p, n }) => add(p, areaName(p), n ? n.laeq.toFixed(1) + ' dBA' : ''));
    }
    S.places.forEach((p) => {
      const hay = [p.name, areaName(p), LAYER[p.layer].label, LAYER[p.layer].one, p.location_note].join(' ').toLowerCase();
      if (hay.includes(q)) add(p, describe(p), '');
    });
    S.items.filter((i) => (i.product || '').toLowerCase().includes(q) || (i.category || '').toLowerCase().includes(q))
      .forEach((i) => add(S.byId.get(i.place_id), `${i.product}${i.slot ? ' · slot ' + i.slot : ''}`, i.price != null ? money(i.price) : ''));
    return out.slice(0, 8);
  }
  function bindGlobalSearch() {
    const input = $('global-search'), list = $('global-results');
    let rows = [], active = -1;
    const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; };
    const choose = (r) => { close(); input.value = ''; input.blur(); select(r.p.place_id); };
    const paint = () => {
      list.replaceChildren(...(rows.length ? rows.map((r, i) => h('li', { role: 'option', 'aria-selected': String(i === active) },
        h('button', { type: 'button', class: i === active ? 'is-active' : '', onmousedown: (e) => e.preventDefault(), onclick: () => choose(r) },
          h('span', { class: 'g-ico', style: `--chip-color:${LAYER[r.p.layer].color}` }, LAYER[r.p.layer].letter || 'dB'),
          h('span', {}, h('span', { class: 'g-name' }, r.p.name), h('span', { class: 'g-meta' }, r.meta)),
          h('span', { class: 'g-val' }, r.val))))
        : [h('li', { class: 'g-empty' }, 'Nothing matches. Try "quiet", "water", "chips" or "microwave".')]));
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    };
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      if (!q) { close(); return; }
      rows = searchResults(q); active = rows.length ? 0 : -1; paint();
    });
    input.addEventListener('keydown', (e) => {
      if (list.hidden) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!rows.length) return;
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length; paint();
      } else if (e.key === 'Enter' && rows[active]) { e.preventDefault(); choose(rows[active]); }
      else if (e.key === 'Escape') close();
    });
    input.addEventListener('blur', () => setTimeout(close, 120));
  }

  /* ---------------- facts ---------------- */
  function renderFacts() {
    const measured = S.noise.filter((n) => n.laeq != null);
    const times = [...S.noise, ...S.obs].map((r) => r.t).filter(Boolean).sort((a, b) => a - b);
    const quiet = [...measured].sort((a, b) => a.laeq - b.laeq)[0];
    const loud = [...measured].sort((a, b) => b.laeq - a.laeq)[0];
    const facts = [
      [S.places.length, 'places logged on the 1st floor'],
      [measured.length, 'noise measurements (NIOSH SLM reports)'],
      [S.rounds.length, `collection round${S.rounds.length === 1 ? '' : 's'}` + (times.length ? `, ${fmtTime(times[0])} – ${fmtTime(times[times.length - 1])}` : '')],
      quiet && loud ? [`${(loud.laeq - quiet.laeq).toFixed(1)} dB`, `between the quietest (${S.byId.get(quiet.place_id).name}) and loudest (${S.byId.get(loud.place_id).name}) spot`] : null
    ].filter(Boolean);
    if ($('facts')) $('facts').replaceChildren(...facts.map(([v, l]) => h('div', { class: 'fact' }, h('span', { class: 'fact-value' }, v), h('span', { class: 'fact-label' }, l))));
  }

  /* ---------------- lightbox ---------------- */
  const LB = { list: [], i: 0, opener: null };
  function openLightbox(list, i, opener) {
    LB.list = list; LB.i = i; LB.opener = opener;
    showPhoto();
    $('lightbox').showModal();
  }
  function showPhoto() {
    const ph = LB.list[LB.i];
    const img = $('lightbox-img');
    img.src = ph.file;
    img.alt = ph.caption || S.byId.get(ph.place_id)?.name || 'Field photo';
    $('lightbox-caption').textContent = [S.byId.get(ph.place_id)?.name, ph.caption, ph.round, fmtTime(ph.t), `${LB.i + 1} / ${LB.list.length}`].filter((x) => x && x !== '—').join(' · ');
    $('lightbox-prev').hidden = LB.list.length < 2;
    $('lightbox-next').hidden = LB.list.length < 2;
  }
  function stepPhoto(d) { if (LB.list.length < 2) return; LB.i = (LB.i + d + LB.list.length) % LB.list.length; showPhoto(); }
  function bindModals() {
    const lb = $('lightbox');
    $('lightbox-prev').addEventListener('click', () => stepPhoto(-1));
    $('lightbox-next').addEventListener('click', () => stepPhoto(1));
    lb.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') stepPhoto(-1); if (e.key === 'ArrowRight') stepPhoto(1); });
    let x0 = null;
    lb.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    lb.addEventListener('touchend', (e) => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) stepPhoto(dx < 0 ? 1 : -1); x0 = null; });
    lb.addEventListener('close', () => { if (LB.opener) LB.opener.focus(); });
    [lb, $('viewer3d')].forEach((d) => {
      d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
    });
    $('viewer3d').addEventListener('close', () => { if (V.handle) { V.handle.dispose(); V.handle = null; } if (V.opener) V.opener.focus(); });
  }

  /* ---------------- 3D viewer ---------------- */
  const V = { mod: null, handle: null, opener: null };
  async function open3d(p) {
    V.opener = document.activeElement;
    const dlg = $('viewer3d');
    $('viewer3d-kind').textContent = LAYER[p.layer].one + (S.round === LATEST ? ' · latest data' : ' · round ' + S.round);
    $('viewer3d-title').textContent = p.name;
    $('viewer3d-pick').textContent = p.layer === 'vending' ? (itemsFor(p.place_id).length ? 'Point at a product to see its name and price.' : '') : '';
    const stage = $('viewer3d-stage');
    stage.replaceChildren(h('span', {}, 'Loading 3D view…'));
    dlg.showModal();
    try {
      V.mod = V.mod || await import('./model3d.js');
    } catch (e) {
      console.error(e);
      stage.replaceChildren(h('span', {}, '3D view could not load (it needs internet for Three.js).'));
      return;
    }
    if (!dlg.open) return;
    stage.replaceChildren();
    const data = modelData(p);
    V.handle = V.mod.open(stage, {
      kind: p.layer, title: p.name, data,
      onPick: (item) => { $('viewer3d-pick').textContent = item ? `${item.slot ? item.slot + ' · ' : ''}${item.product} · ${item.sold_out === 'y' ? 'sold out' : money(num(item.price_usd))}` : ''; }
    });
  }

  /* ---------------- boot ---------------- */
  function refreshAll(animate) {
    updateMarkers(animate);
    renderQuiet(animate);
    renderVending();
    renderDetails();
  }

  function fail(err) {
    console.error(err);
    const msg = location.protocol === 'file:'
      ? 'Open this app through a web server: run "python -m http.server" in the repo folder and visit http://localhost:8000.'
      : 'Could not load the data: ' + err.message;
    $('map').replaceChildren(h('p', { class: 'map-error' }, msg));
  }

  async function boot() {
    bindTabs();
    bindModals();
    try {
      if (!window.Papa) throw new Error('PapaParse did not load (needs internet).');
      const svgText = await load();
      renderChips();
      renderRounds();
      installMap(svgText);
      bindView();
      bindGlobalSearch();
      setTab('quiet');
      S.firstPaint = false;
      refreshAll(false);
    } catch (e) { fail(e); }
  }
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', boot) : boot();
})();
