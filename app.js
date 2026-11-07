(() => {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const LATEST = '__latest__';
  const LAYER_ORDER = ['study', 'water', 'vending', 'microwave', 'printer'];
  const LAYER_META = {
    study: { label: 'Study places', singular: 'Study place' },
    water: { label: 'Water fillers', singular: 'Water filler' },
    vending: { label: 'Vending', singular: 'Vending machine' },
    microwave: { label: 'Microwaves', singular: 'Microwave' },
    printer: { label: 'Printers', singular: 'Printer' }
  };
  const LAYER_COLORS = {
    water: 'var(--water)',
    vending: 'var(--vending)',
    microwave: 'var(--microwave)',
    printer: 'var(--printer)'
  };
  const LAYER_LETTERS = {
    water: 'W',
    vending: 'V',
    microwave: 'M',
    printer: 'P'
  };
  const BANDS = [
    { key: 'quiet', label: 'Quiet', variable: '--quiet', max: 50 },
    { key: 'moderate', label: 'Moderate', variable: '--moderate', max: 60 },
    { key: 'loud', label: 'Loud', variable: '--loud', max: 70 },
    { key: 'vloud', label: 'Very loud', variable: '--vloud', max: Infinity }
  ];
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const state = {
    places: [],
    noise: [],
    observations: [],
    rounds: [],
    activeRound: LATEST,
    visibleLayers: new Set(LAYER_ORDER),
    glow: true,
    scale: 1,
    pxPerUnit: 1,
    selectedPlaceId: null,
    activeTab: 'quiet',
    svg: null,
    markersGroup: null,
    resizeObserver: null
  };

  const dom = {};

  function init() {
    cacheDom();
    bindStaticEvents();
    setTab('quiet');
    loadData().catch(showServerMessage);
  }

  function cacheDom() {
    dom.map = document.getElementById('map');
    dom.mapFrame = document.querySelector('.map-frame');
    dom.tooltip = document.getElementById('marker-tooltip');
    dom.quietList = document.getElementById('quiet-list');
    dom.detailsContent = document.getElementById('details-content');
    dom.roundControl = document.getElementById('round-control');
    dom.glowToggle = document.getElementById('glow-toggle');
    dom.tabQuiet = document.getElementById('tab-quiet');
    dom.tabDetails = document.getElementById('tab-details');
    dom.panelQuiet = document.getElementById('panel-quiet');
    dom.panelDetails = document.getElementById('panel-details');
    dom.layerButtons = Array.from(document.querySelectorAll('[data-layer]'));
    dom.countElements = Array.from(document.querySelectorAll('[data-count-for]'));
  }

  function bindStaticEvents() {
    dom.layerButtons.forEach((button) => {
      button.addEventListener('click', () => toggleLayer(button.dataset.layer));
    });

    dom.glowToggle.addEventListener('click', () => {
      state.glow = !state.glow;
      dom.glowToggle.setAttribute('aria-pressed', String(state.glow));
      renderMarkers();
    });

    dom.tabQuiet.addEventListener('click', () => setTab('quiet'));
    dom.tabDetails.addEventListener('click', () => setTab('details'));
    [dom.tabQuiet, dom.tabDetails].forEach((tab) => {
      tab.addEventListener('keydown', handleTabKeydown);
    });
  }

  async function loadData() {
    if (!window.Papa || typeof window.Papa.parse !== 'function') {
      throw new Error('PapaParse did not load.');
    }

    const [svgText, placesText, noiseText, observationsText] = await Promise.all([
      fetchText('assets/msc-floor1.svg'),
      fetchText('data/places.csv'),
      fetchText('data/noise.csv'),
      fetchText('data/observations.csv')
    ]);

    state.places = parsePlaces(placesText);
    if (!state.places.length) {
      throw new Error('places.csv did not contain any usable places.');
    }

    const knownPlaceIds = new Set(state.places.map((place) => place.place_id));
    state.noise = parseNoise(noiseText, knownPlaceIds);
    state.observations = parseObservations(observationsText, knownPlaceIds);
    state.rounds = collectRounds();
    state.selectedPlaceId = null;

    installMap(svgText);
    measureScale();
    updateCounts();
    renderRoundControl();
    updateLayerButtons();
    setTab('quiet');
    renderMarkers();
    renderQuietList();
    renderDetails();
    setupResizeObserver();
  }

  async function fetchText(url) {
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) {
      throw new Error(`Could not load ${url} (HTTP ${response.status}).`);
    }
    return response.text();
  }

  function showServerMessage(error) {
    if (error) {
      console.warn('MSC Field Map could not load its data:', error.message || error);
    }
    if (state.resizeObserver) {
      state.resizeObserver.disconnect();
      state.resizeObserver = null;
    }
    hideTooltip();
    if (!dom.map) return;

    const wrapper = el('div', { className: 'map-error', attrs: { role: 'alert' } });
    wrapper.append(el('h2', { text: 'Couldn’t load the map' }));

    const message = el('p');
    message.append(
      document.createTextNode('Open this app through a web server: run '),
      el('code', { text: 'python -m http.server' }),
      document.createTextNode(' in the repo folder and visit '),
      el('a', {
        attrs: {
          href: 'http://localhost:8000',
          target: '_blank',
          rel: 'noopener noreferrer'
        },
        text: 'http://localhost:8000'
      }),
      document.createTextNode('.')
    );
    wrapper.append(message);
    dom.map.replaceChildren(wrapper);

    if (dom.quietList) {
      dom.quietList.replaceChildren(emptyListItem('Measurements are unavailable until the data files load.'));
    }
    if (dom.detailsContent) {
      dom.detailsContent.replaceChildren(el('p', {
        className: 'empty-state',
        text: 'Measurements are unavailable until the data files load.'
      }));
    }
  }

  function el(tag, options = {}, ...children) {
    const node = document.createElement(tag);
    if (options.className) node.className = options.className;
    if (options.text !== undefined) node.textContent = String(options.text);
    if (options.attrs) {
      Object.entries(options.attrs).forEach(([name, value]) => {
        if (value !== undefined && value !== null) {
          node.setAttribute(name, String(value));
        }
      });
    }
    children.forEach((child) => {
      if (child !== undefined && child !== null) node.append(child);
    });
    return node;
  }

  function svgEl(tag, attributes = {}, text) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attributes).forEach(([name, value]) => {
      if (value !== undefined && value !== null) {
        node.setAttribute(name, String(value));
      }
    });
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  function trim(value) {
    if (value === undefined || value === null) return '';
    return String(value).trim();
  }

  function parseNumber(value) {
    const text = trim(value);
    if (!text) return null;
    const number = parseFloat(text);
    return Number.isFinite(number) ? number : null;
  }

  function stripBom(text) {
    return String(text).replace(/^\uFEFF/, '');
  }

  function parseCsv(text) {
    const result = window.Papa.parse(stripBom(text), {
      header: true,
      skipEmptyLines: true
    });
    return Array.isArray(result.data) ? result.data : [];
  }

  function parsePlaces(text) {
    const places = [];
    parseCsv(text).forEach((row, index) => {
      const placeId = trim(row.place_id);
      const layer = trim(row.layer);
      const name = trim(row.name);
      const x = parseNumber(row.x);
      const y = parseNumber(row.y);

      if (!placeId) {
        console.warn(`places.csv row ${index + 2} has no place_id; ignoring.`);
        return;
      }
      if (!LAYER_META[layer]) {
        console.warn(`places.csv row ${index + 2} has unknown layer "${layer}"; ignoring.`);
        return;
      }
      if (x === null || y === null) {
        console.warn(`places.csv row ${index + 2} has invalid x/y; ignoring.`);
        return;
      }

      places.push({
        place_id: placeId,
        layer,
        name: name || placeId,
        area: trim(row.area),
        x,
        y,
        location_note: trim(row.location_note),
        seats_total: parseNumber(row.seats_total),
        outlets: parseNumber(row.outlets),
        note: trim(row.note)
      });
    });
    return places;
  }

  function parseNoise(text, knownPlaceIds) {
    const rows = [];
    parseCsv(text).forEach((row, index) => {
      const placeId = trim(row.place_id);
      if (!knownPlaceIds.has(placeId)) {
        console.warn(`noise.csv row ${index + 2} has unknown place_id "${placeId}"; ignoring.`);
        return;
      }
      const ts = trim(row.ts);
      rows.push({
        obs_id: trim(row.obs_id),
        place_id: placeId,
        round: trim(row.round),
        ts,
        tsMs: parseLocalTimestamp(ts),
        duration_s: parseNumber(row.duration_s),
        laeq_db: parseNumber(row.laeq_db),
        lmax_db: parseNumber(row.lmax_db),
        lcpeak_db: parseNumber(row.lcpeak_db),
        device: trim(row.device),
        app: trim(row.app),
        source_file: trim(row.source_file),
        note: trim(row.note),
        rowIndex: index
      });
    });
    return rows;
  }

  function parseObservations(text, knownPlaceIds) {
    const rows = [];
    parseCsv(text).forEach((row, index) => {
      const placeId = trim(row.place_id);
      if (!knownPlaceIds.has(placeId)) {
        console.warn(`observations.csv row ${index + 2} has unknown place_id "${placeId}"; ignoring.`);
        return;
      }
      const ts = trim(row.ts);
      rows.push({
        obs_id: trim(row.obs_id),
        place_id: placeId,
        round: trim(row.round),
        ts,
        tsMs: parseLocalTimestamp(ts),
        people: parseNumber(row.people),
        seats_taken: parseNumber(row.seats_taken),
        working: trim(row.working),
        cold: parseNumber(row.cold),
        counter: parseNumber(row.counter),
        units: parseNumber(row.units),
        units_working: parseNumber(row.units_working),
        clean: parseNumber(row.clean),
        waiting: parseNumber(row.waiting),
        photo: trim(row.photo),
        note: trim(row.note),
        rowIndex: index
      });
    });
    return rows;
  }

  function parseLocalTimestamp(value) {
    const text = trim(value);
    if (!text) return NaN;
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!match) {
      const fallback = new Date(text);
      return Number.isNaN(fallback.getTime()) ? NaN : fallback.getTime();
    }
    const date = new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6] || 0)
    );
    return date.getTime();
  }

  function collectRounds() {
    const rounds = new Set();
    state.noise.forEach((row) => {
      if (row.round) rounds.add(row.round);
    });
    state.observations.forEach((row) => {
      if (row.round) rounds.add(row.round);
    });
    return Array.from(rounds).sort(compareRounds);
  }

  function compareRounds(a, b) {
    return String(a).localeCompare(String(b), undefined, {
      numeric: true,
      sensitivity: 'base'
    });
  }

  function installMap(svgText) {
    const parser = new DOMParser();
    const parsed = parser.parseFromString(svgText, 'image/svg+xml');
    if (parsed.querySelector('parsererror')) {
      throw new Error('The floor-plan SVG could not be parsed.');
    }
    const source = parsed.documentElement;
    if (!source || source.tagName.toLowerCase() !== 'svg') {
      throw new Error('The floor-plan asset was not an SVG.');
    }

    const svg = document.importNode(source, true);
    svg.setAttribute('role', 'group');
    svg.setAttribute('aria-label', 'Schematic plan of the MSC 1st floor');

    const defs = createGlowDefs();
    svg.appendChild(defs);

    const markersGroup = svgEl('g', { id: 'markers' });
    svg.appendChild(markersGroup);

    dom.map.replaceChildren(svg);
    state.svg = svg;
    state.markersGroup = markersGroup;
  }

  function createGlowDefs() {
    const defs = svgEl('defs');
    BANDS.forEach((band) => {
      const gradient = svgEl('radialGradient', { id: `noise-glow-${band.key}` });
      const center = svgEl('stop', {
        offset: '0%',
        'stop-color': readCssVariable(band.variable),
        'stop-opacity': '0.45'
      });
      const edge = svgEl('stop', {
        offset: '100%',
        'stop-color': readCssVariable(band.variable),
        'stop-opacity': '0'
      });
      gradient.append(center, edge);
      defs.append(gradient);
    });
    return defs;
  }

  function readCssVariable(name) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || '#9aa5a0';
  }

  function updateCounts() {
    const counts = Object.fromEntries(LAYER_ORDER.map((layer) => [layer, 0]));
    state.places.forEach((place) => {
      counts[place.layer] += 1;
    });
    dom.countElements.forEach((node) => {
      const layer = node.dataset.countFor;
      node.textContent = String(counts[layer] || 0);
    });
  }

  function renderRoundControl() {
    dom.roundControl.replaceChildren(
      makeRoundButton(LATEST, 'Latest'),
      ...state.rounds.map((round) => makeRoundButton(round, round))
    );
    updateRoundButtons();
  }

  function makeRoundButton(value, label) {
    const button = el('button', {
      className: 'round-button',
      text: label,
      attrs: {
        type: 'button',
        'aria-pressed': String(state.activeRound === value)
      }
    });
    button.addEventListener('click', () => {
      if (state.activeRound === value) return;
      state.activeRound = value;
      updateRoundButtons();
      renderMarkers();
      renderQuietList();
      renderDetails();
    });
    return button;
  }

  function updateRoundButtons() {
    dom.roundControl.querySelectorAll('.round-button').forEach((button, index) => {
      const value = index === 0 ? LATEST : state.rounds[index - 1];
      button.setAttribute('aria-pressed', String(state.activeRound === value));
    });
  }

  function updateLayerButtons() {
    dom.layerButtons.forEach((button) => {
      const layer = button.dataset.layer;
      const visible = state.visibleLayers.has(layer);
      button.setAttribute('aria-pressed', String(visible));
      button.title = `${visible ? 'Hide' : 'Show'} ${LAYER_META[layer].label.toLowerCase()}`;
    });
    dom.glowToggle.setAttribute('aria-pressed', String(state.glow));
    dom.glowToggle.title = `${state.glow ? 'Hide' : 'Show'} the study-place noise glow`;
  }

  function toggleLayer(layer) {
    if (!LAYER_META[layer]) return;
    if (state.visibleLayers.has(layer)) {
      state.visibleLayers.delete(layer);
    } else {
      state.visibleLayers.add(layer);
    }
    updateLayerButtons();
    renderMarkers();
    renderQuietList();
  }

  function currentNoiseFor(placeId) {
    const records = state.noise.filter((row) => row.place_id === placeId);
    if (state.activeRound === LATEST) return latestByTimestamp(records);
    return latestByTimestamp(records.filter((row) => row.round === state.activeRound));
  }

  function currentObservationFor(placeId) {
    const records = state.observations.filter((row) => row.place_id === placeId);
    if (state.activeRound === LATEST) return latestByTimestamp(records);
    return latestByTimestamp(records.filter((row) => row.round === state.activeRound));
  }

  function latestByTimestamp(records) {
    if (!records.length) return null;
    let latest = records[0];
    for (let index = 1; index < records.length; index += 1) {
      const candidate = records[index];
      const latestTime = Number.isFinite(latest.tsMs) ? latest.tsMs : -Infinity;
      const candidateTime = Number.isFinite(candidate.tsMs) ? candidate.tsMs : -Infinity;
      if (candidateTime > latestTime ||
          (candidateTime === latestTime && candidate.rowIndex > latest.rowIndex)) {
        latest = candidate;
      }
    }
    return latest;
  }

  function bandFor(laeq) {
    if (!Number.isFinite(laeq)) return null;
    return BANDS.find((band) => laeq < band.max) || BANDS[BANDS.length - 1];
  }

  function renderMarkers() {
    if (!state.markersGroup) return;
    hideTooltip();
    state.markersGroup.replaceChildren();

    const scale = state.scale;
    const glowGroup = svgEl('g', { class: 'noise-glows', 'aria-hidden': 'true' });

    if (state.glow && state.visibleLayers.has('study')) {
      state.places
        .filter((place) => place.layer === 'study')
        .forEach((place) => {
          const noise = currentNoiseFor(place.place_id);
          if (!noise || !Number.isFinite(noise.laeq_db)) return;
          const band = bandFor(noise.laeq_db);
          if (!band) return;
          glowGroup.append(svgEl('circle', {
            class: 'noise-glow',
            cx: place.x,
            cy: place.y,
            r: 70 * scale,
            fill: `url(#noise-glow-${band.key})`
          }));
        });
    }

    if (glowGroup.childNodes.length) {
      state.markersGroup.append(glowGroup);
    }

    const markerLayer = svgEl('g', { class: 'marker-layer' });
    state.places.forEach((place) => {
      if (!state.visibleLayers.has(place.layer)) return;
      markerLayer.append(createMarker(place, scale));
    });
    state.markersGroup.append(markerLayer);
    applySelectionToMarkers();
  }

  function createMarker(place, scale) {
    const noise = currentNoiseFor(place.place_id);
    const observation = currentObservationFor(place.place_id);
    const description = describePlace(place, noise, observation);
    const selected = state.selectedPlaceId === place.place_id;
    const group = svgEl('g', {
      class: `marker marker--${place.layer}${selected ? ' is-selected' : ''}`,
      transform: `translate(${place.x} ${place.y})`,
      tabindex: '0',
      role: 'button',
      'aria-label': `${place.name}. ${description}`
    });
    group.setAttribute('data-place-id', place.place_id);

    if (place.layer === 'study') {
      buildStudyMarker(group, noise, scale);
    } else {
      buildAmenityMarker(group, place, observation, scale);
    }

    group.addEventListener('mouseenter', () => showTooltip(group, place.name, description));
    group.addEventListener('mouseleave', hideTooltip);
    group.addEventListener('focus', () => showTooltip(group, place.name, description));
    group.addEventListener('blur', hideTooltip);
    group.addEventListener('click', (event) => {
      event.stopPropagation();
      selectPlace(place.place_id);
    });
    group.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault();
        selectPlace(place.place_id);
      }
    });
    return group;
  }

  function buildStudyMarker(group, noise, scale) {
    const laeq = noise && Number.isFinite(noise.laeq_db) ? noise.laeq_db : null;
    const band = bandFor(laeq);
    const fill = band ? `var(${band.variable})` : 'var(--unmeasured)';

    const body = svgEl('circle', {
      class: 'marker-body',
      r: 16 * scale,
      'stroke-width': 3 * scale
    });
    body.style.fill = fill;

    group.append(
      svgEl('circle', {
        class: 'focus-ring',
        r: 31 * scale,
        'stroke-width': 2 * scale
      }),
      svgEl('circle', {
        class: 'selection-ring',
        r: 24 * scale,
        'stroke-width': 6 * scale
      }),
      body,
      svgEl('text', {
        class: 'marker-db',
        x: 0,
        y: -26 * scale,
        'font-size': 22 * scale,
        'aria-hidden': 'true'
      }, laeq === null ? '—' : String(Math.round(laeq)))
    );
  }

  function buildAmenityMarker(group, place, observation, scale) {
    const boxSize = 26 * scale;
    const bodyRadius = place.layer === 'water' ? 6 * scale : 2 * scale;
    const ringSize = 40 * scale;

    const body = svgEl('rect', {
      class: 'marker-body',
      x: -boxSize / 2,
      y: -boxSize / 2,
      width: boxSize,
      height: boxSize,
      rx: bodyRadius,
      'stroke-width': 2.5 * scale
    });
    body.style.fill = LAYER_COLORS[place.layer];

    group.append(
      svgEl('rect', {
        class: 'focus-ring',
        x: -22 * scale,
        y: -22 * scale,
        width: 44 * scale,
        height: 44 * scale,
        rx: 9 * scale,
        'stroke-width': 2 * scale
      }),
      svgEl('rect', {
        class: 'selection-ring',
        x: -20 * scale,
        y: -20 * scale,
        width: ringSize,
        height: ringSize,
        rx: 7 * scale,
        'stroke-width': 6 * scale
      }),
      body
    );

    const glyph = svgEl('text', {
      class: 'marker-glyph',
      x: 0,
      y: 0,
      'aria-hidden': 'true'
    }, LAYER_LETTERS[place.layer]);
    glyph.style.fontSize = `${14 * scale}px`;
    group.append(glyph);

    if (observation && isNotWorking(observation)) {
      group.append(svgEl('line', {
        class: 'marker-slash',
        x1: -10 * scale,
        y1: 10 * scale,
        x2: 10 * scale,
        y2: -10 * scale,
        'stroke-width': 3 * scale
      }));
    }
  }

  function applySelectionToMarkers() {
    if (!state.markersGroup) return;
    state.markersGroup.querySelectorAll('.marker').forEach((marker) => {
      const selected = marker.getAttribute('data-place-id') === state.selectedPlaceId;
      marker.classList.toggle('is-selected', selected);
    });
  }

  function selectPlace(placeId) {
    if (!state.places.some((place) => place.place_id === placeId)) return;
    state.selectedPlaceId = placeId;
    setTab('details');
    applySelectionToMarkers();
    renderQuietList();
    renderDetails();
  }

  function describePlace(place, noise, observation) {
    const parts = [];

    if (place.layer === 'study') {
      if (noise && Number.isFinite(noise.laeq_db)) {
        const band = bandFor(noise.laeq_db);
        parts.push(`${formatDb(noise.laeq_db)}${band ? ` · ${band.label}` : ''}`);
      } else {
        parts.push('Noise not measured');
      }
      if (observation && Number.isFinite(observation.people)) {
        parts.push(personText(observation.people));
      }
    } else if (place.layer === 'water') {
      if (observation) {
        const working = workingWord(observation.working);
        if (working) parts.push(working);
        if (Number.isFinite(observation.cold)) parts.push(`Cold ${formatLoose(observation.cold)}`);
        if (Number.isFinite(observation.counter)) parts.push(`Counter ${formatLoose(observation.counter)}`);
      }
    } else if (place.layer === 'vending') {
      if (observation) {
        const working = workingWord(observation.working);
        if (working) parts.push(working);
      }
    } else if (place.layer === 'microwave') {
      if (observation) {
        const working = workingWord(observation.working);
        if (working) parts.push(working);
        if (Number.isFinite(observation.units)) parts.push(`${formatLoose(observation.units)} units`);
        if (Number.isFinite(observation.units_working)) {
          parts.push(`${formatLoose(observation.units_working)} working`);
        }
        if (Number.isFinite(observation.clean)) parts.push(`Clean ${formatLoose(observation.clean)}`);
        if (Number.isFinite(observation.waiting)) parts.push(`${formatLoose(observation.waiting)} waiting`);
      }
    } else if (place.layer === 'printer') {
      parts.push('Printer location');
    }

    return parts.length ? parts.join(' · ') : 'Not measured';
  }

  function workingWord(value) {
    const working = trim(value).toLowerCase();
    if (working === 'y' || working === 'yes') return 'Working';
    if (working === 'n' || working === 'no') return 'Not working';
    return working ? trim(value) : '';
  }

  function isNotWorking(observation) {
    const working = trim(observation.working).toLowerCase();
    return working === 'n' || working === 'no';
  }

  function personText(count) {
    return count === 1 ? '1 person' : `${formatLoose(count)} people`;
  }

  function renderQuietList() {
    const list = dom.quietList;
    list.replaceChildren();

    if (!state.visibleLayers.has('study')) {
      list.append(emptyListItem('Study places are hidden. Turn the Study places layer back on to see the ranking.'));
      return;
    }

    const rows = state.places
      .filter((place) => place.layer === 'study')
      .map((place) => {
        const noise = currentNoiseFor(place.place_id);
        const observation = currentObservationFor(place.place_id);
        return {
          place,
          laeq: noise && Number.isFinite(noise.laeq_db) ? noise.laeq_db : null,
          people: observation && Number.isFinite(observation.people) ? observation.people : null
        };
      })
      .sort((a, b) => {
        if (a.laeq === null && b.laeq === null) {
          return a.place.name.localeCompare(b.place.name);
        }
        if (a.laeq === null) return 1;
        if (b.laeq === null) return -1;
        if (a.laeq !== b.laeq) return a.laeq - b.laeq;
        return a.place.name.localeCompare(b.place.name);
      });

    if (!rows.length) {
      list.append(emptyListItem('No study places are in this dataset.'));
      return;
    }

    rows.forEach((row) => {
      const selected = state.selectedPlaceId === row.place.place_id;
      const band = bandFor(row.laeq);
      const button = el('button', {
        className: `quiet-row${selected ? ' is-selected' : ''}`,
        attrs: { type: 'button' }
      });

      const value = el('span', {
        className: `quiet-value${row.laeq === null ? ' is-empty' : ''}`,
        text: row.laeq === null ? 'not measured' : formatDb(row.laeq)
      });
      const name = el('span', { className: 'quiet-name', text: row.place.name });
      button.append(name, value);

      const bottom = el('span', { className: 'quiet-row-bottom' });
      const chip = el('span', {
        className: `band-chip ${band ? `band-${band.key}` : 'band-unmeasured'}`,
        text: band ? band.label : 'Not measured'
      });
      bottom.append(chip);
      if (row.people !== null) {
        bottom.append(el('span', { className: 'quiet-people', text: personText(row.people) }));
      }
      button.append(bottom);

      button.addEventListener('click', () => selectPlace(row.place.place_id));
      list.append(el('li', {}, button));
    });
  }

  function emptyListItem(message) {
    return el('li', { className: 'empty-item' }, el('p', {
      className: 'empty-state',
      text: message
    }));
  }

  function renderDetails() {
    const container = dom.detailsContent;
    container.replaceChildren();

    const place = state.places.find((item) => item.place_id === state.selectedPlaceId);
    if (!place) {
      container.append(el('p', {
        className: 'empty-state',
        text: 'Select a place on the map or in Quiet spots.'
      }));
      return;
    }

    const meta = LAYER_META[place.layer];
    const noises = state.noise.filter((row) => row.place_id === place.place_id);
    const observations = state.observations.filter((row) => row.place_id === place.place_id);

    const head = el('div', { className: 'details-head' });
    head.append(
      el('span', {
        className: `layer-tag layer-${place.layer}`,
        text: meta.singular
      }),
      el('h2', { text: place.name }),
      el('p', {
        className: 'details-sub',
        text: place.area ? `Area ${place.area}` : 'Area not recorded'
      })
    );
    container.append(head);

    const facts = el('dl', { className: 'fact-grid' });
    appendFact(facts, 'Layer', meta.label);
    appendFact(facts, 'Area', place.area ? `Area ${place.area}` : '—');
    if (place.seats_total !== null) {
      appendFact(facts, 'Seats', formatLoose(place.seats_total));
    }
    if (place.outlets !== null) {
      appendFact(facts, 'Outlets', formatLoose(place.outlets));
    }
    container.append(facts);

    const location = el('div', { className: 'detail-note' });
    location.append(
      el('span', { className: 'detail-label', text: 'Location' }),
      el('p', { text: place.location_note || '—' })
    );
    container.append(location);

    const note = el('div', { className: 'detail-note' });
    note.append(
      el('span', { className: 'detail-label', text: 'Note' }),
      el('p', { text: place.note || '—' })
    );
    container.append(note);

    if (place.layer === 'water') {
      const summary = buildCounterSummary(observations);
      if (summary) container.append(summary);
    }

    const measurements = el('section', { className: 'measurements' });
    measurements.append(el('h3', { text: 'Measurements' }));
    const rows = buildMeasurementRows(place, noises, observations);
    if (!rows.length) {
      measurements.append(el('p', {
        className: 'table-empty',
        text: 'Not measured yet. This place is on our collection route.'
      }));
    } else {
      measurements.append(buildMeasurementTable(place, rows));
    }
    container.append(measurements);
  }

  function appendFact(container, label, value) {
    const fact = el('div', { className: 'fact' });
    fact.append(
      el('dt', { text: label }),
      el('dd', { text: value })
    );
    container.append(fact);
  }

  function buildCounterSummary(observations) {
    const readings = observations
      .filter((row) => Number.isFinite(row.counter))
      .slice()
      .sort((a, b) => {
        const aTime = Number.isFinite(a.tsMs) ? a.tsMs : 0;
        const bTime = Number.isFinite(b.tsMs) ? b.tsMs : 0;
        return aTime - bTime || a.rowIndex - b.rowIndex;
      });

    if (readings.length < 2) return null;

    let filled = 0;
    for (let index = 1; index < readings.length; index += 1) {
      const difference = readings[index].counter - readings[index - 1].counter;
      if (difference > 0) filled += difference;
    }

    const first = readings[0];
    const last = readings[readings.length - 1];
    const hours = (last.tsMs - first.tsMs) / 3600000;
    const perHour = Number.isFinite(hours) && hours > 0 ? filled / hours : null;

    const summary = el('p', { className: 'counter-summary' });
    summary.append(
      el('strong', { text: 'Bottles filled between readings: ' }),
      document.createTextNode(
        `${formatLoose(filled)} (≈ ${perHour === null ? '—' : perHour.toFixed(1)} per hour)`
      )
    );
    return summary;
  }

  function buildMeasurementRows(place, noises, observations) {
    const rounds = new Set();
    noises.forEach((row) => {
      if (row.round) rounds.add(row.round);
    });
    observations.forEach((row) => {
      if (row.round) rounds.add(row.round);
    });

    return Array.from(rounds)
      .sort(compareRounds)
      .map((round) => {
        const noise = latestByTimestamp(noises.filter((row) => row.round === round));
        const observation = latestByTimestamp(observations.filter((row) => row.round === round));
        if (!noise && !observation) return null;
        return { round, noise, observation };
      })
      .filter(Boolean);
  }

  function measurementColumns(layer) {
    if (layer === 'study') {
      return [
        ['round', 'Round'],
        ['time', 'Time'],
        ['laeq', 'LAeq'],
        ['lmax', 'Lmax'],
        ['lcpeak', 'LCpeak'],
        ['duration', 'Duration'],
        ['people', 'People'],
        ['seats', 'Seats taken'],
        ['report', 'Report'],
        ['notes', 'Notes']
      ];
    }
    if (layer === 'water') {
      return [
        ['round', 'Round'],
        ['time', 'Time'],
        ['working', 'Working'],
        ['cold', 'Cold'],
        ['counter', 'Counter'],
        ['photo', 'Photo'],
        ['notes', 'Notes']
      ];
    }
    if (layer === 'vending') {
      return [
        ['round', 'Round'],
        ['time', 'Time'],
        ['working', 'Working'],
        ['photo', 'Photo'],
        ['notes', 'Notes']
      ];
    }
    if (layer === 'microwave') {
      return [
        ['round', 'Round'],
        ['time', 'Time'],
        ['units', 'Units'],
        ['unitsWorking', 'Units working'],
        ['clean', 'Clean'],
        ['waiting', 'Waiting'],
        ['photo', 'Photo'],
        ['notes', 'Notes']
      ];
    }
    return [
      ['round', 'Round'],
      ['time', 'Time'],
      ['photo', 'Photo'],
      ['notes', 'Notes']
    ];
  }

  function buildMeasurementTable(place, rows) {
    const columns = measurementColumns(place.layer);
    const table = el('table', { className: 'measure-table' });
    table.append(el('caption', { text: `Measurements for ${place.name} across rounds` }));

    const headRow = el('tr');
    columns.forEach(([, label]) => headRow.append(el('th', { attrs: { scope: 'col' }, text: label })));
    const thead = el('thead');
    thead.append(headRow);
    table.append(thead);

    const tbody = el('tbody');
    rows.forEach((row) => {
      const tr = el('tr');
      columns.forEach(([key]) => {
        tr.append(buildMeasurementCell(key, row, place));
      });
      tbody.append(tr);
    });
    table.append(tbody);

    const scroll = el('div', { className: 'table-scroll' });
    scroll.append(table);
    return scroll;
  }

  function buildMeasurementCell(key, row, place) {
    const noise = row.noise;
    const observation = row.observation;
    const timeSource = latestTimestampRecord(noise, observation);

    if (key === 'round') {
      return el('td', { className: 'round-cell', text: row.round || '—' });
    }
    if (key === 'time') {
      return el('td', {
        className: 'time-cell',
        text: timeSource ? formatTime(timeSource.ts) : '—'
      });
    }
    if (key === 'laeq') return valueCell(noise && formatDb(noise.laeq_db));
    if (key === 'lmax') return valueCell(noise && formatDb(noise.lmax_db));
    if (key === 'lcpeak') {
      return valueCell(noise && Number.isFinite(noise.lcpeak_db)
        ? `${formatDecimal(noise.lcpeak_db)} dB(C)`
        : null);
    }
    if (key === 'duration') {
      return valueCell(noise && Number.isFinite(noise.duration_s)
        ? `${formatLoose(noise.duration_s)} s`
        : null);
    }
    if (key === 'people') return valueCell(observation && formatCount(observation.people));
    if (key === 'seats') return valueCell(observation && formatCount(observation.seats_taken));
    if (key === 'working') return valueCell(observation && yesNo(observation.working));
    if (key === 'cold') return valueCell(observation && formatCount(observation.cold));
    if (key === 'counter') return valueCell(observation && formatLoose(observation.counter));
    if (key === 'units') return valueCell(observation && formatCount(observation.units));
    if (key === 'unitsWorking') return valueCell(observation && formatCount(observation.units_working));
    if (key === 'clean') return valueCell(observation && formatCount(observation.clean));
    if (key === 'waiting') return valueCell(observation && formatCount(observation.waiting));
    if (key === 'report') return reportCell(noise);
    if (key === 'photo') return photoCell(observation, place, row.round);
    if (key === 'notes') {
      const notes = [noise && noise.note, observation && observation.note].filter(Boolean);
      return el('td', {
        className: notes.length ? 'notes-cell' : 'notes-cell missing',
        text: notes.length ? notes.join('; ') : '—'
      });
    }
    return valueCell(null);
  }

  function latestTimestampRecord(noise, observation) {
    if (noise && observation) {
      const noiseTime = Number.isFinite(noise.tsMs) ? noise.tsMs : -Infinity;
      const observationTime = Number.isFinite(observation.tsMs) ? observation.tsMs : -Infinity;
      return observationTime > noiseTime ? observation : noise;
    }
    return noise || observation;
  }

  function valueCell(value) {
    if (value === null || value === undefined || value === '' || value === '—') {
      return el('td', { className: 'missing', text: '—' });
    }
    return el('td', { text: value });
  }

  function reportCell(noise) {
    const href = noise ? safeResourcePath(noise.source_file) : null;
    if (!href) return el('td', { className: 'missing', text: '—' });
    const link = el('a', {
      attrs: {
        href,
        target: '_blank',
        rel: 'noopener noreferrer'
      },
      text: 'Original report (PDF)'
    });
    const cell = el('td');
    cell.append(link);
    return cell;
  }

  function photoCell(observation, place, round) {
    const href = observation ? safeResourcePath(observation.photo) : null;
    if (!href) return el('td', { className: 'missing', text: '—' });
    const image = el('img', {
      className: 'photo-thumb',
      attrs: {
        src: href,
        alt: `Photo for ${place.name}${round ? `, ${round}` : ''}`,
        loading: 'lazy',
        decoding: 'async'
      }
    });
    const link = el('a', {
      className: 'photo-link',
      attrs: {
        href,
        target: '_blank',
        rel: 'noopener noreferrer',
        'aria-label': `Open full-size photo for ${place.name}${round ? `, ${round}` : ''}`
      }
    }, image);
    const cell = el('td');
    cell.append(link);
    return cell;
  }

  function safeResourcePath(value) {
    const path = trim(value);
    if (!path) return null;
    if (/^(?:javascript|data|vbscript):/i.test(path)) return null;
    if (/^\/\//.test(path)) return null;
    return path;
  }

  function yesNo(value) {
    const text = trim(value).toLowerCase();
    if (text === 'y' || text === 'yes') return 'Yes';
    if (text === 'n' || text === 'no') return 'No';
    return trim(value) || null;
  }

  function formatCount(value) {
    if (!Number.isFinite(value)) return null;
    return formatLoose(value);
  }

  function formatLoose(value) {
    if (!Number.isFinite(value)) return null;
    if (Number.isInteger(value)) return String(value);
    return String(Number(value.toFixed(2)));
  }

  function formatDecimal(value) {
    return Number.isFinite(value) ? value.toFixed(1) : '—';
  }

  function formatDb(value) {
    return Number.isFinite(value) ? `${value.toFixed(1)} dBA` : '—';
  }

  function formatTime(value) {
    const text = trim(value);
    const timestamp = parseLocalTimestamp(text);
    if (!Number.isFinite(timestamp)) return text || '—';
    const date = new Date(timestamp);
    const hours = date.getHours();
    const hour12 = hours % 12 || 12;
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const suffix = hours >= 12 ? 'PM' : 'AM';
    return `${WEEKDAYS[date.getDay()]} ${hour12}:${minutes} ${suffix}`;
  }

  function setTab(tabName) {
    if (tabName !== 'quiet' && tabName !== 'details') return;
    state.activeTab = tabName;
    const quietSelected = tabName === 'quiet';

    dom.tabQuiet.setAttribute('aria-selected', String(quietSelected));
    dom.tabDetails.setAttribute('aria-selected', String(!quietSelected));
    dom.tabQuiet.tabIndex = quietSelected ? 0 : -1;
    dom.tabDetails.tabIndex = quietSelected ? -1 : 0;
    dom.panelQuiet.hidden = !quietSelected;
    dom.panelDetails.hidden = quietSelected;
  }

  function handleTabKeydown(event) {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();

    let next;
    if (event.key === 'Home') {
      next = 'quiet';
    } else if (event.key === 'End') {
      next = 'details';
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      next = state.activeTab === 'quiet' ? 'details' : 'quiet';
    }

    if (!next) return;
    setTab(next);
    (next === 'quiet' ? dom.tabQuiet : dom.tabDetails).focus();
  }

  function showTooltip(marker, name, description) {
    if (!dom.tooltip || !dom.mapFrame) return;
    dom.tooltip.replaceChildren(
      el('strong', { text: name }),
      el('span', { text: description })
    );
    dom.tooltip.hidden = false;

    const frameRect = dom.mapFrame.getBoundingClientRect();
    const markerRect = marker.getBoundingClientRect();
    let x = markerRect.left + markerRect.width / 2 - frameRect.left;
    const y = markerRect.top - frameRect.top;

    dom.tooltip.style.left = `${x}px`;
    dom.tooltip.style.top = `${y}px`;

    const tooltipWidth = dom.tooltip.offsetWidth;
    const padding = 8;
    if (frameRect.width > tooltipWidth + padding * 2) {
      const min = tooltipWidth / 2 + padding;
      const max = frameRect.width - tooltipWidth / 2 - padding;
      x = Math.min(Math.max(x, min), max);
      dom.tooltip.style.left = `${x}px`;
    }
  }

  function hideTooltip() {
    if (!dom.tooltip) return;
    dom.tooltip.hidden = true;
    dom.tooltip.replaceChildren();
  }

  function measureScale() {
    if (!state.svg) return;
    const rect = state.svg.getBoundingClientRect();
    const viewBoxWidth = state.svg.viewBox.baseVal.width || 1;
    const pxPerUnit = rect.width / viewBoxWidth;
    state.pxPerUnit = Number.isFinite(pxPerUnit) && pxPerUnit > 0 ? pxPerUnit : 1;
    state.scale = rect.width > 0 && rect.width < 700 ? 1.6 : 1;
  }

  function setupResizeObserver() {
    if (!state.svg) return;
    const recalculate = () => {
      const previousScale = state.scale;
      measureScale();
      if (state.scale !== previousScale) {
        renderMarkers();
      }
    };

    if (typeof ResizeObserver === 'function') {
      state.resizeObserver = new ResizeObserver(recalculate);
      state.resizeObserver.observe(state.svg);
    } else {
      window.addEventListener('resize', recalculate, { passive: true });
    }
  }

  init();
})();
