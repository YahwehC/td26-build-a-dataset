/* model3d.js: small "3D cartoon" models of MSC amenities, drawn procedurally with Three.js from OUR data.
 * open(container, { kind, title, data, onPick }) -> { dispose() }
 * kinds: vending (products + sold-out slots), water (counter display, filter light), microwave (units working), printer. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const outBack = (t) => { const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const clamp01 = (v) => Math.max(0, Math.min(1, v));

const PAL = {
  vending: 0xb7a3ff, vendingDark: 0x6c55c9, water: 0x9fcbf5, waterDark: 0x3a7fc8, microwave: 0xfdfcff,
  microDark: 0x3b3f57, counter: 0xffd9c2, counterTop: 0xfff2ea, printer: 0xeef0f6, table: 0xc9f0dc,
  wall: 0xeef0fb, steel: 0xd9dce8, glass: 0xdff3ff, dark: 0x2b2d42, red: 0xe0475b, green: 0x34b27d,
  yellow: 0xf2b632, pedestal: 0xe6e3fb
};

function hashHue(text) {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 360) / 360;
}

export function open(container, spec = {}) {
  let api = { dispose() {} };
  try {
    api = build(container, spec);
  } catch (err) {
    console.error(err);
    container.textContent = '3D view could not start on this device.';
  }
  return api;
}

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch (e) { return false; }
}

function build(container, spec) {
  if (!webglAvailable()) {
    container.textContent = '3D view needs WebGL, which this browser does not provide.';
    return { dispose() {} };
  }
  const disposables = [];
  const track = (o) => { disposables.push(o); return o; };

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = 'model3d-canvas';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 100);

  scene.add(new THREE.HemisphereLight(0xfff6f0, 0xcfd8ff, 1.25));
  const sun = new THREE.DirectionalLight(0xffffff, 1.7);
  sun.position.set(3.5, 7, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.5, far: 20 });
  sun.shadow.radius = 6;
  scene.add(sun);

  const ground = new THREE.Mesh(track(new THREE.PlaneGeometry(30, 30)), track(new THREE.ShadowMaterial({ opacity: 0.16 })));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const kit = makeKit(track);
  const model = new THREE.Group();
  const pickables = [];
  const drops = [];       // children that drop in after the pop
  const spinners = [];    // things with idle motion (frost)
  const kind = spec.kind || 'vending';
  const data = spec.data || {};
  if (kind === 'vending') buildVending(model, kit, data, pickables, drops);
  else if (kind === 'water') buildWater(model, kit, data, drops, spinners);
  else if (kind === 'microwave') buildMicrowaves(model, kit, data, drops);
  else buildPrinters(model, kit, data, drops);

  // Pedestal sized to the model footprint.
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.x, size.z) * 0.62 + 0.35;
  const pedestal = new THREE.Mesh(track(new THREE.CylinderGeometry(radius, radius * 1.03, 0.1, 72)), kit.mat(PAL.pedestal));
  pedestal.position.set(center.x, -0.05, center.z);
  pedestal.receiveShadow = true;
  scene.add(pedestal);
  scene.add(model);

  model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  // Frame the camera on the model.
  const fit = Math.max(size.x, size.y * 1.1, size.z) * 2.5 + 1.2;
  camera.position.set(center.x + fit * 0.62, center.y + fit * 0.42, center.z + fit * 0.9);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(center.x, center.y * 0.9, center.z);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = fit * 0.45;
  controls.maxDistance = fit * 1.6;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.autoRotate = !reduced();
  controls.autoRotateSpeed = 0.6;
  let resumeTimer = 0;
  controls.addEventListener('start', () => { controls.autoRotate = false; clearTimeout(resumeTimer); });
  controls.addEventListener('end', () => {
    clearTimeout(resumeTimer);
    if (!reduced()) resumeTimer = setTimeout(() => { controls.autoRotate = true; }, 3000);
  });

  // Resize to the container.
  const resize = () => {
    const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  // Picking (vending products).
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let hovered = null;
  const setHover = (mesh) => {
    if (hovered === mesh) return;
    if (hovered) { hovered.userData.targetScale = 1; hovered.material.emissive.setHex(0x000000); }
    hovered = mesh;
    if (hovered) {
      hovered.userData.targetScale = 1.18;
      hovered.material.emissive.setHex(0x332244);
      if (typeof spec.onPick === 'function') spec.onPick(hovered.userData.item);
    }
  };
  const pick = (event) => {
    if (!pickables.length) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(pickables, false)[0];
    setHover(hit ? hit.object : null);
    renderer.domElement.style.cursor = hit ? 'pointer' : 'grab';
  };
  renderer.domElement.addEventListener('pointermove', pick);
  renderer.domElement.addEventListener('pointerdown', pick);

  // Animation loop.
  const start = performance.now();
  const animateIn = !reduced();
  if (animateIn) model.scale.setScalar(0.001);
  drops.forEach((d, i) => {
    d.userData.restY = d.position.y;
    d.userData.dropDelay = 380 + i * 30;
    if (animateIn) { d.position.y += 0.35; d.visible = false; }
  });
  let raf = 0;
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    const t = now - start;
    if (animateIn) {
      const s = t < 700 ? Math.max(0.001, outBack(clamp01(t / 700))) : 1;
      model.scale.setScalar(s);
      drops.forEach((d) => {
        const k = clamp01((t - d.userData.dropDelay) / 360);
        if (k > 0) d.visible = true;
        d.position.y = d.userData.restY + 0.35 * (1 - outBack(k));
      });
    }
    pickables.forEach((m) => {
      const target = m.userData.targetScale || 1;
      m.scale.setScalar(m.scale.x + (target - m.scale.x) * 0.2);
    });
    spinners.forEach((fn) => fn(t));
    controls.update();
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(loop);

  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      clearTimeout(resumeTimer);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointermove', pick);
      renderer.domElement.removeEventListener('pointerdown', pick);
      controls.dispose();
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        mats.forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
      });
      disposables.forEach((d) => { if (d && d.dispose) d.dispose(); });
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    }
  };
}

/* ---------- building blocks ---------- */
function makeKit(track) {
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.68, metalness: 0, ...extra });
  const box = (w, h, d, color, r = 0.04, extra) => {
    const g = new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2.2, h / 2.2, d / 2.2));
    return new THREE.Mesh(g, typeof color === 'object' ? color : mat(color, extra));
  };
  const label = (lines, { w = 1, h = 0.3, bg = '#ffffff', fg = '#2b2d42', font = 600, px = 64, glow = false } = {}) => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = Math.round(512 * (h / w));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const rows = Array.isArray(lines) ? lines : [lines];
    rows.forEach((line, i) => {
      const size = i === 0 ? px : px * 0.55;
      ctx.font = `${i === 0 ? font : 500} ${size}px "Fredoka", "Nunito Sans", system-ui, sans-serif`;
      const y = canvas.height * ((i + 1) / (rows.length + 1)) + (rows.length > 1 && i === 0 ? -size * 0.1 : 0);
      ctx.fillText(line, canvas.width / 2, y);
    });
    const tex = track(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const m = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    if (glow) m.color.setScalar(1.2);
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
  };
  return { mat, box, label };
}

