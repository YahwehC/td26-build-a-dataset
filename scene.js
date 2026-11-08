/* scene.js: the MSC 1st floor as a dark "digital twin" (Three.js).
 * Look adapted from neonplan3d (c) 2026 Mastershort, MIT License (https://github.com/Mastershort/neonplan3d):
 * unlit MeshBasicMaterial with per-vertex fake light + height AO, additive cyan edge lines, a radially faded
 * ground grid, transparent canvas over a CSS radial-gradient sky, HTML glass chips and a cyan callout.
 *
 * createScene(container, { svgText, places, markers, areaNames, view, onPick, callout }) ->
 *   { update(markers), setVisible(layers), select(id, fly), setView(mode), dispose() }
 * places:  [{ id, layer, x, y }] in plan pixels (sign-photo frame, same as assets/msc-floor1.svg)
 * markers: { [id]: { color, label, level (0..1), ripples, model: { kind, data } } } */
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { buildModel } from './model3d.js';

const K = 0.05;                       // world units per plan pixel (floor ≈ 100 units wide)
const WALL_H = 0.55, SLAB = 0.22;     // low "cut" walls so the data inside stays visible
const MODEL_SCALE = 1.6;
const STUDY_AREAS = [5, 8, 9, 15, 16], SHOP_AREAS = [13, 14, 17, 18, 19];
// neonplan3d palette (build.ts NEON, geo.ts edge colours)
const NEON = { floor: 0x0e1629, slab: 0x0a1120, wall: 0x131d31, wallTop: 0x14303f, edge: 0x37e0ff, edgeSoft: 0x5b7cff };
const ROOM_FLOOR = { study: 0x10213b, shop: 0x131b2d, service: 0x0f172b, other: 0x111a2e, open: 0x0d1527 };
const LIGHT = [-0.55, 0.83];
const shade = (hex, k) => { const c = new THREE.Color(hex).multiplyScalar(k); c.r = Math.min(1, c.r); c.g = Math.min(1, c.g); c.b = Math.min(1, c.b); return c; };
const EDGE_TOP = shade(NEON.edge, 0.95), EDGE_SOFT = shade(NEON.edgeSoft, 0.34), EDGE_BASE = shade(NEON.edgeSoft, 0.22);

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const outCubic = (t) => 1 - Math.pow(1 - t, 3);
const inOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);   // neonplan3d flyTo ease
const outBack = (t) => { const c1 = 1.2, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

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
const ringArea = (r) => Math.abs(r.reduce((s, [x, y], i) => { const [x2, y2] = r[(i + 1) % r.length]; return s + x * y2 - x2 * y; }, 0) / 2);
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
  return { floor, rooms };
}

