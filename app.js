/* MSC Field Map: app logic. Loads our CSVs, draws the 2D floor plan with value pins (plan2d.js),
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
    scene: null, firstPaint: true
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

  // Round buttons show when each round started, e.g. "R1 · Sat 6:03 PM".
  function roundStart(r) {
    const ts = [...S.noise, ...S.obs].filter((x) => x.round === r && x.t).map((x) => x.t).sort((a, b) => a - b);
    return ts[0] || null;
  }
  function renderRounds() {
    const seg = $('round-control');
    const opts = [[LATEST, 'Latest', 'newest reading per place'], ...S.rounds.map((r) => [r, r, roundStart(r) ? fmtTime(roundStart(r)) : ''])];
    seg.replaceChildren(...opts.map(([v, label, sub]) => h('button', {
      type: 'button', 'aria-pressed': String(S.round === v), title: sub,
      onclick: () => { if (S.round === v) return; S.round = v; renderRounds(); refreshAll(true); }
    }, h('b', {}, label), sub && v !== LATEST ? h('small', {}, sub) : '')));
  }

  /* ---------------- map (flat 2D plan with value pins, plan2d.js) ---------------- */
  const tok = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function modelData(p) {
    const st = stateFor(p.place_id);
    if (p.layer === 'vending') return { working: st.working || '', items: itemsFor(p.place_id).map((i) => ({ ...i, price_usd: i.price })) };
    if (p.layer === 'water') return { working: st.working || '', cold: num(st.cold), counter: num(st.counter), filter_light: st.filter_light || '' };
    if (p.layer === 'microwave') return { units: num(st.units), units_working: num(st.units_working), extras: /utensil|napkin/i.test((p.note || '') + ' ' + (st.note || '')) ? ['utensils', 'napkins'] : [] };
    return { units: num(st.units), units_working: num(st.units_working), broken_note: st.note || '' };
  }

  // What the scene shows per place: colour, chip text, sound ripples (by band), model data.
  function markers() {
    const out = {};
    S.places.forEach((p) => {
      if (p.layer === 'study') {
        const n = noiseFor(p.place_id), b = band(n?.laeq);
        out[p.place_id] = {
          color: b ? tok('--' + b.key) : tok('--unmeasured'), measured: !!n,
          label: n ? String(Math.round(n.laeq)) : '–',
          level: n ? Math.max(0, Math.min(1, (n.laeq - 40) / 35)) : 0,
          ripples: b ? { quiet: 1, moderate: 2, loud: 3, vloud: 3 }[b.key] : 0
        };
      } else {
        out[p.place_id] = { color: tok('--' + p.layer), measured: true, model: { kind: p.layer, data: modelData(p) } };
      }
    });
    return out;
  }
  const areaNames = () => Object.fromEntries([...S.areas.entries()]
    .filter(([, name]) => name && !/^\(/.test(name))
    .map(([num, name]) => [num, String(name).split(/ \/ | at /)[0]]));

  async function installMap(svgText) {
    const el = $('map');
    let mod;
    mod = await import('./plan2d.js');
    el.replaceChildren();
    S.scene = mod.createPlan(el, {
      svgText, markers: markers(), areaNames: areaNames(),
      places: S.places.map((p) => ({ id: p.place_id, layer: p.layer, x: Number(p.x), y: Number(p.y) })),
      onPick: (id) => select(id, true),
      onHover: (id) => document.querySelectorAll('.rank').forEach((b) => b.classList.toggle('is-hover', b.dataset.id === id)),
      callout: (id) => { const p = S.byId.get(id); return { title: p.name, sub: describe(p) }; }
    });
    applyVisibility();
    if (S.selected) S.scene.select(S.selected, false);
  }

  function updateMarkers() { if (S.scene) S.scene.update(markers()); }
  function applyVisibility() { if (S.scene) S.scene.setVisible([...S.visible]); }

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
    if (S.scene) S.scene.select(id, !fromMap);
    document.querySelectorAll('.rank').forEach((b) => b.classList.toggle('is-selected', b.dataset.id === id));
    setTab('details');
    renderDetails();
    if (!fromMap && window.innerWidth < 820) $('map').scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
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
        h('button', {
          type: 'button', class: 'rank' + (S.selected === p.place_id ? ' is-selected' : ''), 'data-id': p.place_id, onclick: () => select(p.place_id),
          onmouseenter: () => S.scene && S.scene.hover(p.place_id), onmouseleave: () => S.scene && S.scene.hover(null)
        },
          h('span', { class: 'rank-no' }, n ? rank : '–'),
          h('span', { class: 'rank-text' }, h('span', { class: 'rank-name' }, p.name),
            h('span', { class: 'rank-meta' }, [b ? b.label : 'not measured yet', o && o.people ? `${o.people} ${o.people === '1' ? 'person' : 'people'}` : ''].filter(Boolean).join(' · '))),
          meter(p, n, b),
          h('span', { class: 'rank-db' }, n ? n.laeq.toFixed(1) : '—')));
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

  // Noise meter: 40–75 dBA track, grey line = range over all rounds, dot = shown value.
  function meter(p, n, b) {
    const pos = (v) => `${Math.max(0, Math.min(100, ((v - 40) / 35) * 100)).toFixed(1)}%`;
    const all = S.noise.filter((x) => x.place_id === p.place_id && x.laeq != null).map((x) => x.laeq);
    const kids = [];
    if (all.length > 1) {
      const lo = Math.min(...all), hi = Math.max(...all);
      kids.push(h('i', { class: 'm-range', style: `left:${pos(lo)};width:calc(${pos(hi)} - ${pos(lo)})` }));
    }
    if (n) kids.push(h('i', { class: 'm-dot', style: `left:${pos(n.laeq)};--c:var(--${b.key})` }));
    return h('span', { class: 'meter', 'aria-hidden': 'true' }, ...kids);
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
      const series = S.noise.filter((x) => x.place_id === p.place_id && x.laeq != null).sort((a, b) => (a.t || 0) - (b.t || 0));
      if (series.length) {
        const pos = (v) => `${Math.max(0, Math.min(100, ((v - 40) / 35) * 100)).toFixed(1)}%`;
        kids.push(h('h3', { class: 'section-title' }, 'Noise by round'),
          h('div', { class: 'by-round' }, series.map((x) => {
            const xb = band(x.laeq);
            return h('div', { class: 'br-row' }, h('span', { class: 'br-round' }, x.round, h('small', {}, fmtTime(x.t))),
              h('span', { class: 'meter' }, h('i', { class: 'm-dot', style: `left:${pos(x.laeq)};--c:var(--${xb.key})` })),
              h('span', { class: 'rank-db' }, x.laeq.toFixed(1)));
          }), h('div', { class: 'br-axis' }, h('span', {}), h('span', { class: 'ticks' }, ...[40, 50, 60, 70].map((v) => h('i', { style: `left:${pos(v)}` }, v))), h('span', {}, 'dBA'))));
      }
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
    const counters = S.obs.filter((o) => num(o.counter) != null);
    const facts = [
      [S.places.length, 'places mapped'],
      [measured.length, 'noise readings'],
      [counters.length, 'filler counter reads'],
      [S.rounds.length, 'collection rounds']
    ];
    // Biggest change between the first and last reading of one place.
    let swing = null;
    new Set(measured.map((n) => n.place_id)).forEach((id) => {
      const rows = measured.filter((n) => n.place_id === id && n.t).sort((a, b) => a.t - b.t);
      if (rows.length < 2) return;
      const a = rows[0], b = rows[rows.length - 1];
      if (!swing || Math.abs(b.laeq - a.laeq) > Math.abs(swing.b.laeq - swing.a.laeq)) swing = { id, a, b };
    });
    const nm = (id) => h('b', {}, S.byId.get(id).name);
    const story = quiet && loud
      ? h('p', { class: 'fact-story' }, 'Our readings run from ', h('b', {}, quiet.laeq.toFixed(1) + ' dBA'), ' (', nm(quiet.place_id), `, ${quiet.round}) to `,
        h('b', {}, loud.laeq.toFixed(1) + ' dBA'), ' (', nm(loud.place_id), `, ${loud.round}). Every +10 dB sounds about twice as loud.`,
        swing ? ` Biggest change: ${S.byId.get(swing.id).name} went from ${swing.a.laeq.toFixed(1)} to ${swing.b.laeq.toFixed(1)} dBA between ${swing.a.round} and ${swing.b.round}.` : '')
      : null;
    if ($('facts')) $('facts').replaceChildren(
      h('div', { class: 'fact-row' }, ...facts.map(([v, l]) => h('div', { class: 'fact' }, h('span', { class: 'fact-value' }, v), h('span', { class: 'fact-label' }, l)))),
      story);
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
      await installMap(svgText);
      renderFacts();
      bindGlobalSearch();
      setTab('quiet');
      S.firstPaint = false;
      refreshAll(false);
    } catch (e) { fail(e); }
  }
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', boot) : boot();
})();