function tag(kit, text, color = '#e0475b') {
  const t = kit.label(text, { w: 0.9, h: 0.22, bg: color, fg: '#ffffff', px: 78 });
  return t;
}

/* ---------- vending machine ---------- */
function parseSlot(slot) {
  const m = /^([A-Za-z])\s*(\d+)$/.exec(String(slot || '').trim());
  return m ? { row: m[1].toUpperCase().charCodeAt(0) - 65, col: Number(m[2]) - 1 } : null;
}

function buildVending(root, kit, data, pickables, drops) {
  const items = (data.items || []).map((it) => ({ ...it, pos: parseSlot(it.slot) })).filter((it) => it.pos);
  const rows = Math.max(6, ...items.map((i) => i.pos.row + 1));
  const cols = Math.max(items.length ? 4 : 8, ...items.map((i) => i.pos.col + 1));

  const W = 1.05, H = 1.85, D = 0.78;
  const body = kit.box(W, H, D, PAL.vending, 0.06);
  body.position.y = H / 2;
  root.add(body);
  const header = kit.label(['VENDING', 'MSC 1st floor'], { w: W * 0.86, h: 0.2, bg: '#6c55c9', fg: '#ffffff', px: 92 });
  header.position.set(0, H - 0.13, D / 2 + 0.002);
  root.add(header);

  // Window cavity.
  const winW = 0.66, winH = 1.26, winX = -0.15, winY = 0.36;
  const cavity = kit.box(winW, winH, 0.06, 0x4a3f7a, 0.02);
  cavity.position.set(winX, winY + winH / 2, D / 2 - 0.02);
  root.add(cavity);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(winW - 0.02, winH - 0.02),
    new THREE.MeshStandardMaterial({ color: PAL.glass, transparent: true, opacity: 0.16, roughness: 0.05 }));
  glass.position.set(winX, winY + winH / 2, D / 2 + 0.03);
  root.add(glass);

  // Side panel: keypad + card reader + coin slot.
  const panelX = 0.36;
  const screen = kit.label(data.working === 'n' ? 'OUT OF ORDER' : 'SELECT', { w: 0.24, h: 0.08, bg: '#1d2433', fg: data.working === 'n' ? '#ff7a8a' : '#7ff0b8', px: 88 });
  screen.position.set(panelX, 1.38, D / 2 + 0.003);
  root.add(screen);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) {
    const key = kit.box(0.055, 0.04, 0.02, PAL.steel, 0.01);
    key.position.set(panelX - 0.07 + c * 0.07, 1.22 - r * 0.06, D / 2 + 0.01);
    root.add(key);
  }
  const reader = kit.box(0.16, 0.11, 0.05, PAL.dark, 0.02);
  reader.position.set(panelX, 0.86, D / 2 + 0.02);
  root.add(reader);
  const readerLight = new THREE.Mesh(new THREE.CircleGeometry(0.012, 16), new THREE.MeshBasicMaterial({ color: 0x7ff0b8 }));
  readerLight.position.set(panelX + 0.05, 0.89, D / 2 + 0.046);
  root.add(readerLight);
  const coin = kit.box(0.1, 0.03, 0.02, PAL.steel, 0.008);
  coin.position.set(panelX, 0.72, D / 2 + 0.01);
  root.add(coin);
  const tray = kit.box(0.6, 0.16, 0.06, 0x2c254d, 0.03);
  tray.position.set(winX, 0.17, D / 2 - 0.01);
  root.add(tray);

  // Shelves, coils and products.
  const cellW = (winW - 0.06) / cols, cellH = (winH - 0.06) / rows;
  const coilGeo = new THREE.TorusGeometry(Math.min(cellW, cellH) * 0.26, 0.004, 6, 24);
  const coilMat = kit.mat(0xd7d9e6, { metalness: 0.4, roughness: 0.35 });
  const byPos = new Map(items.map((it) => [it.pos.row + ':' + it.pos.col, it]));
  for (let r = 0; r < rows; r++) {
    const y = winY + winH - 0.03 - cellH * (r + 1);
    const shelf = kit.box(winW - 0.04, 0.012, 0.36, 0xe9e6ff, 0.004);
    shelf.position.set(winX, y, D / 2 - 0.2);
    root.add(shelf);
    for (let c = 0; c < cols; c++) {
      const x = winX - winW / 2 + 0.03 + cellW * (c + 0.5);
      const coil = new THREE.Mesh(coilGeo, coilMat);
      coil.position.set(x, y + cellH * 0.32, D / 2 - 0.08);
      root.add(coil);
      const item = byPos.get(r + ':' + c);
      if (!item || String(item.sold_out).toLowerCase() === 'y') continue;
      const color = new THREE.Color().setHSL(hashHue(item.product), 0.55, 0.66);
      const mat = kit.mat(color, { emissive: 0x000000 });
      let mesh;
      if ((item.category || '').toLowerCase() === 'drink') {
        const rad = Math.min(cellW * 0.28, 0.03);
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, cellH * 0.62, 18), mat);
        mesh.position.set(x, y + cellH * 0.32 + 0.006, D / 2 - 0.08);
      } else {
        mesh = kit.box(cellW * 0.68, cellH * 0.6, 0.03, mat, 0.008);
        mesh.position.set(x, y + cellH * 0.31 + 0.006, D / 2 - 0.07);
      }
      mesh.userData.item = item;
      pickables.push(mesh);
      drops.push(mesh);
      root.add(mesh);
    }
  }
  if (!items.length) {
    const sign = kit.label(['Products not logged yet', 'read from our photos later'], { w: 0.95, h: 0.26, bg: '#fff7d6', fg: '#6b5a1e', px: 54 });
    sign.position.set(0, H + 0.28, 0.1);
    root.add(sign);
    drops.push(sign);
  }
  if (data.working === 'n') {
    const t = tag(kit, 'OUT OF ORDER');
    t.position.set(winX, winY + winH / 2, D / 2 + 0.04);
    t.rotation.z = -0.12;
    root.add(t);
  }
}

