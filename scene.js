/* scene.js: the MSC 1st floor as a clean white 3D model (Three.js), like an architect's massing model.
 * Look: matte white blocks with hairline edges, image-based studio light (RoomEnvironment), soft shadows and
 * ambient occlusion (GTAOPass); colour only for data. People we counted stand as abstract white figures.
 *
 * createScene(container, { svgText, places, markers, view, onHover, onPick }) ->
 *   { update(markers), setVisible(layers), select(id, fly), setView(mode), dispose() }
 * places:  [{ id, layer, x, y }] in plan pixels (sign-photo frame, same as assets/msc-floor1.svg)
 * markers: { [id]: { color, label, people, ripples, model: { kind, data } } } */
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildModel } from './model3d.js';

const K = 0.05;                 // world units per plan pixel (floor ≈ 100 units wide)
const TILE_H = 0.1, BLOCK_H = 2.2, SERVICE_H = 1.4, BEVEL = 0.04;
const MODEL_SCALE = 1.35;       // amenity models: one uniform scale, so sizes stay comparable
const STUDY_AREAS = [5, 8, 9, 15, 16], SHOP_AREAS = [13, 14, 17, 18, 19];
const THEMES = {
  light: { floor: 0xffffff, open: 0xf6f6f4, study: 0xedf5ef, shop: 0xf8f2ec, service: 0xf1f1ef, other: 0xfbfbfa, tile: 0xf7f7f5,
    edge: 0xc9c9c4, figure: 0xdcdcd7, shadow: 0.22 },
  dark: { floor: 0x2a2a2e, open: 0x26262a, study: 0x27302b, shop: 0x302c29, service: 0x2c2c30, other: 0x37373c, tile: 0x2c2c30,
    edge: 0x45454c, figure: 0x8a8a92, shadow: 0.45 }
};
const ACCENT = 0x500000;

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const outBack = (t) => { const c1 = 0.9, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const outCubic = (t) => 1 - Math.pow(1 - t, 3);
const hash = (s) => { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
const rnd = (seed) => () => ((seed = Math.imul(seed ^ (seed >>> 15), 2246822507) ^ Math.imul(seed ^ (seed >>> 13), 3266489909)) >>> 0) / 4294967296;

/* ---------- plan parsing ---------- */
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
function inside([x, y], ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function readPlan(svgText) {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const outline = doc.querySelector('.plan-outline');
  const floor = outline ? parseRings(outline.getAttribute('d')) : [];
  const rooms = [];
  doc.querySelectorAll('path.room').forEach((el) => {
    const area = Number(el.getAttribute('data-area')) || 0;
    const cls = el.getAttribute('class') || '';
    const group = cls.includes('open') ? 'open' : cls.includes('service') ? 'service' : STUDY_AREAS.includes(area) ? 'study' : SHOP_AREAS.includes(area) ? 'shop' : 'other';
    parseRings(el.getAttribute('d')).forEach((ring) => rooms.push({ ring, area, group }));
  });
  const labels = [];
  doc.querySelectorAll('.room-labels text, .area-names text').forEach((el) => {
    const x = +el.getAttribute('x'), y = +el.getAttribute('y');
    if (Number.isFinite(x) && Number.isFinite(y)) labels.push({ x, y, text: el.textContent.trim(), big: !!el.closest('.area-names') });
  });
  return { floor, rooms, labels };
}

/* ---------- materials ---------- */
// Named materials so the theme (light/dark) can recolour them in place.
const named = new Map();
let theme = THEMES.light;
function mat(key) {
  if (!named.has(key)) named.set(key, new THREE.MeshStandardMaterial({ color: theme[key], roughness: 0.92, metalness: 0, envMapIntensity: 0.5 }));
  return named.get(key);
}
const solid = (color, rough = 0.55) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 });
function flat(color, opacity = 1) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
}
let edgeMat = null;

