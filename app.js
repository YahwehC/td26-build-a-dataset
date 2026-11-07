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
    svg: null, markers: new Map(), markerLayer: null, firstPaint: true
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
    nav.replaceChildren(...LAYERS.map((l, i) => h('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(S.visible.has(l.key)), style: `--chip-color:${l.color};--delay:${120 + i * 45}ms`,
      onclick: (e) => {
        S.visible.has(l.key) ? S.visible.delete(l.key) : S.visible.add(l.key);
        e.currentTarget.setAttribute('aria-pressed', String(S.visible.has(l.key)));
        applyVisibility();
        renderQuiet();
      }
    }, h('span', { class: 'dot', 'aria-hidden': 'true' }), l.label, h('span', { class: 'count' }, S.places.filter((p) => p.layer === l.key).length))),
    h('button', {
      type: 'button', class: 'chip', 'aria-pressed': 'true', style: '--chip-color:radial-gradient(circle,var(--loud),transparent 75%);--delay:360ms',
      onclick: (e) => {
        S.glow = !S.glow;
        e.currentTarget.setAttribute('aria-pressed', String(S.glow));
        $('map').classList.toggle('no-glow', !S.glow);
      }
    }, h('span', { class: 'dot', 'aria-hidden': 'true' }), 'Noise glow'));
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
    const sync = () => buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === IsoMap.getMode())));
    buttons.forEach((b) => b.addEventListener('click', () => { IsoMap.setMode(b.dataset.mode); sync(); }));
    sync();
  }

  /* ---------------- map + markers ---------------- */
  function installMap(svgText) {
    const map = $('map');
    map.innerHTML = svgText;
    S.svg = map.querySelector('svg');
    S.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    IsoMap.attach(S.svg);
    S.markerLayer = s('g', { id: 'markers' }, S.svg);
    buildMarkers();
    IsoMap.onFrame(positionMarkers);
    new ResizeObserver(() => positionMarkers()).observe(map);
    positionMarkers();
  }

  function buildMarkers() {
    // Pop-in order: back to front, after the blocks have grown.
    const order = [...S.places].sort((a, b) => (a.x + a.y) - (b.x + b.y));
    order.forEach((p, i) => {
      const g = s('g', { class: 'marker', 'data-id': p.place_id, 'data-layer': p.layer, tabindex: '0', role: 'button' }, S.markerLayer);
      const pop = s('g', { class: 'pop' }, g);
      const enter = s('g', { class: reduced() ? '' : 'enter', style: `--delay:${900 + i * 34}ms` }, pop);
      const m = { place: p, g, enter, parts: {} };
      m.parts.shadow = s('ellipse', { class: 'shadow', rx: 9, ry: 3.6 }, enter);
      if (p.layer === 'study') m.parts.glow = s('ellipse', { class: 'glow', rx: 48, ry: 30, style: `--breathe:${(-i * 0.37).toFixed(2)}s` }, enter);
      const lift = s('g', { class: 'lift' }, enter);
      m.parts.stem = s('line', { class: 'stem', x1: 0, y1: 0, x2: 0, y2: -24 }, lift);
      const head = s('g', { class: 'head-g' }, lift);
      m.parts.headG = head;
      if (p.layer === 'study') {
        m.parts.head = s('circle', { class: 'head', r: 11 }, head);
        m.parts.db = s('text', { class: 'db', y: -19 }, head);
      } else {
        m.parts.head = s('rect', { class: 'head', x: -12, y: -12, width: 24, height: 24, rx: 7, fill: LAYER[p.layer].color }, head);
        s('text', { class: 'glyph-text', y: 1 }, head).textContent = LAYER[p.layer].letter;
        m.parts.slash = s('line', { class: 'slash', x1: -10, y1: 10, x2: 10, y2: -10, display: 'none' }, head);
      }
      m.parts.ring = s('circle', { class: 'ring', r: 17 }, head);
      m.parts.pulse = s('circle', { class: 'ring-pulse', r: 17 }, head);
      m.parts.badge = s('g', { class: 'badge-g', transform: 'translate(11 -11)', display: 'none' }, head);
      s('circle', { class: 'badge', r: 6.5 }, m.parts.badge);
      s('circle', { class: 'badge-lens', r: 2.4 }, m.parts.badge);
      g.addEventListener('click', () => select(p.place_id, true));
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(p.place_id, true); } });
      g.addEventListener('pointerenter', () => showTip(m));
      g.addEventListener('pointerleave', hideTip);
      g.addEventListener('focus', () => showTip(m));
      g.addEventListener('blur', hideTip);
      enter.addEventListener('animationend', () => enter.classList.remove('enter'), { once: true });
      S.markers.set(p.place_id, m);
    });
    updateMarkers(false);
  }

  function unitsPerPx() {
    const vb = S.svg.viewBox.baseVal;
    const r = S.svg.getBoundingClientRect();
    if (!r.width || !r.height) return 1;
    return Math.max(vb.width / r.width, vb.height / r.height);
  }

  function positionMarkers() {
    if (!S.svg) return;
    const k = unitsPerPx() * (S.svg.getBoundingClientRect().width < 560 ? 0.72 : 1);
    const morph = IsoMap.morph();
    const placed = [];
    S.markers.forEach((m) => {
      const z = IsoMap.elevationAt(m.place.x, m.place.y);
      const pt = IsoMap.project(m.place.x, m.place.y, z);
      m.g.setAttribute('transform', `translate(${pt.x.toFixed(1)} ${pt.y.toFixed(1)}) scale(${k.toFixed(3)})`);
      const stem = 6 + 20 * morph;
      m.parts.stem.setAttribute('y2', String(-stem));
      m.parts.headG.setAttribute('transform', `translate(0 ${-stem})`);
      m.parts.shadow.setAttribute('opacity', String(0.25 + 0.75 * morph));
      if (m.parts.glow) m.parts.glow.setAttribute('ry', String(48 * (1 - 0.42 * morph)));
      placed.push([pt.y, m.g]);
    });
    placed.sort((a, b) => a[0] - b[0]).forEach(([, g]) => S.markerLayer.appendChild(g));
  }

  function tween(from, to, ms, fn) {
    if (reduced() || from == null || to == null || from === to) { fn(to); return; }
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms);
      fn(from + (to - from) * (1 - Math.pow(1 - t, 3)));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function updateMarkers(animate) {
    S.markers.forEach((m) => {
      const p = m.place;
      const hasPhotos = photosFor(p.place_id).length > 0;
      m.parts.badge.setAttribute('display', hasPhotos ? 'inline' : 'none');
      if (p.layer === 'study') {
        const n = noiseFor(p.place_id);
        const b = band(n?.laeq);
        const color = b ? `var(--${b.key})` : 'var(--unmeasured)';
        m.parts.head.setAttribute('fill', color);
        m.parts.glow.setAttribute('fill', color);
        m.parts.glow.style.visibility = n ? 'visible' : 'hidden';
        const to = n ? n.laeq : null;
        const from = m.db;
        m.db = to;
        if (to == null) m.parts.db.textContent = '—';
        else if (animate) tween(from, to, 420, (v) => { m.parts.db.textContent = Math.round(v); });
        else m.parts.db.textContent = Math.round(to);
      } else {
        const st = stateFor(p.place_id);
        m.parts.slash.setAttribute('display', st.working === 'n' ? 'inline' : 'none');
      }
    });
    applyVisibility();
  }

  function applyVisibility() {
    S.markers.forEach((m) => m.g.classList.toggle('is-hidden', !S.visible.has(m.place.layer)));
  }

  function describe(p) {
    if (p.layer === 'study') {
      const n = noiseFor(p.place_id);
      const o = obsFor(p.place_id);
      if (!n) return 'Not measured yet';
      const b = band(n.laeq);
      return `${n.laeq.toFixed(1)} dBA · ${b.label}${o && o.people ? ' · ' + o.people + ' people' : ''}`;
    }
    const st = stateFor(p.place_id);
    if (p.layer === 'vending') { const it = itemsFor(p.place_id); return it.length ? `${it.length} products logged` : 'Products not logged yet'; }
    if (p.layer === 'water') return st.counter ? `Counter ${Number(st.counter).toLocaleString('en-US')}` : 'Not measured yet';
    if (st.units) return `${st.units_working || '?'} of ${st.units} working`;
    return 'Not measured yet';
  }

  function showTip(m) {
    const tip = $('tooltip');
    const card = tip.parentElement.getBoundingClientRect();
    const r = m.parts.head.getBoundingClientRect();
    tip.replaceChildren(h('b', {}, m.place.name), describe(m.place));
    tip.style.left = (r.left + r.width / 2 - card.left) + 'px';
    tip.style.top = (r.top - card.top) + 'px';
    tip.hidden = false;
  }
  function hideTip() { $('tooltip').hidden = true; }

  function select(id, fromMap = false) {
    S.selected = id;
    S.markers.forEach((m, mid) => {
      m.g.classList.toggle('is-selected', mid === id);
      if (mid === id) {
        m.parts.pulse.classList.remove('ring-pulse'); void m.parts.pulse.getBBox(); m.parts.pulse.classList.add('ring-pulse');
        m.parts.pulse.style.animation = 'none'; void m.parts.pulse.getBBox(); m.parts.pulse.style.animation = '';
      }
    });
    document.querySelectorAll('.rank').forEach((b) => b.classList.toggle('is-selected', b.dataset.id === id));
    setTab('details');
    renderDetails();
    if (!fromMap && window.innerWidth < 960) $('map').scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' });
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
      if (o.people) parts.push(`${o.people} people`);
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
    $('facts').replaceChildren(...facts.map(([v, l]) => h('div', { class: 'fact' }, h('span', { class: 'fact-value' }, v), h('span', { class: 'fact-label' }, l))));
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
    const st = stateFor(p.place_id);
    let data;
    if (p.layer === 'vending') data = { working: st.working || '', items: itemsFor(p.place_id).map((i) => ({ ...i, price_usd: i.price })) };
    else if (p.layer === 'water') data = { working: st.working || '', cold: num(st.cold), counter: num(st.counter), filter_light: st.filter_light || '' };
    else if (p.layer === 'microwave') data = { units: num(st.units), units_working: num(st.units_working), extras: /utensil|napkin/i.test((p.note || '') + ' ' + (st.note || '')) ? ['utensils', 'napkins'] : [] };
    else data = { units: num(st.units), units_working: num(st.units_working), broken_note: st.note || '' };
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
      renderFacts();
      setTab('quiet');
      S.firstPaint = false;
      refreshAll(false);
    } catch (e) { fail(e); }
  }
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', boot) : boot();
})();