/* ---------- water filler ---------- */
function buildWater(root, kit, data, drops, spinners) {
  const wall = kit.box(1.5, 1.9, 0.08, PAL.wall, 0.03);
  wall.position.set(0, 0.95, -0.3);
  root.add(wall);
  const unit = kit.box(0.72, 0.92, 0.26, PAL.water, 0.06);
  unit.position.set(0, 1.25, -0.13);
  root.add(unit);
  const alcove = kit.box(0.46, 0.42, 0.1, PAL.waterDark, 0.04);
  alcove.position.set(0, 1.1, -0.02);
  root.add(alcove);
  const nozzle = kit.box(0.08, 0.05, 0.08, PAL.steel, 0.02);
  nozzle.position.set(0, 1.28, 0.02);
  root.add(nozzle);
  const counterText = Number.isFinite(data.counter) ? data.counter.toLocaleString('en-US') : '—';
  const display = kit.label([counterText, 'bottles saved'], { w: 0.5, h: 0.17, bg: '#10202f', fg: '#9ff3ff', px: 120 });
  display.position.set(0, 1.55, 0.002);
  root.add(display);
  drops.push(display);
  const lightColor = { green: PAL.green, yellow: PAL.yellow, red: PAL.red }[String(data.filter_light || '').toLowerCase()];
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.022, 16, 12), new THREE.MeshBasicMaterial({ color: lightColor || 0x9aa0b5 }));
  led.position.set(0.28, 1.6, 0.0);
  root.add(led);
  // Fountain below.
  const bowl = kit.box(0.92, 0.16, 0.46, PAL.steel, 0.06);
  bowl.position.set(0, 0.62, -0.06);
  root.add(bowl);
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, 0.04, 32), kit.mat(0xb8c6dd, { roughness: 0.3, metalness: 0.3 }));
  basin.position.set(0, 0.7, -0.04);
  root.add(basin);
  const post = kit.box(0.22, 0.54, 0.2, PAL.steel, 0.04);
  post.position.set(0, 0.27, -0.16);
  root.add(post);
  // Coldness: frost particles.
  if (Number(data.cold) >= 2) {
    const n = Number(data.cold) >= 3 ? 40 : 16;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * 0.5; pos[i * 3 + 1] = 0.9 + Math.random() * 0.4; pos[i * 3 + 2] = Math.random() * 0.2; }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.025, transparent: true, opacity: 0.85 }));
    root.add(pts);
    const base = pos.slice();
    spinners.push((t) => {
      if (reduced()) return;
      for (let i = 0; i < n; i++) pos[i * 3 + 1] = 0.9 + ((base[i * 3 + 1] - 0.9 + t * 0.00006 * (1 + (i % 3))) % 0.45);
      g.attributes.position.needsUpdate = true;
    });
  }
  if (data.working === 'n') {
    const t = tag(kit, 'OUT OF ORDER');
    t.position.set(0, 1.1, 0.06);
    t.rotation.z = -0.1;
    root.add(t);
  }
}