/* ---------- textures (neonplan3d makeGroundTexture, plus a soft glow disc) ---------- */
function groundTexture() {
  const size = 1024, cells = 32;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = 'rgba(91,124,255,0.16)'; ctx.lineWidth = 1;
  for (let i = 0; i <= cells; i++) {
    const p = Math.round((i / cells) * size) + 0.5;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke();
  }
  ctx.globalCompositeOperation = 'destination-in';
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.12, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas); tex.anisotropy = 4; tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function glowTexture() {
  const s = 128, c = document.createElement('canvas'); c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const additive = (opts = {}) => ({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, ...opts });

export function createScene(container, spec) {
  const plan = readPlan(spec.svgText);
  const allFloor = plan.floor.flat();
  const OX = (Math.min(...allFloor.map((p) => p[0])) + Math.max(...allFloor.map((p) => p[0]))) / 2;
  const OY = (Math.min(...allFloor.map((p) => p[1])) + Math.max(...allFloor.map((p) => p[1]))) / 2;
  const W = (x, y) => [(x - OX) * K, (y - OY) * K];
  const P = (wx, wz) => [wx / K + OX, wz / K + OY];
  const places = spec.places;
  const inRoom = (x, y) => plan.rooms.some((r) => r.group !== 'open' && inside([x, y], r.ring));

  /* renderer: transparent canvas, the CSS stage gradient is the sky (neonplan3d makeRenderer) */
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.className = 'scene-canvas';
  container.appendChild(renderer.domElement);
  const labels = new CSS2DRenderer();
  labels.domElement.className = 'scene-labels';
  container.appendChild(labels.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 2000);
  const world = new THREE.Group();
  scene.add(world);

  /* ground grid */
  const fx = allFloor.map(([x, y]) => W(x, y));
  const fLo = [Math.min(...fx.map((q) => q[0])), Math.min(...fx.map((q) => q[1]))], fHi = [Math.max(...fx.map((q) => q[0])), Math.max(...fx.map((q) => q[1]))];
  const span = 32 * Math.ceil((Math.max(fHi[0] - fLo[0], fHi[1] - fLo[1]) + 40) / 32);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: groundTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  ground.rotation.x = -Math.PI / 2; ground.renderOrder = -1;
  ground.scale.set(span, span, 1);
  ground.position.set(0, -SLAB - 0.02, 0);
  world.add(ground);

  /* floor slab: top in NEON.floor, sides in NEON.slab */
  const shapeOf = (ring) => { const s = new THREE.Shape(); ring.forEach(([x, y], i) => { const [wx, wz] = W(x, y); i ? s.lineTo(wx, -wz) : s.moveTo(wx, -wz); }); return s; };
  const slabMats = [new THREE.MeshBasicMaterial({ color: NEON.floor }), new THREE.MeshBasicMaterial({ color: NEON.slab })];
  plan.floor.forEach((ring) => {
    const geo = new THREE.ExtrudeGeometry(shapeOf(ring), { depth: SLAB, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2); geo.translate(0, -SLAB, 0);
    world.add(new THREE.Mesh(geo, slabMats));
  });
  // room floors, slightly lifted, tinted by use
  const roomFloors = plan.rooms.map((r) => {
    const geo = new THREE.ShapeGeometry(shapeOf(r.ring)); geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: ROOM_FLOOR[r.group] || ROOM_FLOOR.other, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    m.position.y = 0.004; world.add(m);
    return m;
  });

  /* walls: every room outline and the building outline, as vertical quads with fake light + AO
     (neonplan3d geo.ts pushPrism colours), cyan top edges, soft corner and base lines */
  const wallPos = [], wallCol = [], linePos = [], lineCol = [];
  const pushLine = (a, b, c) => { linePos.push(...a, ...b); lineCol.push(c.r, c.g, c.b, c.r, c.g, c.b); };
  function addWalls(ring, h) {
    const pts = ring.map(([x, y]) => W(x, y));
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length];
      const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
      const facing = ((dz / l) * LIGHT[0] - (dx / l) * LIGHT[1] + 1) / 2, dir = 0.8 + 0.28 * facing;
      const lo = shade(NEON.wall, 0.5 * dir), hi = shade(NEON.wallTop, (0.5 + 0.5 * Math.min(1, h / 1.6)) * dir * 1.25);
      const v = [[a[0], 0, a[1], lo], [b[0], 0, b[1], lo], [b[0], h, b[1], hi], [a[0], h, a[1], hi]];
      [0, 1, 2, 0, 2, 3].forEach((k) => { const [x, y, z, c] = v[k]; wallPos.push(x, y, z); wallCol.push(c.r, c.g, c.b); });
      pushLine([a[0], h, a[1]], [b[0], h, b[1]], EDGE_TOP);
      pushLine([a[0], 0.006, a[1]], [b[0], 0.006, b[1]], EDGE_BASE);
      pushLine([a[0], 0, a[1]], [a[0], h, a[1]], EDGE_SOFT);
    });
  }
  plan.floor.forEach((ring) => addWalls(ring, WALL_H * 1.25));
  plan.rooms.filter((r) => r.group !== 'open').forEach((r) => addWalls(r.ring, r.group === 'service' ? WALL_H * 0.8 : WALL_H));
  const wallGeo = new THREE.BufferGeometry();
  wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(wallPos, 3));
  wallGeo.setAttribute('color', new THREE.Float32BufferAttribute(wallCol, 3));
  const walls = new THREE.Mesh(wallGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.92, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3));
  lineGeo.setAttribute('color', new THREE.Float32BufferAttribute(lineCol, 3));
  const edges = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ vertexColors: true, ...additive() }));
  const wallGroup = new THREE.Group();
  wallGroup.add(walls, edges);
  world.add(wallGroup);

  /* area names (from areas.csv), at the centre of each area's largest outline */
  const css = (cls, html) => { const el = document.createElement('div'); el.className = cls; el.innerHTML = html; return el; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const areaLabels = [];
  Object.entries(spec.areaNames || {}).forEach(([num, name]) => {
    const rs = plan.rooms.filter((r) => r.area === Number(num));
    if (!rs.length || !name) return;
    const big = rs.reduce((a, b) => (ringArea(b.ring) > ringArea(a.ring) ? b : a));
    const cx = big.ring.reduce((s, p) => s + p[0], 0) / big.ring.length, cy = big.ring.reduce((s, p) => s + p[1], 0) / big.ring.length;
    const o = new CSS2DObject(css('lbl-area', esc(name)));
    const [wx, wz] = W(cx, cy);
    o.position.set(wx, 0.05, wz);
    world.add(o);
    areaLabels.push(o);
  });

  /* places */
  const pickables = [];
  const S = { markers: spec.markers || {}, visible: new Set(places.map((p) => p.layer)), hover: null, selected: null };
  const nodes = new Map();
  const glowTex = glowTexture();
  const glowGeo = new THREE.PlaneGeometry(3.2, 3.2).rotateX(-Math.PI / 2);
  const dotGeo = new THREE.CircleGeometry(0.32, 40).rotateX(-Math.PI / 2);
  const ringGeo = new THREE.RingGeometry(0.92, 1, 64).rotateX(-Math.PI / 2);     // neonplan3d speaker ripple
  const pickGeo = new THREE.CylinderGeometry(0.9, 0.9, 1.6, 12);
  const pickMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true, opacity: 0 });
  const BEAM_H = 1.5;
  function tagPick(obj, id) { obj.traverse((o) => { o.userData.placeId = id; if (o.isMesh) pickables.push(o); }); }

  // Amenity models: one uniform scale; shrunk or nudged so they never overlap walls' rooms edges or each other.
  const foot = new Map();
  places.filter((p) => p.layer !== 'study').forEach((p) => {
    const mk = S.markers[p.id] || {};
    const holder = buildModel(p.layer, (mk.model && mk.model.data) || {}, { neon: mk.color || '#37e0ff' });
    const size = holder.userData.size;
    foot.set(p.id, { holder, r: (Math.max(size.x, size.z) / 2) * MODEL_SCALE, s: MODEL_SCALE });
  });
  const bodies = new Map(places.map((p) => { const [x, z] = W(p.x, p.y); const f = foot.get(p.id); return [p.id, { x, z, r: f ? f.r : 0.9, f }]; }));
  const list = [...bodies.values()];
  for (let it = 0; it < 80; it++) {
    let moved = false;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (!a.f && !b.f) continue;
      let dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
      const need = a.r + b.r + 0.15;
      if (d >= need) continue;
      if (d < 1e-3) { dx = 1; dz = 0; d = 1; }
      const push = need - d, ux = dx / d, uz = dz / d;
      const shrink = (o) => { if (o.f && o.f.s > MODEL_SCALE * 0.45) { o.f.s *= 0.95; o.f.r *= 0.95; o.r = o.f.r; } };
      if (a.f && b.f) { a.x -= ux * push / 2; a.z -= uz * push / 2; b.x += ux * push / 2; b.z += uz * push / 2; shrink(a); shrink(b); }
      else if (a.f) { a.x -= ux * push; a.z -= uz * push; shrink(a); }
      else { b.x += ux * push; b.z += uz * push; shrink(b); }
      moved = true;
    }
    if (!moved) break;
  }

  let t0 = performance.now(), introDone = false;
  places.forEach((p, i) => {
    const body = bodies.get(p.id);
    const group = new THREE.Group();
    group.position.set(body.x, 0.01, body.z);
    world.add(group);
    const mk = S.markers[p.id] || {};
    const color = new THREE.Color(mk.color || '#5b7cff');
    const node = { place: p, group, wx: body.x, wz: body.z, ripples: [], k: 0, color, colorTo: color.clone(), r: body.r };
    if (p.layer === 'study') {
      const glow = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({ map: glowTex, color, ...additive({ opacity: 0.55 }) }));
      glow.renderOrder = 2;
      const dot = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color }));
      dot.position.y = 0.01;
      const beamGeo = new THREE.BufferGeometry();
      beamGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, BEAM_H, 0], 3));
      beamGeo.setAttribute('color', new THREE.Float32BufferAttribute([1, 1, 1, 0.05, 0.05, 0.05], 3));
      const beamMat = new THREE.LineBasicMaterial({ vertexColors: true, color, ...additive() });
      const beam = new THREE.LineSegments(beamGeo, beamMat);
      const pick = new THREE.Mesh(pickGeo, pickMat); pick.position.y = 0.8;
      group.add(glow, dot, beam, pick);
      tagPick(pick, p.id);
      const el = css('chip', '');
      node.chip = new CSS2DObject(el);
      node.chip.position.y = BEAM_H + 0.15;
      group.add(node.chip);
      Object.assign(node, { glow, dot, beam, mats: [glow.material, dot.material, beamMat] });
      node.intro = { delay: 900 + i * 60, dur: 700 };
    } else {
      const f = foot.get(p.id);
      f.holder.scale.setScalar(0.001);
      group.add(f.holder);
      tagPick(f.holder, p.id);
      Object.assign(node, { model: f.holder, s: f.s });
      node.intro = { delay: 1200 + i * 80, dur: 650 };
    }
    nodes.set(p.id, node);
  });

  function setRipples(node, n, level) {
    node.ripples.forEach((m) => node.group.remove(m));
    node.ripples = Array.from({ length: n }, (_, i) => {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: node.color, ...additive({ opacity: 0 }) }));
      m.position.y = 0.02; m.renderOrder = 3;
      m.userData = { offset: i / n, level };
      node.group.add(m);
      return m;
    });
  }
  function applyMarker(node) {
    const mk = S.markers[node.place.id] || {};
    node.colorTo.set(mk.color || '#5b7cff');
    if (node.chip) {
      node.chip.element.innerHTML = `<i style="--c:${esc(mk.color || '#5b7cff')}"></i>${esc(mk.label || '–')}`;
      node.chip.element.classList.toggle('dim', !mk.measured);
      const n = mk.ripples || 0;
      if (n !== node.ripples.length) setRipples(node, n, mk.level || 0);
      node.ripples.forEach((m) => { m.userData.level = mk.level || 0; });
    }
  }
  nodes.forEach(applyMarker);

  // Callout: neonplan3d's cyan floor pill, shown for the hovered or selected place, to its left.
  const calloutEl = css('callout', '');
  const callout = new CSS2DObject(calloutEl);
  callout.visible = false;
  world.add(callout);
  const selRing = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.32, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: NEON.edge, ...additive({ opacity: 0.9 }) }));
  selRing.visible = false; selRing.renderOrder = 4;
  world.add(selRing);

  /* camera (neonplan3d: fov 38, theta -0.6, phi 0.85; MIN_PHI 0.12, MAX_PHI 1.35) */
  const home = new THREE.Vector3((fLo[0] + fHi[0]) / 2, 0, (fLo[1] + fHi[1]) / 2);
  const controls = new MapControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.minPolarAngle = 0.0001;
  controls.maxPolarAngle = 1.35;
  controls.minDistance = 6;
  controls.zoomSpeed = 1.1;
  controls.target.copy(home);
  const VIEW = { iso: { polar: 0.85, az: -0.6 }, flat: { polar: 0.0001, az: 0 } };
  let view = spec.view === 'flat' ? 'flat' : 'iso';
  const fitDist = () => {
    const size = new THREE.Vector3(fHi[0] - fLo[0], 2, fHi[1] - fLo[1]);
    const v = THREE.MathUtils.degToRad(camera.fov), h = 2 * Math.atan(Math.tan(v / 2) * (camera.aspect || 1));
    return Math.max(20, (size.length() / 2) / Math.sin(Math.min(v, h) / 2) * (camera.aspect < 1 ? 1.16 : 0.86));
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
  let camTween = null, touched = false;
  function flyTo(goal, ms) {
    const from = readCam();
    let dAz = (goal.az ?? from.az) - from.az; dAz = Math.atan2(Math.sin(dAz), Math.cos(dAz));
    camTween = { from, to: { ...from, ...goal, az: from.az + dAz }, t0: performance.now(), ms: reduced() ? 0 : ms };
  }
  controls.addEventListener('start', () => { camTween = null; touched = true; });

  function resize() {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = w + 'px';
    renderer.domElement.style.height = h + 'px';
    labels.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    controls.maxDistance = fitDist() * 2;
  }
  resize();
  const ro = new ResizeObserver(() => resize());
  ro.observe(container);

  // Intro: glide in from further out while the walls rise and the beams light up.
  const goal0 = { ...VIEW[view], dist: fitDist(), tx: home.x, tz: home.z };
  if (reduced()) { writeCam(goal0); t0 -= 10000; }
  else { writeCam({ ...goal0, polar: 0.35, az: goal0.az + 0.7, dist: goal0.dist * 1.45 }); flyTo(goal0, 2200); }
  setTimeout(() => container.classList.add('labels-in'), reduced() ? 0 : 1300);

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
  const onLeave = () => { pointer = null; S.hover = null; el.style.cursor = ''; };
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

  let calloutId = null;
  function showCallout(id) {
    if (id === calloutId) return;
    calloutId = id;
    const n = id && nodes.get(id);
    if (!n || !n.group.visible) { callout.visible = false; calloutEl.style.display = 'none'; return; }
    const info = spec.callout ? spec.callout(id) : { title: id, sub: '' };
    calloutEl.innerHTML = `<div><b>${esc(info.title)}</b><span>${esc(info.sub || '')}</span></div>`;
    callout.position.set(n.wx, n.chip ? BEAM_H * 0.6 : 1.2, n.wz);
    callout.visible = true; calloutEl.style.display = '';
  }

  /* loop */
  let raf = 0, last = performance.now();
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(100, now - last); last = now;
    const t = now - t0;
    if (camTween) {
      const k = camTween.ms ? clamp01((now - camTween.t0) / camTween.ms) : 1, e = inOutCubic(k), a = camTween.from, b = camTween.to;
      writeCam({ polar: a.polar + (b.polar - a.polar) * e, az: a.az + (b.az - a.az) * e, dist: a.dist + (b.dist - a.dist) * e, tx: a.tx + (b.tx - a.tx) * e, tz: a.tz + (b.tz - a.tz) * e });
      if (k >= 1) camTween = null;
    } else {
      // neonplan3d auto-orbit (0.06 rad/s, slower here) until the visitor touches the map
      if (!touched && !reduced() && view === 'iso' && !S.selected) {
        const c = readCam(); c.az += 0.025 * dt / 1000; writeCam(c);
      }
      controls.update();
    }
    const tg = controls.target;
    const cx = THREE.MathUtils.clamp(tg.x, fLo[0], fHi[0]), cz = THREE.MathUtils.clamp(tg.z, fLo[1], fHi[1]);
    if (cx !== tg.x || cz !== tg.z) { camera.position.x += cx - tg.x; camera.position.z += cz - tg.z; tg.set(cx, 0, cz); }

    if (!introDone) {
      wallGroup.scale.y = Math.max(0.001, outCubic(clamp01((t - 300) / 900)));
      ground.material.opacity = clamp01(t / 900);
      if (t > 3500) introDone = true;
    }
    nodes.forEach((n) => {
      const ip = clamp01((t - n.intro.delay) / n.intro.dur);
      const hot = n.place.id === S.hover || n.place.id === S.selected ? 1 : 0;
      n.k += (hot - n.k) * 0.15;
      if (n.chip) {
        n.color.lerp(n.colorTo, 0.1);
        const e = outCubic(ip);
        n.beam.scale.y = Math.max(0.001, e);
        n.glow.scale.setScalar(Math.max(0.001, e) * (1 + 0.25 * n.k));
        n.glow.material.opacity = 0.5 + 0.3 * n.k;
        n.chip.position.y = BEAM_H * e + 0.15;
        n.chip.element.style.opacity = String(e);
        n.chip.element.classList.toggle('hot', hot === 1);
        n.ripples.forEach((m) => {
          const k = ((now / 1600) + m.userData.offset) % 1;
          m.scale.setScalar(0.6 + k * 2.6);
          m.material.opacity = reduced() || ip < 1 ? 0 : (1 - k) * (0.25 + 0.45 * m.userData.level);
        });
      } else {
        n.model.scale.setScalar(Math.max(0.001, n.s * outBack(ip)) * (1 + 0.08 * n.k));
        n.model.position.y = n.k * 0.25 + (n.place.id === S.selected && !reduced() ? Math.abs(Math.sin(now / 450)) * 0.2 : 0);
      }
    });
    if (S.selected && nodes.has(S.selected)) {
      const n = nodes.get(S.selected), k = (now % 1600) / 1600;
      selRing.visible = n.group.visible;
      selRing.position.set(n.wx, 0.03, n.wz);
      selRing.scale.setScalar(Math.max(0.9, n.r) * (1 + (reduced() ? 0 : outCubic(k) * 0.6)));
      selRing.material.opacity = reduced() ? 0.9 : 0.9 * (1 - k * 0.85);
    } else selRing.visible = false;

    if (pointer) {
      const id = pickAt(pointer.x, pointer.y);
      if (id !== S.hover) { S.hover = id; el.style.cursor = id ? 'pointer' : ''; }
    }
    showCallout(S.hover || S.selected);
    renderer.render(scene, camera);
    labels.render(scene, camera);
  }
  raf = requestAnimationFrame(frame);

  /* api */
  function update(markers) { S.markers = markers || {}; nodes.forEach(applyMarker); calloutId = '__'; }
  function setVisible(layers) {
    S.visible = new Set(layers);
    nodes.forEach((n) => { const v = S.visible.has(n.place.layer); n.group.visible = v; if (n.chip) n.chip.visible = v; });
    calloutId = '__';
  }
  function select(id, fly) {
    S.selected = id; calloutId = '__';
    const n = nodes.get(id);
    if (!n || !fly) return;
    const c = readCam();
    flyTo({ tx: n.wx, tz: n.wz, dist: Math.min(c.dist, fitDist() * 0.5) }, 900);
  }
  function setView(mode) {
    view = mode === 'flat' ? 'flat' : 'iso';
    flyTo({ ...VIEW[view] }, 700);
  }
  function dispose() {
    cancelAnimationFrame(raf);
    ro.disconnect();
    controls.dispose();
    ['pointermove', 'pointerleave', 'pointerdown', 'pointerup'].forEach((ev, i) => el.removeEventListener(ev, [onMove, onLeave, onDown, onUp][i]));
    renderer.dispose();
    container.replaceChildren();
  }
  return { update, setVisible, select, setView, dispose };
}