export function createScene(container, spec) {
  const plan = readPlan(spec.svgText);
  const allFloor = plan.floor.flat();
  const OX = (Math.min(...allFloor.map((p) => p[0])) + Math.max(...allFloor.map((p) => p[0]))) / 2;
  const OY = (Math.min(...allFloor.map((p) => p[1])) + Math.max(...allFloor.map((p) => p[1]))) / 2;
  const W = (x, y) => [(x - OX) * K, (y - OY) * K];
  const P = (wx, wz) => [wx / K + OX, wz / K + OY];
  const places = spec.places;

  // A room that holds one of our places becomes a flat tile (things stand on it); empty rooms are blocks.
  plan.rooms.forEach((r) => {
    r.tile = r.group === 'open' || places.some((p) => inside([p.x, p.y], r.ring));
    r.h = r.group === 'open' ? 0.04 : r.tile ? TILE_H : r.group === 'service' ? SERVICE_H : BLOCK_H;
  });
  const blocks = plan.rooms.filter((r) => !r.tile);
  const baseAt = (x, y) => plan.rooms.reduce((h, r) => (r.tile && inside([x, y], r.ring) ? Math.max(h, r.h) : h), 0);
  const inBlock = (x, y) => blocks.some((r) => inside([x, y], r.ring));
  const onFloor = (x, y) => plan.floor.some((ring) => inside([x, y], ring));

  /* renderer */
  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  theme = dark.matches ? THEMES.dark : THEMES.light;
  named.forEach((m, k) => m.color.setHex(theme[k]));
  edgeMat = new THREE.LineBasicMaterial({ color: theme.edge });
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(DPR);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  renderer.domElement.className = 'scene-canvas';
  container.appendChild(renderer.domElement);
  const labels = new CSS2DRenderer();
  labels.domElement.className = 'scene-labels';
  container.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 2000);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  const sun = new THREE.DirectionalLight(0xffffff, 2.6);
  sun.position.set(-30, 70, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 260 });
  sun.shadow.radius = 9;
  sun.shadow.blurSamples = 16;
  sun.shadow.bias = -0.0004;
  scene.add(sun, sun.target);

  // Ambient occlusion makes the white blocks read without heavy outlines.
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(Math.min(DPR, 1.5));
  composer.addPass(new RenderPass(scene, camera));
  try {
    const gtao = new GTAOPass(scene, camera, 1, 1);
    gtao.updateGtaoMaterial({ radius: 2.2, distanceExponent: 1.5, thickness: 1.5, scale: 1.1, samples: 16 });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    gtao.blendIntensity = 1.0;
    composer.addPass(gtao);
  } catch (e) { console.warn('AO off:', e.message); }
  composer.addPass(new OutputPass());

  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.ShadowMaterial({ opacity: theme.shadow }));
  catcher.rotation.x = -Math.PI / 2;
  catcher.position.y = -0.62;
  catcher.receiveShadow = true;
  scene.add(catcher);

  /* plan geometry */
  function prism(ring, h, key, edges = true) {
    const s = new THREE.Shape();
    ring.forEach(([x, y], i) => { const [wx, wz] = W(x, y); i ? s.lineTo(wx, -wz) : s.moveTo(wx, -wz); });
    const bevel = Math.min(BEVEL, h / 3);
    const geo = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.01, h - 2 * bevel), bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 2, curveSegments: 1 });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, bevel, 0);
    const m = new THREE.Mesh(geo, mat(key));
    m.castShadow = true; m.receiveShadow = true;
    if (edges) m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 28), edgeMat));
    return m;
  }
  const island = new THREE.Group();
  scene.add(island);
  const floorMeshes = plan.floor.map((ring) => { const m = prism(ring, 0.6, 'floor'); m.position.y = -0.6; island.add(m); return m; });
  const R = Math.max(...allFloor.map(([x, y]) => Math.hypot(...W(x, y))));
  const roomMeshes = plan.rooms.map((r) => {
    const m = prism(r.ring, r.h, r.tile ? (['study', 'shop', 'open'].includes(r.group) ? r.group : 'tile') : (r.group === 'service' ? 'service' : 'other'), r.group !== 'open');
    const cx = r.ring.reduce((s, p) => s + p[0], 0) / r.ring.length, cy = r.ring.reduce((s, p) => s + p[1], 0) / r.ring.length;
    m.userData.intro = { delay: (r.tile ? 450 : 700) + (Math.hypot(...W(cx, cy)) / R) * 800, dur: r.tile ? 450 : 700 };
    m.scale.y = 0.001;
    island.add(m);
    return m;
  });

  /* labels */
  const css = (cls, text) => { const el = document.createElement('div'); el.className = cls; el.textContent = text; return el; };
  const planLabels = plan.labels.map((l) => {
    const block = blocks.find((r) => inside([l.x, l.y], r.ring));
    const o = new CSS2DObject(css(l.big ? 'lbl-area' : 'lbl-num', l.text));
    const [wx, wz] = W(l.x, l.y);
    o.position.set(wx, block ? block.h + 0.05 : baseAt(l.x, l.y) + 0.05, wz);
    island.add(o);
    return o;
  });

  /* places */
  const pickables = [];
  const S = { markers: spec.markers || {}, visible: new Set(places.map((p) => p.layer)), hover: null, selected: null };
  const nodes = new Map();
  const puckGeo = new THREE.CylinderGeometry(0.62, 0.62, 0.16, 48);
  const haloGeo = new THREE.CircleGeometry(1.5, 48).rotateX(-Math.PI / 2);
  const ringGeo = new THREE.RingGeometry(1.0, 1.06, 64).rotateX(-Math.PI / 2);
  const bodyGeo = new THREE.CapsuleGeometry(0.2, 0.62, 4, 16);
  const headGeo = new THREE.SphereGeometry(0.17, 20, 14);

  function tagPick(obj, id) { obj.traverse((o) => { o.userData.placeId = id; if (o.isMesh) pickables.push(o); }); }

  // Amenity models first: one uniform scale, shrunk only where they would overlap a block or each other.
  const amenities = places.filter((p) => p.layer !== 'study');
  const foot = new Map();
  amenities.forEach((p) => {
    const mk = S.markers[p.id] || {};
    const holder = buildModel(p.layer, (mk.model && mk.model.data) || {});
    const size = holder.userData.size;
    foot.set(p.id, { holder, r: (Math.max(size.x, size.z) / 2) * MODEL_SCALE, s: MODEL_SCALE });
  });
  const ids = [...foot.keys()];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = places.find((p) => p.id === ids[i]), b = places.find((p) => p.id === ids[j]);
    const fa = foot.get(ids[i]), fb = foot.get(ids[j]);
    const d = Math.hypot(...W(a.x, a.y).map((v, k) => v - W(b.x, b.y)[k]));
    if (d < fa.r + fb.r) { const f = Math.max(0.6, (d * 0.92) / (fa.r + fb.r)); fa.r *= f; fa.s *= f; fb.r *= f; fb.s *= f; }
  }
  foot.forEach((f, id) => {
    const p = places.find((q) => q.id === id);
    const [wx, wz] = W(p.x, p.y);
    for (let tries = 0; tries < 12; tries++) {
      const hit = Array.from({ length: 12 }, (_, k) => k * Math.PI / 6).some((a) => inBlock(...P(wx + Math.cos(a) * f.r, wz + Math.sin(a) * f.r)));
      if (!hit) break;
      f.r *= 0.88; f.s *= 0.88;
    }
  });

  // Relaxation: study markers stay put; models are nudged apart (never into a block) or shrunk a little.
  const bodies = new Map(places.map((p) => { const [x, z] = W(p.x, p.y); const f = foot.get(p.id); return [p.id, { x, z, r: f ? f.r : 1.05, f }]; }));
  const freeAt = (b, x, z) => Array.from({ length: 12 }, (_, k) => k * Math.PI / 6).every((a) => !inBlock(...P(x + Math.cos(a) * b.r, z + Math.sin(a) * b.r)));
  const move = (b, dx, dz) => {
    if (freeAt(b, b.x + dx, b.z + dz)) { b.x += dx; b.z += dz; }
    else if (b.f.s > MODEL_SCALE * 0.4) { b.f.r *= 0.93; b.f.s *= 0.93; b.r = b.f.r; }
  };
  const list = [...bodies.values()];
  for (let it = 0; it < 60; it++) {
    let moved = false;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (!a.f && !b.f) continue;
      let dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
      const need = a.r + b.r + 0.2;
      if (d >= need) continue;
      if (d < 1e-3) { dx = 1; dz = 0; d = 1; }
      const push = need - d, ux = dx / d, uz = dz / d;
      if (a.f && b.f) { move(a, -ux * push / 2, -uz * push / 2); move(b, ux * push / 2, uz * push / 2); }
      else if (a.f) move(a, -ux * push, -uz * push);
      else move(b, ux * push, uz * push);
      moved = true;
    }
    if (!moved) break;
  }
  // Abstract white figures, as in an architectural model: one per person counted (max 6 per place).
  function makeFigure(seed) {
    const r = rnd(seed);
    const g = new THREE.Group();
    const body = new THREE.Mesh(bodyGeo, mat('figure'));
    body.position.y = 0.52;
    const head = new THREE.Mesh(headGeo, mat('figure'));
    head.position.y = 1.08;
    body.castShadow = head.castShadow = true;
    g.add(body, head);
    g.rotation.y = r() * Math.PI * 2;
    g.userData = { phase: r() * Math.PI * 2, speed: 0.5 + r() * 0.4, delay: 0 };
    return g;
  }

  function placeFigures(node, n) {
    node.figures.forEach((f) => { node.group.remove(f); pickables.splice(0, pickables.length, ...pickables.filter((m) => !f.children.includes(m))); });
    node.figures = [];
    if (!n) return;
    const p = node.place, wx = node.wx, wz = node.wz;
    const taken = [...nodes.values()].filter((o) => o !== node).map((o) => ({ x: o.wx, z: o.wz, r: o.r + 0.6 }));
    const count = Math.min(6, n);
    const rr = rnd(hash(p.id) + n);
    for (let i = 0; i < count; i++) {
      let ok = null;
      for (let t = 0; t < 10 && !ok; t++) {
        const a = (i / count) * Math.PI * 2 + rr() * 0.8 + t * 0.6, rad = 1.9 + (t % 3) * 0.6 + rr() * 0.3;
        const x = wx + Math.cos(a) * rad, z = wz + Math.sin(a) * rad;
        const [px, py] = P(x, z);
        if (!onFloor(px, py) || inBlock(px, py)) continue;
        if (taken.some((o) => Math.hypot(o.x - x, o.z - z) < o.r)) continue;
        if (node.figures.some((f) => Math.hypot(f.position.x + wx - x, f.position.z + wz - z) < 0.75)) continue;
        ok = [x, z, baseAt(px, py)];
      }
      if (!ok) continue;
      const f = makeFigure(hash(p.id) + i * 7919);
      f.position.set(ok[0] - wx, ok[2] - node.base, ok[1] - wz);
      f.userData.base = f.position.y;
      f.userData.delay = performance.now() - t0 + (introDone ? 0 : 2000) + rr() * 500;
      f.scale.setScalar(0.001);
      tagPick(f, p.id);
      node.group.add(f);
      node.figures.push(f);
    }
  }

  function setRipples(node, n, color) {
    node.ripples.forEach((m) => node.group.remove(m));
    node.ripples = Array.from({ length: n }, (_, i) => {
      const m = new THREE.Mesh(ringGeo, flat(color, 0));
      m.renderOrder = 2;
      m.position.y = 0.04;
      m.userData.offset = i / n;
      node.group.add(m);
      return m;
    });
  }

  let t0 = performance.now(), introDone = false;
  places.forEach((p, i) => {
    const body = bodies.get(p.id), wx = body.x, wz = body.z;
    const base = baseAt(...P(wx, wz));
    const group = new THREE.Group();
    group.position.set(wx, base, wz);
    island.add(group);
    const mk = S.markers[p.id] || {};
    const node = { place: p, group, base, wx, wz, figures: [], ripples: [], k: 0, colorTo: new THREE.Color(mk.color || '#999') };
    if (p.layer === 'study') {
      const puck = new THREE.Mesh(puckGeo, solid(node.colorTo.clone(), 0.4));
      puck.position.y = 0.08;
      puck.castShadow = true;
      const halo = new THREE.Mesh(haloGeo, flat(node.colorTo.clone(), 0.16));
      halo.position.y = 0.02;
      halo.renderOrder = 1;
      group.add(halo);
      node.halo = halo;
      const lift = new THREE.Group();
      lift.add(puck);
      group.add(lift);
      node.lift = lift; node.puck = puck; node.r = 1;
      const el = css('pin-db', mk.label || '');
      el.style.setProperty('--c', mk.color || '#999');
      node.label = new CSS2DObject(el);
      node.label.position.y = 0.9;
      lift.add(node.label);
      tagPick(lift, p.id);
      node.intro = { delay: 1350 + i * 55, dur: 650, drop: true };
    } else {
      const f = foot.get(p.id);
      const lift = new THREE.Group();
      lift.add(f.holder);
      group.add(lift);
      node.lift = lift; node.model = f.holder; node.r = f.r; node.s = f.s;
      f.holder.scale.setScalar(0.001);
      tagPick(f.holder, p.id);
      node.intro = { delay: 1550 + i * 90, dur: 650 };
    }
    node.lift.scale.setScalar(p.layer === 'study' ? 1 : 1);
    nodes.set(p.id, node);
  });
  nodes.forEach((node) => {
    const mk = S.markers[node.place.id] || {};
    if (node.place.layer === 'study') { placeFigures(node, mk.people || 0); setRipples(node, mk.ripples || 0, mk.color || '#999'); }
  });

  const selRing = new THREE.Mesh(new THREE.RingGeometry(1.25, 1.36, 64).rotateX(-Math.PI / 2), flat(ACCENT, 0.9));
  selRing.renderOrder = 3;
  selRing.visible = false;
  island.add(selRing);

  /* camera + controls */
  const pts = places.map((p) => W(p.x, p.y));
  const lo = [Math.min(...pts.map((q) => q[0])), Math.min(...pts.map((q) => q[1]))], hi = [Math.max(...pts.map((q) => q[0])), Math.max(...pts.map((q) => q[1]))];
  const home = new THREE.Vector3((lo[0] + hi[0]) / 2, 0, (lo[1] + hi[1]) / 2);
  const controls = new MapControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.maxPolarAngle = 1.15;
  controls.minDistance = 10;
  controls.zoomSpeed = 1.1;
  controls.target.copy(home);
  const VIEW = { iso: { polar: 0.86, az: -0.32 }, flat: { polar: 0.0001, az: 0 } };
  let view = spec.view === 'flat' ? 'flat' : 'iso';
  const fitDist = () => {
    const aspect = camera.aspect || 1, half = THREE.MathUtils.degToRad(camera.fov / 2);
    const w = (hi[0] - lo[0]) / 2 + 6, d = (hi[1] - lo[1]) / 2 + 6;
    return Math.max(d / Math.tan(half), w / (Math.tan(half) * aspect)) * (view === 'iso' ? 1.15 : 1.0);
  };
  const sph = new THREE.Spherical();
  function readCam() {
    sph.setFromVector3(camera.position.clone().sub(controls.target));
    return { polar: sph.phi, az: sph.theta, dist: sph.radius, tx: controls.target.x, tz: controls.target.z };
  }
  function writeCam(c) {
    controls.target.set(c.tx, 0, c.tz);
    camera.position.setFromSpherical(new THREE.Spherical(c.dist, Math.max(0.0001, c.polar), c.az)).add(controls.target);
    camera.lookAt(controls.target);
  }
  let camTween = null;
  function flyTo(goal, ms) {
    const from = readCam();
    let dAz = goal.az - from.az; dAz = Math.atan2(Math.sin(dAz), Math.cos(dAz));
    camTween = { from, to: { ...from, ...goal, az: from.az + dAz }, t0: performance.now(), ms: reduced() ? 0 : ms, ease: outCubic };
  }
  controls.addEventListener('start', () => { camTween = null; });

  function resize() {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = w + 'px';
    renderer.domElement.style.height = h + 'px';
    labels.setSize(w, h);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    controls.maxDistance = fitDist() * 2.2;
  }
  resize();
  const ro = new ResizeObserver(() => resize());
  ro.observe(container);

  // Intro: the camera swings in from high and far while the island lands.
  const goal0 = { ...VIEW[view], dist: fitDist(), tx: home.x, tz: home.z };
  if (reduced()) { writeCam(goal0); t0 -= 10000; }
  else { writeCam({ polar: 0.25, az: 0.9, dist: goal0.dist * 1.75, tx: home.x, tz: home.z }); flyTo(goal0, 2600); }
  setTimeout(() => container.classList.add('labels-in'), reduced() ? 0 : 2100);

  /* picking */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let pointer = null, down = null;
  const visibleChain = (o) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
  function pickAt(cx, cy) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(pickables, false).find((h) => visibleChain(h.object));
    return hit ? hit.object.userData.placeId : null;
  }
  const el = renderer.domElement;
  const onMove = (e) => { pointer = { x: e.clientX, y: e.clientY }; };
  const onLeave = () => { pointer = null; setHover(null); };
  const onDown = (e) => { down = { x: e.clientX, y: e.clientY }; };
  const onUp = (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
    const id = pickAt(e.clientX, e.clientY);
    if (id && spec.onPick) spec.onPick(id);
  };
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerleave', onLeave);
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointerup', onUp);
  function setHover(id, x, y) {
    if (id !== S.hover) { S.hover = id; el.style.cursor = id ? 'pointer' : ''; }
    if (spec.onHover) spec.onHover(id, x, y);
  }

  /* loop */
  let raf = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const t = now - t0;
    if (camTween) {
      const k = camTween.ms ? clamp01((now - camTween.t0) / camTween.ms) : 1, e = camTween.ease(k), a = camTween.from, b = camTween.to;
      writeCam({ polar: a.polar + (b.polar - a.polar) * e, az: a.az + (b.az - a.az) * e, dist: a.dist + (b.dist - a.dist) * e, tx: a.tx + (b.tx - a.tx) * e, tz: a.tz + (b.tz - a.tz) * e });
      if (k >= 1) camTween = null;
    } else controls.update();
    // Keep panning on the floor.
    const tg = controls.target;
    const cx = THREE.MathUtils.clamp(tg.x, lo[0] - 10, hi[0] + 10), cz = THREE.MathUtils.clamp(tg.z, lo[1] - 10, hi[1] + 10);
    if (cx !== tg.x || cz !== tg.z) { camera.position.x += cx - tg.x; camera.position.z += cz - tg.z; tg.set(cx, 0, cz); }

    // Entrance: island drops in, tiles and blocks grow with overshoot as a wave from the centre.
    if (!introDone) {
      const ip = clamp01(t / 800);
      island.position.y = -2 * (1 - outCubic(ip));
      roomMeshes.forEach((m) => { const p = clamp01((t - m.userData.intro.delay) / m.userData.intro.dur); m.scale.y = Math.max(0.001, outBack(p)); });
      if (t > 4200) introDone = true;
    }
    nodes.forEach((n) => {
      const ip = clamp01((t - n.intro.delay) / n.intro.dur);
      const hov = n.place.id === S.hover ? 1 : 0, sel = n.place.id === S.selected ? 1 : 0;
      n.k += (Math.max(hov, sel) - n.k) * 0.16;
      const bob = sel && !reduced() ? Math.abs(Math.sin(now / 420)) * 0.25 : 0;
      if (n.puck) {
        // Drop from the sky, squash on landing.
        const y = n.intro.drop ? 4 * Math.pow(1 - outCubic(ip), 2) : 0;
        const land = ip > 0.6 && ip < 1 ? 0.4 * Math.sin(((ip - 0.6) / 0.4) * Math.PI) : 0;
        n.lift.position.y = y + n.k * 0.35 + bob;
        n.lift.scale.set(1 + 0.25 * land + 0.12 * n.k, Math.max(0.001, ip > 0 ? 1 - 0.3 * land : 0.001) * (1 + 0.12 * n.k), 1 + 0.25 * land + 0.12 * n.k);
        n.puck.material.color.lerp(n.colorTo, 0.12);
        n.halo.material.color.copy(n.puck.material.color);
        n.halo.scale.setScalar(Math.max(0.001, outCubic(ip)));
      } else {
        n.model.scale.setScalar(Math.max(0.001, n.s * outBack(ip)) * (1 + 0.1 * n.k));
        n.lift.position.y = n.k * 0.4 + bob;
      }
      n.figures.forEach((f) => {
        const u = f.userData, fp = clamp01((t - u.delay) / 450);
        const hop = reduced() ? 0.5 : 0.5 + 0.5 * Math.sin(now / 1000 * u.speed * Math.PI + u.phase);
        f.scale.set(1, 1 + 0.02 * hop, 1).multiplyScalar(Math.max(0.001, outBack(fp)));
        f.position.y = u.base;
      });
      n.ripples.forEach((m) => {
        const k = ((now / 1700) + m.userData.offset) % 1;
        m.scale.setScalar(1 + k * 3.2);
        m.material.opacity = reduced() || ip < 1 ? 0 : 0.5 * (1 - k);
      });
    });
    if (S.selected && nodes.has(S.selected)) {
      const n = nodes.get(S.selected), k = (now % 1400) / 1400;
      selRing.visible = n.group.visible;
      selRing.position.set(n.wx, n.base + 0.05, n.wz);
      selRing.scale.setScalar(Math.max(1, n.r) * (1 + (reduced() ? 0 : outCubic(k) * 0.7)));
      selRing.material.opacity = reduced() ? 0.9 : 0.95 * (1 - k * 0.8);
    } else selRing.visible = false;

    if (pointer) {
      const id = pickAt(pointer.x, pointer.y);
      const r = container.getBoundingClientRect();
      setHover(id, pointer.x - r.left, pointer.y - r.top);
    }
    composer.render();
    labels.render(scene, camera);
  }
  raf = requestAnimationFrame(frame);

  /* api */
  function update(markers) {
    S.markers = markers || {};
    nodes.forEach((n) => {
      const mk = S.markers[n.place.id] || {};
      if (n.puck) {
        n.colorTo.set(mk.color || '#999');
        n.label.element.textContent = mk.label || '';
        n.label.element.style.setProperty('--c', mk.color || '#999');
        if ((mk.people || 0) !== n.people) { n.people = mk.people || 0; placeFigures(n, n.people); }
        if ((mk.ripples || 0) !== n.ripples.length) setRipples(n, mk.ripples || 0, mk.color || '#999');
        else n.ripples.forEach((m) => m.material.color.set(mk.color || '#999'));
      }
    });
  }
  nodes.forEach((n) => { n.people = (S.markers[n.place.id] || {}).people || 0; });

  function setVisible(layers) {
    S.visible = new Set(layers);
    nodes.forEach((n) => {
      const v = S.visible.has(n.place.layer);
      n.group.visible = v;
      if (n.label) n.label.visible = v;
    });
  }

  function select(id, fly) {
    S.selected = id;
    const n = nodes.get(id);
    if (!n || !fly) return;
    const c = readCam();
    flyTo({ tx: n.wx, tz: n.wz, dist: Math.min(c.dist, fitDist() * 0.55) }, 1100);
  }

  function setView(mode) {
    view = mode === 'flat' ? 'flat' : 'iso';
    flyTo({ ...VIEW[view] }, 900);
  }

  const onTheme = () => {
    theme = dark.matches ? THEMES.dark : THEMES.light;
    named.forEach((m, k) => m.color.setHex(theme[k]));
    edgeMat.color.setHex(theme.edge);
    catcher.material.opacity = theme.shadow;
  };
  dark.addEventListener('change', onTheme);

  function dispose() {
    dark.removeEventListener('change', onTheme);
    cancelAnimationFrame(raf);
    ro.disconnect();
    controls.dispose();
    ['pointermove', 'pointerleave', 'pointerdown', 'pointerup'].forEach((ev, i) => el.removeEventListener(ev, [onMove, onLeave, onDown, onUp][i]));
    renderer.dispose();
    container.replaceChildren();
  }

  return { update, setVisible, select, setView, dispose };
}