/* ---------- microwaves ---------- */
function buildMicrowaves(root, kit, data, drops) {
  const units = Math.max(1, Math.min(8, Number(data.units) || 1));
  const known = Number.isFinite(data.units_working);
  const working = known ? data.units_working : null;
  const W = units * 0.78 + 0.9;
  const counter = kit.box(W, 0.9, 0.7, PAL.counter, 0.05);
  counter.position.y = 0.45;
  root.add(counter);
  const top = kit.box(W + 0.06, 0.05, 0.76, PAL.counterTop, 0.02);
  top.position.y = 0.92;
  root.add(top);
  for (let i = 0; i < units; i++) {
    const g = new THREE.Group();
    const x = -W / 2 + 0.45 + i * 0.78 + 0.36;
    g.position.set(x, 0.95, 0);
    const shell = kit.box(0.68, 0.4, 0.46, PAL.microwave, 0.05);
    shell.position.y = 0.2;
    g.add(shell);
    const isOn = known ? i < working : null;
    const door = kit.box(0.44, 0.3, 0.02, 0x30344a, 0.03);
    door.position.set(-0.08, 0.2, 0.235);
    g.add(door);
    if (isOn) {
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.24), new THREE.MeshBasicMaterial({ color: 0xffe6a8, transparent: true, opacity: 0.35 }));
      glow.position.set(-0.08, 0.2, 0.248);
      g.add(glow);
    }
    const disp = kit.label(isOn === null ? '?' : isOn ? '0:00' : 'ERR', {
      w: 0.13, h: 0.06, bg: '#141824', fg: isOn === null ? '#8b90a8' : isOn ? '#7ff0b8' : '#ff7a8a', px: 220
    });
    disp.position.set(0.23, 0.31, 0.232);
    g.add(disp);
    for (let k = 0; k < 3; k++) {
      const b = kit.box(0.1, 0.03, 0.02, PAL.steel, 0.008);
      b.position.set(0.23, 0.22 - k * 0.05, 0.235);
      g.add(b);
    }
    if (isOn === false) {
      const xMat = new THREE.MeshBasicMaterial({ color: PAL.red });
      [0.6, -0.6].forEach((a) => {
        const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.03), xMat);
        bar.position.set(-0.08, 0.2, 0.25);
        bar.rotation.z = a;
        g.add(bar);
      });
    }
    root.add(g);
    drops.push(g);
  }
  const extras = (data.extras || []).map(String);
  const ex = W / 2 - 0.25;
  if (extras.includes('utensils')) {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.16, 20), kit.mat(0xc9f0dc));
    cup.position.set(ex, 1.03, 0.1);
    root.add(cup);
    for (let k = 0; k < 5; k++) {
      const fork = kit.box(0.012, 0.2, 0.012, 0xffffff, 0.004);
      fork.position.set(ex - 0.03 + k * 0.015, 1.12, 0.1 + (k % 2) * 0.02);
      fork.rotation.z = (k - 2) * 0.12;
      root.add(fork);
      drops.push(fork);
    }
    drops.push(cup);
  }
  if (extras.includes('napkins')) {
    for (let k = 0; k < 6; k++) {
      const n = kit.box(0.2, 0.012, 0.2, 0xffffff, 0.004);
      n.position.set(ex, 0.955 + k * 0.014, -0.16);
      n.rotation.y = (k % 2) * 0.08;
      root.add(n);
      drops.push(n);
    }
  }
}

/* ---------- printers ---------- */
function buildPrinters(root, kit, data, drops) {
  const units = Math.max(1, Math.min(6, Number(data.units) || 1));
  const workingCount = Number.isFinite(data.units_working) ? data.units_working : units;
  const broken = units - workingCount;
  const fromLeft = /left/i.test(String(data.broken_note || ''));
  const W = units * 0.8 + 0.4;
  const table = kit.box(W, 0.08, 0.75, PAL.table, 0.03);
  table.position.y = 0.74;
  root.add(table);
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
    const leg = kit.box(0.06, 0.72, 0.06, 0xa7d8bf, 0.02);
    leg.position.set(sx * (W / 2 - 0.08), 0.36, sz * 0.3);
    root.add(leg);
  });
  for (let i = 0; i < units; i++) {
    const isBroken = fromLeft ? i < broken : i >= units - broken;
    const g = new THREE.Group();
    g.position.set(-W / 2 + 0.6 + i * 0.8, 0.78, 0);
    const bodyP = kit.box(0.62, 0.34, 0.5, PAL.printer, 0.05);
    bodyP.position.y = 0.17;
    g.add(bodyP);
    const lid = kit.box(0.56, 0.04, 0.42, 0xdde0ea, 0.02);
    lid.position.y = 0.36;
    g.add(lid);
    const paper = kit.box(0.34, 0.01, 0.24, 0xffffff, 0.003);
    paper.position.set(0, 0.12, 0.3);
    paper.rotation.x = 0.25;
    g.add(paper);
    const screenP = kit.label(isBroken ? 'OUT OF ORDER' : 'READY', { w: 0.22, h: 0.07, bg: '#141824', fg: isBroken ? '#ff7a8a' : '#7ff0b8', px: 84 });
    screenP.position.set(0.15, 0.25, 0.252);
    g.add(screenP);
    if (isBroken) {
      const sheet = kit.label('✕', { w: 0.26, h: 0.26, bg: '#e0475b', fg: '#ffffff', px: 300 });
      sheet.rotation.x = -Math.PI / 2;
      sheet.position.set(0, 0.385, 0);
      g.add(sheet);
    }
    root.add(g);
    drops.push(g);
  }
}
