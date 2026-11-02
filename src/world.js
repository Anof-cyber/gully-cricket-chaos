import * as THREE from 'three';

// Layout constants shared with the game logic. The street runs along the Z axis:
// bowler far away at -Z, batter near the camera at +Z.
export const C = {
  HALF_W: 7, // houses start here; the ball bounces off them
  BOWL_Z: -8.2,
  BAT_X: -0.75,
  BAT_Z: 5.95,
  STUMP_Z: 6.9,
  BOUNDARY_Z: -17,
  END_Z: -62,
  BR: 0.1, // ball radius
  CONTACT: new THREE.Vector3(-0.3, 0.9, 4.7), // where the bat meets the ball
  BALCONY: new THREE.Vector3(6.1, 3.9, -6),
};

// ------------------------------------------------------------------ helpers
const rnd = (a, b) => a + Math.random() * (b - a);
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const shade = (n, k, a = 1) => {
  const r = Math.min(255, (((n >> 16) & 255) * k) | 0);
  const g = Math.min(255, (((n >> 8) & 255) * k) | 0);
  const b = Math.min(255, ((n & 255) * k) | 0);
  return `rgba(${r},${g},${b},${a})`;
};

const toonGrad = (() => {
  const t = new THREE.DataTexture(new Uint8Array([95, 150, 215, 255]), 4, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();
const toonCache = new Map();
const T = (c) => {
  if (!toonCache.has(c)) toonCache.set(c, new THREE.MeshToonMaterial({ color: c, gradientMap: toonGrad }));
  return toonCache.get(c);
};
const lamCache = new Map();
const L = (c) => {
  if (!lamCache.has(c)) lamCache.set(c, new THREE.MeshLambertMaterial({ color: c }));
  return lamCache.get(c);
};
const outlineCache = new Map();
const outlineMat = (t) => {
  if (!outlineCache.has(t)) {
    outlineCache.set(
      t,
      new THREE.ShaderMaterial({
        uniforms: { t: { value: t } },
        vertexShader: 'uniform float t; void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position + normal * t, 1.0); }',
        fragmentShader: 'void main(){ gl_FragColor = vec4(0.09, 0.055, 0.045, 1.0); }',
        side: THREE.BackSide,
      })
    );
  }
  return outlineCache.get(t);
};

function mk(geo, mat, x, y, z, parent, o = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = o.shadow !== false;
  m.receiveShadow = true;
  if (o.sx !== undefined || o.sy !== undefined || o.sz !== undefined) m.scale.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
  if (o.rx) m.rotation.x = o.rx;
  if (o.ry) m.rotation.y = o.ry;
  if (o.rz) m.rotation.z = o.rz;
  if (o.outline) {
    const ol = new THREE.Mesh(geo, outlineMat(o.outline));
    ol.castShadow = false;
    ol.receiveShadow = false;
    m.add(ol);
  }
  if (parent) parent.add(m);
  return m;
}
const capsule = (r, len, color, x, y, z, parent, o) => mk(new THREE.CapsuleGeometry(r, len, 5, 12), T(color), x, y, z, parent, { outline: 0.011, ...o });
const sphere = (r, color, x, y, z, parent, o) => mk(new THREE.SphereGeometry(r, 14, 10), T(color), x, y, z, parent, { outline: 0.011, ...o });
const cyl = (rt, rb, h, color, x, y, z, parent, o) => mk(new THREE.CylinderGeometry(rt, rb, h, 12), T(color), x, y, z, parent, o);
const box = (w, h, d, color, x, y, z, parent, o) => mk(new THREE.BoxGeometry(w, h, d), L(color), x, y, z, parent, o);

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function signMesh(text, { w = 2, h = 0.6, bg = '#fff', fg = '#111', size = 64, border = '#111' } = {}) {
  const tex = canvasTex(512, Math.round(512 * (h / w)), (g, cw, ch) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, cw, ch);
    g.strokeStyle = border;
    g.lineWidth = 10;
    g.strokeRect(5, 5, cw - 10, ch - 10);
    g.fillStyle = fg;
    g.font = `900 ${size}px Impact, 'Arial Black', sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, cw / 2, ch / 2 + 4, cw - 30);
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
  m.userData.sign = true;
  return m;
}

export function emojiSprite(ch, scale = 1.2) {
  const tex = canvasTex(128, 128, (g) => {
    g.font = '96px "Apple Color Emoji","Segoe UI Emoji",sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(ch, 64, 70);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, fog: false }));
  s.scale.set(scale, scale, 1);
  s.renderOrder = 10;
  return s;
}

// ------------------------------------------------------------------ realistic-proportion people & animals
// Smooth lathe-based limbs, shaped torso, real faces and fingered hands, lit with standard (PBR) materials.
const stdCache = new Map();
const SM = (c, r = 0.8) => {
  const k = c + '_' + r;
  if (!stdCache.has(k)) stdCache.set(k, new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0 }));
  return stdCache.get(k);
};
const taperCache = new Map();
// A tapered capsule along Y. r0 is the radius at the +Y end, r1 at the -Y end; end-cap centres sit at +-len/2.
function taperGeo(r0, r1, len) {
  const key = [r0, r1, len].join(',');
  if (taperCache.has(key)) return taperCache.get(key);
  const pts = [];
  const n = 5;
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 + (i / n) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.cos(a) * r1, -len / 2 + Math.sin(a) * r1));
  }
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.cos(a) * r0, len / 2 + Math.sin(a) * r0));
  }
  const g = new THREE.LatheGeometry(pts, 14);
  taperCache.set(key, g);
  return g;
}
function part(geo, color, x, y, z, parent, o = {}) {
  const m = new THREE.Mesh(geo, SM(color, o.rough ?? 0.8));
  m.position.set(x, y, z);
  m.castShadow = o.shadow !== false;
  m.receiveShadow = true;
  if (o.sx !== undefined || o.sy !== undefined || o.sz !== undefined) m.scale.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
  if (o.rx) m.rotation.x = o.rx;
  if (o.ry) m.rotation.y = o.ry;
  if (o.rz) m.rotation.z = o.rz;
  parent.add(m);
  return m;
}
const sph = (r, color, x, y, z, parent, o) => part(new THREE.SphereGeometry(r, 14, 10), color, x, y, z, parent, o);
const tap = (r0, r1, len, color, x, y, z, parent, o) => part(taperGeo(r0, r1, len), color, x, y, z, parent, o);

function numberPlate(n, color, bg) {
  const tex = canvasTex(64, 64, (g, w, h) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = color;
    g.font = '900 46px Impact, "Arial Black", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(n), w / 2, h / 2 + 3);
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
}

function addHair(head, style, hair) {
  const shell = (r, th = 0.56) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 12, 0, Math.PI * 2, 0, Math.PI * th), SM(hair, 0.55));
    m.position.set(0, 0.03, -0.012);
    m.scale.set(1, 1.12, 1.08);
    m.rotation.x = -0.35;
    m.castShadow = true;
    head.add(m);
  };
  if (style === 'bald') return;
  shell(0.116);
  if (style === 'spiky') {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      part(new THREE.ConeGeometry(0.02, 0.07, 6), hair, Math.cos(a) * 0.06, 0.125, Math.sin(a) * 0.06 - 0.01, head, { rx: Math.sin(a) * 0.5, rz: -Math.cos(a) * 0.5, rough: 0.55 });
    }
  } else if (style === 'pony') {
    sph(0.03, hair, 0, 0.1, -0.11, head, { rough: 0.55 });
    tap(0.03, 0.012, 0.16, hair, 0, -0.01, -0.145, head, { rx: 0.35, rough: 0.55 });
  } else if (style === 'long') {
    tap(0.095, 0.05, 0.26, hair, 0, -0.11, -0.085, head, { sz: 0.6, rough: 0.55 });
  } else if (style === 'bun') {
    sph(0.052, hair, 0, 0.1, -0.1, head, { rough: 0.55 });
  }
}

// Rig: legL/legR (hips), kneeL/kneeR, armL/armR (shoulders), elbowL/elbowR, handL/handR (hand centre),
// torso, head, root. The front of a person is +Z. Arm segment lengths used by IK: 0.29 + 0.33.
export function makePerson({ shirt = 0xd94f3d, accent = 0xffffff, pants = 0x2b3a67, skin = 0xc68a5c, hair = 0x1a1410, scale = 0.93, shorts = false, style = 'short', shoe = 0xf0f0f0, cap = null, number = null, skirt = null } = {}) {
  const g = new THREE.Group();
  const root = new THREE.Group();
  root.scale.setScalar(scale);
  g.add(root);
  const rig = { group: g, root };

  const mkLeg = (x) => {
    const hip = new THREE.Group();
    hip.position.set(x, 0.93, 0);
    root.add(hip);
    tap(0.1, 0.068, 0.44, pants, 0, -0.22, 0, hip, { rough: 0.9 });
    const knee = new THREE.Group();
    knee.position.set(0, -0.44, 0);
    hip.add(knee);
    tap(0.066, 0.045, 0.43, shorts ? skin : pants, 0, -0.215, 0, knee, { rough: shorts ? 0.65 : 0.9 });
    if (shorts) tap(0.043, 0.041, 0.1, accent, 0, -0.34, 0, knee, { rough: 0.9 }); // socks
    sph(0.06, shoe, 0, -0.468, 0.045, knee, { sx: 0.9, sy: 0.62, sz: 1.75, rough: 0.5 });
    sph(0.06, 0x232028, 0, -0.495, 0.045, knee, { sx: 0.95, sy: 0.28, sz: 1.8, rough: 0.9 });
    return { hip, knee };
  };
  const l = mkLeg(-0.095);
  const r = mkLeg(0.095);
  rig.legL = l.hip; rig.kneeL = l.knee; rig.legR = r.hip; rig.kneeR = r.knee;

  const torso = new THREE.Group();
  torso.position.set(0, 0.93, 0);
  root.add(torso);
  rig.torso = torso;
  const chest = new THREE.Mesh(
    new THREE.LatheGeometry([[0.001, -0.02], [0.14, 0], [0.15, 0.1], [0.143, 0.22], [0.158, 0.36], [0.184, 0.46], [0.172, 0.54], [0.09, 0.6], [0.001, 0.625]].map(([x, y]) => new THREE.Vector2(x, y)), 20),
    SM(shirt, 0.85)
  );
  chest.scale.set(1.1, 1, 0.74);
  chest.castShadow = true;
  torso.add(chest);
  const pelvis = new THREE.Mesh(new THREE.LatheGeometry([[0.001, -0.12], [0.17, -0.1], [0.172, 0.0], [0.15, 0.1], [0.001, 0.12]].map(([x, y]) => new THREE.Vector2(x, y)), 18), SM(pants, 0.9));
  pelvis.scale.set(1.08, 1, 0.78);
  pelvis.castShadow = true;
  torso.add(pelvis);
  mk(new THREE.TorusGeometry(0.15, 0.012, 6, 24), SM(accent, 0.8), 0, 0.075, 0, torso, { rx: Math.PI / 2, sz: 0.7, shadow: false });
  mk(new THREE.TorusGeometry(0.183, 0.014, 6, 24), SM(accent, 0.8), 0, 0.44, 0, torso, { rx: Math.PI / 2, sz: 0.68, shadow: false });
  if (number !== null) {
    const np = numberPlate(number, hex(accent), hex(shirt));
    np.position.set(0, 0.3, -0.118);
    np.rotation.y = Math.PI;
    torso.add(np);
  }
  part(new THREE.CylinderGeometry(0.046, 0.052, 0.11, 12), skin, 0, 0.66, 0, torso, { shadow: false, rough: 0.65 });
  mk(new THREE.TorusGeometry(0.058, 0.014, 6, 16), SM(accent, 0.8), 0, 0.625, 0, torso, { rx: Math.PI / 2, shadow: false });

  const head = new THREE.Group();
  head.position.set(0, 0.84, 0);
  torso.add(head);
  rig.head = head;
  sph(0.104, skin, 0, 0.02, -0.005, head, { sy: 1.12, sz: 1.06, rough: 0.6 });
  sph(0.082, skin, 0, -0.055, 0.018, head, { sy: 0.85, sz: 0.95, rough: 0.6 });
  sph(0.036, skin, 0, -0.112, 0.045, head, { sy: 0.7, sz: 0.9, rough: 0.6 });
  sph(0.02, skin, 0, -0.012, 0.108, head, { sx: 0.8, sy: 1.25, rough: 0.6 });
  for (const sx of [-1, 1]) {
    sph(0.015, 0xffffff, sx * 0.038, 0.025, 0.093, head, { sx: 1.25, sy: 0.8, sz: 0.6, rough: 0.3, shadow: false });
    sph(0.0085, 0x1a0e08, sx * 0.038, 0.025, 0.102, head, { rough: 0.2, shadow: false });
    part(new THREE.CapsuleGeometry(0.006, 0.03, 3, 6), hair === 0xdddddd ? 0x8a8a8a : hair, sx * 0.038, 0.053, 0.097, head, { rz: Math.PI / 2 + sx * 0.14, shadow: false });
    sph(0.022, skin, sx * 0.106, 0, 0, head, { sx: 0.5, sy: 1.1, sz: 0.85, rough: 0.6, shadow: false });
  }
  part(new THREE.CapsuleGeometry(0.0055, 0.03, 3, 6), 0x8a3b3b, 0, -0.06, 0.098, head, { rz: Math.PI / 2, shadow: false });
  addHair(head, style, hair);
  if (cap) {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), SM(cap, 0.7));
    dome.position.set(0, 0.04, -0.005);
    dome.scale.set(1, 1.05, 1.1);
    dome.castShadow = true;
    head.add(dome);
    part(new THREE.BoxGeometry(0.15, 0.012, 0.085), cap, 0, 0.05, 0.125, head, { shadow: false, rough: 0.7 });
  }

  const mkArm = (x) => {
    const sh = new THREE.Group();
    sh.position.set(x * 1.06, 0.5, 0);
    torso.add(sh);
    sph(0.056, shirt, 0, 0, 0, sh, { rough: 0.85 });
    tap(0.05, 0.043, 0.29, shirt, 0, -0.145, 0, sh, { rough: 0.85 });
    const el = new THREE.Group();
    el.position.set(0, -0.29, 0);
    sh.add(el);
    tap(0.043, 0.032, 0.26, skin, 0, -0.13, 0, el, { rough: 0.6 });
    mk(new THREE.TorusGeometry(0.036, 0.009, 6, 14), SM(accent, 0.8), 0, -0.22, 0, el, { rx: Math.PI / 2, shadow: false });
    const hand = new THREE.Group(); // wrist at y=-0.26, centre of the hand at y=-0.33
    hand.position.set(0, -0.33, 0);
    el.add(hand);
    sph(0.036, skin, 0, 0.005, 0, hand, { sx: 1, sy: 1.15, sz: 0.55, rough: 0.6 });
    for (let k = 0; k < 4; k++) tap(0.0085, 0.0075, 0.03, skin, (k - 1.5) * 0.0215, -0.055, 0.008, hand, { rx: -0.3, rough: 0.6, shadow: false });
    tap(0.01, 0.008, 0.03, skin, -Math.sign(x) * 0.04, -0.01, 0.01, hand, { rz: Math.sign(x) * 0.7, rough: 0.6, shadow: false });
    return { sh, el, hand };
  };
  const al = mkArm(-0.2);
  const ar = mkArm(0.2);
  rig.armL = al.sh; rig.elbowL = al.el; rig.handL = al.hand;
  rig.armR = ar.sh; rig.elbowR = ar.el; rig.handR = ar.hand;
  rig.elbowL.rotation.x = rig.elbowR.rotation.x = -0.15;
  rig.scale = scale;
  rig.opts = { shirt, pants, skin, shoe };

  if (skirt !== null) {
    const sk = new THREE.Mesh(new THREE.LatheGeometry([[0.001, 0.02], [0.17, 0], [0.2, -0.25], [0.25, -0.55], [0.28, -0.88]].map(([x, y]) => new THREE.Vector2(x, y)), 20), SM(skirt, 0.9));
    sk.position.y = 0.97;
    sk.scale.z = 0.85;
    sk.material = sk.material.clone();
    sk.material.side = THREE.DoubleSide;
    sk.castShadow = true;
    root.add(sk);
  }
  return rig;
}

// ---- dog (street dog, faces +X)
function makeDog() {
  const g = new THREE.Group();
  const fur = 0xc99a63;
  const light = 0xe9d3a8;
  const dark = 0x4d3220;
  tap(0.15, 0.125, 0.4, fur, 0, 0.56, 0, g, { rz: -Math.PI / 2, rough: 0.95 });
  sph(0.11, light, 0, 0.46, 0, g, { sx: 1.7, sy: 0.55, sz: 0.8, rough: 0.95 });
  tap(0.065, 0.09, 0.16, fur, 0.3, 0.68, 0, g, { rz: -0.8, rough: 0.95 });
  const head = new THREE.Group();
  head.position.set(0.4, 0.78, 0);
  g.add(head);
  sph(0.075, fur, 0, 0, 0, head, { sx: 1.15, sy: 0.95, sz: 0.9, rough: 0.95 });
  tap(0.03, 0.05, 0.1, light, 0.12, -0.025, 0, head, { rz: -Math.PI / 2, rough: 0.95 });
  sph(0.018, 0x111111, 0.18, -0.012, 0, head, { rough: 0.3 });
  for (const s of [-1, 1]) {
    sph(0.01, 0x111111, 0.06, 0.03, s * 0.045, head, { rough: 0.3 });
    sph(0.045, dark, -0.015, 0.05, s * 0.07, head, { sx: 0.35, sy: 1, sz: 0.7, rx: s * 0.5, rough: 0.95 });
  }
  const tail = new THREE.Group();
  tail.position.set(-0.24, 0.6, 0);
  g.add(tail);
  tap(0.024, 0.012, 0.3, fur, -0.12, 0.08, 0, tail, { rz: 1.0, rough: 0.95 });
  const legs = [];
  for (const [x, z] of [[0.2, 0.09], [0.2, -0.09], [-0.2, 0.09], [-0.2, -0.09]]) {
    const hip = new THREE.Group();
    hip.position.set(x, 0.5, z);
    g.add(hip);
    tap(0.05, 0.035, 0.2, fur, 0, -0.1, 0, hip, { rough: 0.95 });
    const knee = new THREE.Group();
    knee.position.set(0, -0.2, 0);
    hip.add(knee);
    tap(0.03, 0.022, 0.2, fur, 0, -0.1, 0, knee, { rough: 0.95 });
    sph(0.035, dark, 0.005, -0.225, 0.012, knee, { sy: 0.6, sz: 1.3, rough: 0.9 });
    hip.userData.knee = knee;
    legs.push(hip);
  }
  return { group: g, head, tail, legs };
}

// ---- cow (zebu with a marigold garland, faces +X)
function makeCow() {
  const g = new THREE.Group();
  const hide = 0xe4ddd0;
  const dark = 0x3a3431;
  const pink = 0xe0a39a;
  tap(0.4, 0.38, 1.0, hide, 0, 1.05, 0, g, { rz: -Math.PI / 2, rough: 0.95 });
  sph(0.2, hide, 0.52, 1.46, 0, g, { sy: 0.9, sz: 0.8, rough: 0.95 });
  tap(0.17, 0.26, 0.45, hide, 0.84, 1.2, 0, g, { rz: -1.0, rough: 0.95 });
  sph(0.16, hide, 0.82, 0.95, 0, g, { sx: 1.5, sz: 0.6, rough: 0.95 });
  sph(0.22, dark, 0.1, 1.15, 0.26, g, { sx: 1.2, sz: 0.3, rough: 0.95, shadow: false });
  sph(0.26, dark, -0.45, 1.2, -0.28, g, { sz: 0.3, rough: 0.95, shadow: false });
  sph(0.17, dark, -0.2, 1.3, 0.3, g, { sz: 0.3, rough: 0.95, shadow: false });
  const head = new THREE.Group();
  head.position.set(1.12, 1.17, 0);
  g.add(head);
  tap(0.075, 0.15, 0.4, hide, 0.15, -0.1, 0, head, { rz: -(Math.PI / 2 + 0.45), rough: 0.95 });
  sph(0.085, pink, 0.36, -0.28, 0, head, { sx: 1, sy: 0.8, sz: 1.05, rough: 0.7 });
  for (const s of [-1, 1]) {
    sph(0.015, 0x111111, 0.2, 0.03, s * 0.12, head, { rough: 0.2, shadow: false });
    sph(0.07, hide, -0.1, 0.1, s * 0.2, head, { sx: 1.1, sy: 0.28, sz: 0.65, rough: 0.95 });
    part(new THREE.TorusGeometry(0.09, 0.016, 6, 12, Math.PI * 0.85), 0xf3e7c6, -0.07, 0.2, s * 0.11, head, { rz: s * 0.2, ry: s * 0.4, rough: 0.6 });
  }
  mk(new THREE.TorusGeometry(0.26, 0.05, 8, 18), SM(0xffa500, 0.8), 0.86, 1.04, 0, g, { ry: Math.PI / 2 - 0.1 });
  const tail = new THREE.Group();
  tail.position.set(-0.9, 1.4, 0);
  g.add(tail);
  tap(0.03, 0.015, 0.8, hide, 0, -0.4, 0, tail, { rough: 0.95 });
  sph(0.07, dark, 0, -0.85, 0, tail, { sy: 1.4, sz: 0.8, rough: 0.95 });
  sph(0.12, pink, -0.3, 0.72, 0, g, { sy: 0.8, rough: 0.7 });
  const legs = [];
  for (const [x, z] of [[0.62, 0.22], [0.62, -0.22], [-0.6, 0.22], [-0.6, -0.22]]) {
    const hip = new THREE.Group();
    hip.position.set(x, 0.92, z);
    g.add(hip);
    tap(0.09, 0.06, 0.4, hide, 0, -0.2, 0, hip, { rough: 0.95 });
    const knee = new THREE.Group();
    knee.position.set(0, -0.4, 0);
    hip.add(knee);
    tap(0.052, 0.042, 0.38, hide, 0, -0.19, 0, knee, { rough: 0.95 });
    part(new THREE.CylinderGeometry(0.055, 0.06, 0.1, 10), dark, 0, -0.42, 0, knee, { rough: 0.9 });
    hip.userData.knee = knee;
    legs.push(hip);
  }
  return { group: g, head, tail, legs };
}

function makeScooter(color = 0x2a9d8f) {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  box(0.46, 0.16, 1.1, color, 0, 0.42, 0.0, body);
  box(0.4, 0.5, 0.5, color, 0, 0.68, -0.45, body); // rear cowl
  mk(new THREE.BoxGeometry(0.44, 0.1, 0.62), T(0x23201e), 0, 0.82, -0.1, body); // seat
  box(0.34, 0.7, 0.14, color, 0, 0.72, 0.52, body); // front shield
  cyl(0.02, 0.02, 0.62, 0x333333, 0, 1.05, 0.55, body).rotation.z = Math.PI / 2;
  sphere(0.07, 0xfff3b0, 0, 0.98, 0.66, body, { outline: 0 });
  for (const z of [0.62, -0.58]) {
    const w = cyl(0.25, 0.25, 0.14, 0x1c1c1c, 0, 0.25, z, g, { outline: 0 });
    w.rotation.z = Math.PI / 2;
    const hub = cyl(0.09, 0.09, 0.16, 0xbfbfbf, 0, 0.25, z, g);
    hub.rotation.z = Math.PI / 2;
  }
  return g;
}

function makeTeaCart() {
  const g = new THREE.Group();
  box(1.4, 0.7, 1.0, 0x8b5a2b, 0, 0.58, 0, g);
  box(1.5, 0.08, 1.1, 0xc98a4b, 0, 0.96, 0, g);
  for (const z of [0.56, -0.56]) cyl(0.4, 0.4, 0.1, 0x222222, 0, 0.4, z, g).rotation.x = Math.PI / 2;
  for (let i = 0; i < 6; i++) box(0.26, 0.05, 1.45, i % 2 ? 0xffffff : 0xe63946, -0.65 + i * 0.26, 2.15 - Math.abs(i - 2.5) * 0.04, 0, g);
  for (const [x, z] of [[-0.65, -0.55], [0.65, -0.55], [-0.65, 0.55], [0.65, 0.55]]) box(0.05, 1.2, 0.05, 0x555555, x, 1.55, z, g);
  capsule(0.17, 0.2, 0xc0c7cc, -0.3, 1.24, 0, g, { outline: 0.008 });
  for (let i = 0; i < 4; i++) cyl(0.05, 0.04, 0.12, 0xffe9b0, 0.1 + i * 0.14, 1.06, 0.15, g);
  const sign = signMesh('CHAI', { w: 1.2, h: 0.4, bg: '#ffd23f', fg: '#b71c1c', size: 90 });
  sign.position.set(0, 0.7, 0.57);
  g.add(sign);
  return g;
}

function makeTree(s = 1) {
  const g = new THREE.Group();
  cyl(0.14 * s, 0.22 * s, 3.4 * s, 0x6b4a33, 0, 1.7 * s, 0, g);
  const greens = [0x4f8a3a, 0x3f7a33, 0x5f9a45, 0x468238];
  const blobs = [[0, 4.2, 0, 1.5], [0.9, 3.5, 0.2, 1.1], [-0.9, 3.6, -0.1, 1.15], [0.2, 5.1, 0.1, 1.0], [-0.1, 3.4, 0.9, 1.0], [0.1, 3.5, -0.9, 1.0]];
  blobs.forEach(([x, y, z, r], i) => {
    const m = mk(new THREE.IcosahedronGeometry(r * s, 1), T(greens[i % 4]), x * s, y * s, z * s, g);
    m.castShadow = true;
  });
  return g;
}

function makePole(scene, x, z) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  cyl(0.1, 0.14, 8, 0x5b4636, 0, 4, 0, g);
  box(1.8, 0.12, 0.12, 0x4a3a2d, 0, 7.4, 0, g);
  for (const dx of [-0.8, 0, 0.8]) sphere(0.06, 0xdddddd, dx, 7.55, 0, g, { outline: 0 });
  box(0.5, 0.7, 0.4, 0x6b6f73, 0.3, 5.6, 0.2, g);
  scene.add(g);
}

// ------------------------------------------------------------------ night-time facades
function facade(len, h, base) {
  const px = 32;
  const w = Math.max(128, Math.round(len * px));
  const hh = Math.round(h * px);
  const cm = document.createElement('canvas');
  cm.width = w;
  cm.height = hh;
  const g = cm.getContext('2d');
  const cg = document.createElement('canvas');
  cg.width = w;
  cg.height = hh;
  const gg = cg.getContext('2d'); // emissive map: only the lit parts
  gg.fillStyle = '#000';
  gg.fillRect(0, 0, w, hh);

  g.fillStyle = hex(base);
  g.fillRect(0, 0, w, hh);
  for (let i = 0; i < (w * hh) / 80; i++) {
    g.fillStyle = Math.random() < 0.5 ? shade(base, 0.86, 0.28) : shade(base, 1.14, 0.22);
    g.fillRect(rnd(0, w), rnd(0, hh), rnd(2, 7), rnd(2, 7));
  }
  for (let i = 0; i < w / 6; i++) {
    g.fillStyle = 'rgba(20,10,40,0.08)';
    g.fillRect(rnd(0, w), 0, rnd(1, 3), rnd(hh * 0.2, hh * 0.8));
  }
  const bottom = g.createLinearGradient(0, hh - 1.4 * px, 0, hh);
  bottom.addColorStop(0, 'rgba(20,10,40,0)');
  bottom.addColorStop(1, 'rgba(20,10,40,0.5)');
  g.fillStyle = bottom;
  g.fillRect(0, hh - 1.4 * px, w, 1.4 * px);

  const floors = Math.floor((h - 1.2) / 3.2);
  for (let f = 1; f <= floors; f++) {
    const yLine = hh - f * 3.2 * px;
    g.fillStyle = shade(base, 0.62, 0.7);
    g.fillRect(0, yLine - 4, w, 8);
    // zig-zag trim like painted mohalla borders
    g.fillStyle = 'rgba(255,255,255,0.55)';
    for (let x = 0; x < w; x += 16) {
      g.beginPath();
      g.moveTo(x, yLine + 4);
      g.lineTo(x + 8, yLine + 14);
      g.lineTo(x + 16, yLine + 4);
      g.fill();
    }
    const n = Math.max(1, Math.floor(len / 3.4));
    const sp = w / n;
    for (let i = 0; i < n; i++) {
      const cx = sp * (i + 0.5) + rnd(-4, 4);
      const cy = hh - (f * 3.2 + 1.65) * px;
      archWindow(g, gg, cx, cy, 1.15 * px, 1.7 * px, Math.random() < 0.62, base);
    }
  }
  // roof band
  g.fillStyle = shade(base, 1.25, 0.95);
  g.fillRect(0, 0, w, 0.4 * px);
  g.fillStyle = 'rgba(255,255,255,0.7)';
  for (let x = 4; x < w; x += 14) g.fillRect(x, 0.1 * px, 7, 0.14 * px);
  const mkTex = (c) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  return { map: mkTex(cm), glow: mkTex(cg) };
}

function archPath(g, x, y, w, h) {
  g.beginPath();
  g.moveTo(x, y + h);
  g.lineTo(x, y + w / 2);
  g.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0);
  g.lineTo(x + w, y + h);
  g.closePath();
}

function archWindow(g, gg, cx, cy, ww, wh, lit, base) {
  const x = cx - ww / 2;
  const y = cy - wh / 2;
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(x - 6, y + wh + 2, ww + 12, 6);
  archPath(g, x - 5, y - 5, ww + 10, wh + 10);
  g.fillStyle = '#fff3d6';
  g.fill();
  archPath(g, x, y, ww, wh);
  if (lit) {
    const gr = g.createLinearGradient(0, y, 0, y + wh);
    gr.addColorStop(0, '#ffe9a8');
    gr.addColorStop(1, '#ff9f45');
    g.fillStyle = gr;
  } else {
    const gr = g.createLinearGradient(0, y, 0, y + wh);
    gr.addColorStop(0, '#34437a');
    gr.addColorStop(1, '#10163a');
    g.fillStyle = gr;
  }
  g.fill();
  if (lit) {
    archPath(gg, x, y, ww, wh);
    gg.fillStyle = 'rgba(255,170,70,0.85)';
    gg.fill();
    // a person silhouette inside some lit windows
    if (Math.random() < 0.4) {
      g.fillStyle = 'rgba(60,20,10,0.75)';
      g.beginPath();
      g.arc(cx + rnd(-6, 6), y + wh * 0.55, ww * 0.12, 0, Math.PI * 2);
      g.fill();
      g.fillRect(cx - ww * 0.15, y + wh * 0.62, ww * 0.3, wh * 0.4);
    }
  }
  g.fillStyle = '#fff3d6';
  g.fillRect(cx - 2, y + ww / 2, 4, wh - ww / 2);
  g.fillRect(x, y + wh * 0.55, ww, 4);
  if (lit) {
    gg.fillStyle = '#000';
    gg.fillRect(cx - 2, y + ww / 2, 4, wh - ww / 2);
    gg.fillRect(x, y + wh * 0.55, ww, 4);
  }
  // little marigold garland over some windows
  if (Math.random() < 0.35) {
    for (let k = 0; k < 7; k++) {
      g.fillStyle = k % 2 ? '#ff9a1f' : '#ffc233';
      g.beginPath();
      g.arc(x - 2 + (k * (ww + 4)) / 6, y - 8 + Math.sin((k / 6) * Math.PI) * 7, 4, 0, Math.PI * 2);
      g.fill();
    }
  }
}

function makeWindow() {
  const g = new THREE.Group();
  box(0.2, 1.5, 1.7, 0xfff3d6, 0, 0, 0, g);
  box(0.05, 1.2, 1.4, 0x1b1230, 0.1, 0, 0, g, { shadow: false });
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(0.03, 1.2, 1.4),
    new THREE.MeshStandardMaterial({ color: 0xffd08a, emissive: 0xff9a3c, emissiveIntensity: 0.9, transparent: true, opacity: 0.8, roughness: 0.2 })
  );
  glass.position.x = 0.13;
  g.add(glass);
  for (let i = 0; i < 6; i++) cyl(0.015, 0.015, 1.2, 0x2a1f3a, 0.17, 0, -0.62 + i * 0.248, g);
  for (const y of [-0.3, 0.3]) cyl(0.015, 0.015, 1.4, 0x2a1f3a, 0.17, y, 0, g).rotation.x = Math.PI / 2;
  box(0.34, 0.08, 1.95, 0xe7d8b8, 0.08, -0.8, 0, g);
  g.userData.glass = glass;
  return g;
}

// ------------------------------------------------------------------ vehicles (for the traffic that passes through the gully)
let _glowTex = null;
function lightSprite(color, size) {
  if (!_glowTex) _glowTex = glowTexture();
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: _glowTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9 }));
  s.scale.set(size, size, 1);
  return s;
}
function wheelNode(r, w, parent, x, y, z, tire = 0x141416) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  part(new THREE.CylinderGeometry(r, r, w, 22), tire, 0, 0, 0, g, { rz: Math.PI / 2, rough: 0.95 });
  part(new THREE.CylinderGeometry(r * 0.56, r * 0.56, w + 0.012, 14), 0xb9b9c6, 0, 0, 0, g, { rz: Math.PI / 2, rough: 0.35 });
  parent.add(g);
  return { g, r };
}
function lamp(parent, x, y, z, color, glow = 0.7) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshBasicMaterial({ color }));
  m.position.set(x, y, z);
  parent.add(m);
  const s = lightSprite(color, glow);
  s.position.set(x, y, z);
  parent.add(s);
}

export function makeVehicle(kind, color) {
  const g = new THREE.Group();
  const wheels = [];
  const v = { group: g, wheels, kind, seat: new THREE.Vector3(), hands: { L: new THREE.Vector3(), R: new THREE.Vector3() }, len: 2, rider: true };
  const B = (w, h, d, c, x, y, z, o) => part(new THREE.BoxGeometry(w, h, d), c, x, y, z, g, o);
  if (kind === 'scooter') {
    const c = color ?? 0x2f9ea0;
    B(0.46, 0.08, 1.05, c, 0, 0.3, 0.05, { rough: 0.5 });
    B(0.42, 0.52, 0.56, c, 0, 0.62, -0.45, { rough: 0.5 });
    part(new THREE.SphereGeometry(0.27, 14, 10), c, 0, 0.64, -0.68, g, { sx: 0.9, sy: 1.0, sz: 1.2, rough: 0.5 });
    B(0.4, 0.72, 0.1, c, 0, 0.72, 0.46, { rx: -0.22, rough: 0.5 });
    B(0.32, 0.3, 0.32, c, 0, 1.12, 0.52, { rough: 0.5 });
    part(new THREE.CylinderGeometry(0.02, 0.02, 0.66, 8), 0x222226, 0, 1.2, 0.52, g, { rz: Math.PI / 2, rough: 0.4 });
    B(0.42, 0.1, 0.58, 0x1b1b1f, 0, 0.9, -0.2, { rough: 0.9 });
    lamp(g, 0, 1.06, 0.7, 0xfff1c0, 1.4);
    lamp(g, 0, 0.8, -1.0, 0xff2a2a, 0.5);
    wheels.push(wheelNode(0.21, 0.1, g, 0, 0.21, 0.58), wheelNode(0.21, 0.1, g, 0, 0.21, -0.55));
    v.seat.set(0, 0.92, -0.2);
    v.hands.L.set(-0.31, 1.2, 0.52);
    v.hands.R.set(0.31, 1.2, 0.52);
    v.len = 1.9;
  } else if (kind === 'bike') {
    const c = color ?? 0xc0262d;
    part(new THREE.CapsuleGeometry(0.12, 0.34, 6, 12), c, 0, 0.98, 0.12, g, { rx: Math.PI / 2, rough: 0.35 });
    B(0.3, 0.1, 0.62, 0x1b1b1f, 0, 0.92, -0.32, { rough: 0.9 });
    B(0.28, 0.3, 0.36, 0x37373d, 0, 0.55, 0.05, { rough: 0.5 });
    part(new THREE.CylinderGeometry(0.04, 0.05, 0.7, 10), 0x9a9aa6, 0.2, 0.42, -0.35, g, { rx: Math.PI / 2, rough: 0.3 });
    for (const sx of [-1, 1]) part(new THREE.CylinderGeometry(0.018, 0.018, 0.78, 8), 0x9a9aa6, sx * 0.07, 0.72, 0.62, g, { rx: 0.35, rough: 0.3 });
    part(new THREE.CylinderGeometry(0.02, 0.02, 0.66, 8), 0x222226, 0, 1.2, 0.5, g, { rz: Math.PI / 2, rough: 0.4 });
    B(0.22, 0.12, 0.34, c, 0, 0.78, -0.72, { rough: 0.5 });
    lamp(g, 0, 1.08, 0.7, 0xfff1c0, 1.5);
    lamp(g, 0, 0.84, -0.95, 0xff2a2a, 0.5);
    wheels.push(wheelNode(0.32, 0.12, g, 0, 0.32, 0.65), wheelNode(0.32, 0.14, g, 0, 0.32, -0.62));
    v.seat.set(0, 0.98, -0.3);
    v.hands.L.set(-0.31, 1.2, 0.5);
    v.hands.R.set(0.31, 1.2, 0.5);
    v.len = 2.0;
  } else if (kind === 'auto') {
    const body = 0xf2c230;
    B(1.2, 0.5, 1.9, body, 0, 0.6, -0.2, { rough: 0.5 });
    part(new THREE.SphereGeometry(0.5, 16, 12), body, 0, 0.72, 0.8, g, { sx: 1.1, sy: 0.62, sz: 1.5, rough: 0.5 });
    B(0.7, 0.55, 0.9, body, 0, 0.95, 0.55, { rough: 0.5 });
    B(1.25, 0.08, 1.35, 0x1b1b1f, 0, 1.62, -0.55, { rough: 0.9 });
    for (const [x, z] of [[-0.58, -1.15], [0.58, -1.15], [-0.58, -0.1], [0.58, -0.1]]) part(new THREE.CylinderGeometry(0.02, 0.02, 1.0, 8), 0x2a2a30, x, 1.1, z, g, { rough: 0.5 });
    B(1.2, 0.5, 0.05, 0x1b1b1f, 0, 1.15, -1.15, { rough: 0.9 }); // rear canvas
    B(1.1, 0.12, 0.6, 0x2b2b30, 0, 0.9, -0.55, { rough: 0.9 }); // passenger bench
    part(new THREE.PlaneGeometry(1.0, 0.5), 0x9fc3d6, 0, 1.35, 0.28, g, { rx: -0.3, rough: 0.2, shadow: false });
    part(new THREE.CylinderGeometry(0.02, 0.02, 0.62, 8), 0x222226, 0, 1.08, 0.88, g, { rz: Math.PI / 2, rough: 0.4 });
    B(0.5, 0.14, 0.4, 0x2b2b30, 0, 0.85, 0.35, { rough: 0.9 }); // driver seat
    lamp(g, 0, 0.78, 1.38, 0xfff1c0, 1.6);
    lamp(g, -0.5, 0.72, -1.17, 0xff2a2a, 0.5);
    lamp(g, 0.5, 0.72, -1.17, 0xff2a2a, 0.5);
    wheels.push(wheelNode(0.27, 0.12, g, 0, 0.27, 1.12), wheelNode(0.27, 0.12, g, -0.64, 0.27, -0.75), wheelNode(0.27, 0.12, g, 0.64, 0.27, -0.75));
    v.seat.set(0, 0.95, 0.38);
    v.hands.L.set(-0.31, 1.12, 0.9);
    v.hands.R.set(0.31, 1.12, 0.9);
    v.len = 2.9;
  } else if (kind === 'cycle') {
    const c = color ?? 0x2a5db0;
    const bar = (x1, y1, z1, x2, y2, z2, r = 0.018) => {
      const a = new THREE.Vector3(x1, y1, z1);
      const b = new THREE.Vector3(x2, y2, z2);
      const m = part(new THREE.CylinderGeometry(r, r, a.distanceTo(b), 6), c, 0, 0, 0, g, { rough: 0.4 });
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    };
    bar(0, 0.34, 0.55, 0, 0.85, 0.2);
    bar(0, 0.85, 0.2, 0, 0.9, -0.15);
    bar(0, 0.34, -0.55, 0, 0.9, -0.15);
    bar(0, 0.34, 0.55, 0, 0.34, -0.55);
    bar(0, 0.34, 0.05, 0, 0.85, 0.2);
    bar(0, 1.0, 0.45, 0, 0.34, 0.55);
    part(new THREE.CylinderGeometry(0.018, 0.018, 0.5, 8), 0x222226, 0, 1.03, 0.4, g, { rz: Math.PI / 2, rough: 0.4 });
    B(0.1, 0.05, 0.26, 0x1b1b1f, 0, 0.93, -0.15, { rough: 0.9 });
    lamp(g, 0, 0.98, 0.5, 0xfff1c0, 0.6);
    for (const z of [0.55, -0.55]) {
      const w = new THREE.Group();
      w.position.set(0, 0.34, z);
      part(new THREE.TorusGeometry(0.33, 0.02, 8, 28), 0x141416, 0, 0, 0, w, { ry: Math.PI / 2, rough: 0.9 });
      for (let k = 0; k < 6; k++) part(new THREE.CylinderGeometry(0.004, 0.004, 0.64, 4), 0xd0d0d8, 0, 0, 0, w, { rx: (k / 6) * Math.PI, rough: 0.4, shadow: false });
      g.add(w);
      wheels.push({ g: w, r: 0.34 });
    }
    v.seat.set(0, 0.97, -0.15);
    v.hands.L.set(-0.25, 1.03, 0.4);
    v.hands.R.set(0.25, 1.03, 0.4);
    v.len = 1.7;
  } else {
    // hatchback
    const c = color ?? 0xd7d9e0;
    B(1.65, 0.55, 3.5, c, 0, 0.6, 0, { rough: 0.3 });
    B(1.5, 0.5, 1.9, c, 0, 1.1, -0.2, { rough: 0.3 });
    B(1.52, 0.38, 1.7, 0x2a3a48, 0, 1.12, -0.2, { rough: 0.1, shadow: false });
    B(1.6, 0.14, 0.6, c, 0, 0.9, 1.3, { rough: 0.3 });
    lamp(g, -0.6, 0.72, 1.76, 0xfff1c0, 1.4);
    lamp(g, 0.6, 0.72, 1.76, 0xfff1c0, 1.4);
    lamp(g, -0.6, 0.78, -1.76, 0xff2a2a, 0.7);
    lamp(g, 0.6, 0.78, -1.76, 0xff2a2a, 0.7);
    for (const [x, z] of [[-0.82, 1.1], [0.82, 1.1], [-0.82, -1.1], [0.82, -1.1]]) wheels.push(wheelNode(0.3, 0.2, g, x, 0.3, z));
    v.rider = false;
    v.len = 3.6;
  }
  return v;
}

// ------------------------------------------------------------------ the whole scene: a Diwali night in the mohalla
function glowTexture() {
  return canvasTex(64, 64, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, w, h);
  });
}

function rangoliTexture() {
  return canvasTex(512, 512, (g, w, h) => {
    g.translate(w / 2, h / 2);
    const cols = ['#ff3d8b', '#ffc233', '#2de2c8', '#ff7a1a', '#7c4dff', '#ffffff'];
    const rings = [240, 205, 170, 130, 95, 55, 22];
    rings.forEach((r, i) => {
      const n = 12 + (i % 3) * 4;
      for (let k = 0; k < n; k++) {
        g.save();
        g.rotate((k / n) * Math.PI * 2);
        g.fillStyle = cols[(i + k) % cols.length];
        g.beginPath();
        g.moveTo(0, -r);
        g.quadraticCurveTo(r * 0.2, -r * 0.82, 0, -r * 0.62);
        g.quadraticCurveTo(-r * 0.2, -r * 0.82, 0, -r);
        g.fill();
        g.fillStyle = '#fff';
        g.beginPath();
        g.arc(0, -r * 1.04, 3.2, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
    });
    g.fillStyle = '#ffc233';
    g.beginPath();
    g.arc(0, 0, 14, 0, Math.PI * 2);
    g.fill();
  });
}

export function buildWorld(scene) {
  const W = { people: [] };
  const glowTex = glowTexture();

  // ---- dusk sky with stars and a moon
  scene.background = canvasTex(512, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#0d0a2e');
    gr.addColorStop(0.45, '#3a1c70');
    gr.addColorStop(0.8, '#c4457a');
    gr.addColorStop(1, '#ff8a5c');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 160; i++) {
      g.fillStyle = `rgba(255,255,255,${rnd(0.3, 0.95)})`;
      g.fillRect(rnd(0, w), rnd(0, h * 0.6), rnd(1, 2.2), rnd(1, 2.2));
    }
    const m = g.createRadialGradient(w * 0.78, h * 0.18, 0, w * 0.78, h * 0.18, 60);
    m.addColorStop(0, 'rgba(255,248,220,1)');
    m.addColorStop(0.2, 'rgba(255,248,220,0.95)');
    m.addColorStop(0.24, 'rgba(255,230,180,0.3)');
    m.addColorStop(1, 'rgba(255,230,180,0)');
    g.fillStyle = m;
    g.fillRect(0, 0, w, h);
  });
  scene.fog = new THREE.Fog(0x3b1d63, 26, 88);

  const hemi = new THREE.HemisphereLight(0xb4a8ff, 0x6a4058, 1.6);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffe6c0, 2.8); // floodlights
  key.position.set(-6, 16, 10);
  key.target.position.set(0, 0, -4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -15, right: 15, top: 24, bottom: -24, near: 1, far: 60 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.03;
  scene.add(key, key.target);
  const pointLights = [];
  const rim = new THREE.DirectionalLight(0x7b8cff, 0.9);
  rim.position.set(9, 8, -14);
  scene.add(rim);
  for (const z of [6, -4, -13]) {
    const pl = new THREE.PointLight(0xffa55a, 22, 15, 2);
    pl.position.set(0, 5.5, z);
    scene.add(pl);
    pointLights.push(pl);
  }

  // ---- paved road with painted kerbs
  const roadTex = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#4b4058';
    g.fillRect(0, 0, w, h);
    const cell = 64;
    for (let y = 0; y < h; y += cell / 2) {
      for (let x = (y / (cell / 2)) % 2 ? -cell / 2 : 0; x < w; x += cell) {
        const v = rnd(0.85, 1.18);
        g.fillStyle = `rgba(${(112 * v) | 0},${(98 * v) | 0},${(122 * v) | 0},1)`;
        g.fillRect(x + 2, y + 2, cell - 4, cell / 2 - 4);
      }
    }
    for (let i = 0; i < 5000; i++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,.1)' : 'rgba(255,255,255,.06)';
      g.fillRect(rnd(0, w), rnd(0, h), rnd(1, 3), rnd(1, 3));
    }
  });
  roadTex.wrapS = roadTex.wrapT = THREE.RepeatWrapping;
  roadTex.repeat.set(1.6, 7);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(14, 80), new THREE.MeshLambertMaterial({ map: roadTex }));
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0, -23);
  road.receiveShadow = true;
  scene.add(road);

  const kerbTex = canvasTex(64, 128, (g, w, h) => {
    g.fillStyle = '#1b1230';
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 32) {
      g.fillStyle = '#ffc233';
      g.fillRect(0, y, w, 16);
    }
  });
  kerbTex.wrapS = kerbTex.wrapT = THREE.RepeatWrapping;
  kerbTex.repeat.set(1, 40);
  for (const s of [-1, 1]) {
    box(1.5, 0.16, 80, 0x8a7a9a, s * 6.25, 0.08, -23, scene, { shadow: false });
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.2, 80), new THREE.MeshLambertMaterial({ map: kerbTex }));
    edge.position.set(s * 5.5, 0.1, -23);
    scene.add(edge);
  }

  // ---- rangoli on the road
  const rangTex = rangoliTexture();
  for (const [z, r] of [[-2.3, 2.8], [-9.9, 1.9]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2), new THREE.MeshBasicMaterial({ map: rangTex, transparent: true, opacity: 0.92, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = rnd(0, 6);
    m.position.set(0, 0.014, z);
    scene.add(m);
  }

  const chalk = (z, w, thick = 0.07, color = 0xffffff, x = 0, op = 0.9) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, thick), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.018, z);
    scene.add(m);
  };
  chalk(5.1, 2.8);
  chalk(-9.7, 2.8);
  // boundary: a dotted line of marigold petals
  for (let x = -5.4; x <= 5.4; x += 0.7) chalk(C.BOUNDARY_Z, 0.34, 0.12, x % 1.4 < 0.7 ? 0xffc233 : 0xff7a1a, x, 1);

  // ---- diyas (clay lamps) along the kerbs, around the rangoli and as crease markers
  const diyaPos = [];
  for (let z = 13; z > -56; z -= 2.6) {
    diyaPos.push([-5.75, z], [5.75, z]);
  }
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    diyaPos.push([Math.cos(a) * 3.3, -2.3 + Math.sin(a) * 3.3]);
  }
  diyaPos.push([-1.7, 5.1], [1.6, 5.4]);
  const diyaBowls = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.11, 0.07, 0.06, 8), new THREE.MeshLambertMaterial({ color: 0xc2571a }), diyaPos.length);
  const diyaFlames = new THREE.InstancedMesh(new THREE.ConeGeometry(0.03, 0.12, 6), new THREE.MeshBasicMaterial({ color: 0xffe08a }), diyaPos.length);
  const diyaGlowPos = new Float32Array(diyaPos.length * 3);
  const dm = new THREE.Matrix4();
  diyaPos.forEach(([x, z], i) => {
    const y = Math.abs(x) > 5 ? 0.19 : 0.03;
    dm.makeTranslation(x, y, z);
    diyaBowls.setMatrixAt(i, dm);
    dm.makeTranslation(x, y + 0.1, z);
    diyaFlames.setMatrixAt(i, dm);
    diyaGlowPos.set([x, y + 0.12, z], i * 3);
  });
  scene.add(diyaBowls, diyaFlames);
  const diyaGlowGeo = new THREE.BufferGeometry();
  diyaGlowGeo.setAttribute('position', new THREE.BufferAttribute(diyaGlowPos, 3));
  const diyaGlow = new THREE.Points(diyaGlowGeo, new THREE.PointsMaterial({ size: 0.9, map: glowTex, color: 0xffa23c, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  diyaGlow.frustumCulled = false;
  scene.add(diyaGlow);

  // ---- houses
  const pal = { rose: 0xe0628f, teal: 0x34aaa6, gold: 0xe7a92f, lav: 0x8f72d6, coral: 0xe8784f, mint: 0x5fc08a, sky: 0x4f9fe0, peach: 0xf2a37a };
  const houses = [
    { side: -1, z0: 16, z1: 6, h: 10, c: pal.sky },
    { side: -1, z0: 6, z1: -4.2, h: 9.5, c: pal.rose },
    { side: -1, z0: -4.2, z1: -15, h: 11, c: pal.gold },
    { side: -1, z0: -15, z1: -27, h: 10, c: pal.lav },
    { side: -1, z0: -27, z1: -42, h: 12, c: pal.teal },
    { side: -1, z0: -42, z1: -64, h: 11, c: pal.coral },
    { side: 1, z0: 16, z1: 5, h: 10.5, c: pal.mint },
    { side: 1, z0: 5, z1: -3.4, h: 9, c: pal.coral },
    { side: 1, z0: -3.4, z1: -12.4, h: 12, c: pal.lav },
    { side: 1, z0: -12.4, z1: -25, h: 10, c: pal.gold },
    { side: 1, z0: -25, z1: -42, h: 11, c: pal.rose },
    { side: 1, z0: -42, z1: -64, h: 12, c: pal.teal },
  ];
  const faceMats = [];
  const addChhatri = (x, y, z) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    for (const [dx, dz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) cyl(0.07, 0.07, 1.3, 0xfff3d6, dx, 0.65, dz, g);
    const dome = mk(new THREE.SphereGeometry(0.95, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), T(0xffc233), 0, 1.3, 0, g, { outline: 0 });
    void dome;
    cyl(0.02, 0.02, 0.5, 0xffc233, 0, 2.5, 0, g);
    scene.add(g);
  };
  for (const hs of houses) {
    const len = hs.z0 - hs.z1;
    const depth = 8;
    const { map, glow } = facade(len, hs.h, hs.c);
    const plain = new THREE.MeshLambertMaterial({ color: hs.c });
    const face = new THREE.MeshLambertMaterial({ map, emissiveMap: glow, emissive: 0xffffff });
    faceMats.push(face);
    const mats = [plain, plain, plain, plain, plain, plain];
    mats[hs.side === -1 ? 0 : 1] = face;
    const m = new THREE.Mesh(new THREE.BoxGeometry(depth, hs.h, len), mats);
    m.position.set(hs.side * (C.HALF_W + depth / 2), hs.h / 2, (hs.z0 + hs.z1) / 2);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    const zc = (hs.z0 + hs.z1) / 2;
    addChhatri(hs.side * (C.HALF_W + 1.2), hs.h, zc + len * 0.25);
    cyl(0.7, 0.7, 1.1, 0x1c1c2a, hs.side * (C.HALF_W + 3.8), hs.h + 0.55, zc - 1);
  }

  // ---- details on the walls
  const wallX = (side, off = 0) => side * (C.HALF_W - off);
  const addSign = (text, side, z, y, opt) => {
    const s = signMesh(text, opt);
    s.position.set(wallX(side, 0.03), y, z);
    s.rotation.y = side === -1 ? Math.PI / 2 : -Math.PI / 2;
    scene.add(s);
  };
  const addDoor = (side, z) => {
    box(0.2, 2.5, 1.3, 0xfff3d6, wallX(side, 0), 1.25, z, scene);
    box(0.12, 2.3, 1.1, 0x6a2c3e, wallX(side, 0.08), 1.15, z, scene);
    box(0.3, 0.12, 1.6, 0xe7d8b8, wallX(side, 0.05), 0.06, z, scene);
  };
  const addAC = (side, z, y) => {
    box(0.55, 0.42, 0.85, 0xdad4e8, wallX(side, 0.25), y, z, scene);
  };
  const addAwning = (side, z, w, y) => {
    const tex = canvasTex(256, 64, (g, cw, ch) => {
      for (let i = 0; i < 8; i++) {
        g.fillStyle = i % 2 ? '#ffc233' : '#ff3d8b';
        g.fillRect((cw / 8) * i, 0, cw / 8, ch);
      }
    });
    const a = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.06, w), [L(0x999999), L(0x999999), new THREE.MeshLambertMaterial({ map: tex }), L(0x999999), L(0x999999), L(0x999999)]);
    a.position.set(wallX(side, 0.6), y, z);
    a.rotation.z = side * 0.3;
    a.castShadow = true;
    scene.add(a);
  };
  addDoor(-1, 8.5);
  addDoor(-1, -8.3);
  addDoor(-1, -19);
  addSign('SHARMA SWEETS', -1, -0.8, 3.6, { w: 3, h: 0.6, bg: '#ff3d8b', fg: '#fff', size: 56, border: '#ffc233' });
  addAwning(-1, -0.8, 3.6, 3.1);
  const shutter = new THREE.Mesh(
    new THREE.PlaneGeometry(3.4, 2.7),
    new THREE.MeshLambertMaterial({
      map: canvasTex(128, 128, (g, w, h) => {
        g.fillStyle = '#7d7596';
        g.fillRect(0, 0, w, h);
        g.fillStyle = 'rgba(0,0,0,.3)';
        for (let y = 0; y < h; y += 6) g.fillRect(0, y, w, 2);
      }),
    })
  );
  shutter.position.set(wallX(-1, 0.04), 1.4, -0.8);
  shutter.rotation.y = Math.PI / 2;
  scene.add(shutter);
  addSign('SHUBH DIWALI', -1, -22, 2.8, { w: 2.4, h: 0.55, bg: '#7c4dff', fg: '#ffe58a', size: 56, border: '#ffe58a' });
  addAC(-1, 8, 6.2);
  addAC(-1, -10, 6.6);
  addDoor(1, 9);
  addDoor(1, -17);
  addDoor(1, -21);
  addSign('GUPTA JEWELLERS', 1, 1.6, 3.3, { w: 2.5, h: 0.5, bg: '#1b1230', fg: '#ffc233', size: 52, border: '#ffc233' });
  addSign('HAPPY DIWALI!', 1, -15.2, 2.9, { w: 2.4, h: 0.55, bg: '#ff7a1a', fg: '#fff', size: 52, border: '#fff' });
  addAC(1, 12, 6.6);
  addAC(1, -8, 6.4);
  addAC(1, -20, 6.8);

  // breakable windows (ground floor, reachable by a lofted shot)
  W.windows = [];
  const wins = [
    { side: -1, z: 3.2, y: 2.1 },
    { side: -1, z: -2.6, y: 2.4 },
    { side: -1, z: -11.4, y: 2.1 },
    { side: 1, z: 0.4, y: 2.2 },
    { side: 1, z: -9.6, y: 2.1 },
    { side: 1, z: -14.1, y: 2.4 },
  ];
  for (const w of wins) {
    const g = makeWindow();
    g.position.set(wallX(w.side, 0), w.y, w.z);
    if (w.side === 1) g.rotation.y = Math.PI;
    scene.add(g);
    W.windows.push({ side: w.side, z: w.z, y: w.y, glass: g.userData.glass, group: g, broken: false });
  }

  // balcony (right) + aunty
  const bal = new THREE.Group();
  bal.position.set(C.HALF_W - 0.7, 3.0, -6);
  box(1.5, 0.15, 2.6, 0xe7d8b8, 0, 0, 0, bal);
  box(0.06, 0.85, 2.6, 0x7a2c4e, -0.72, 0.5, 0, bal);
  box(1.5, 0.85, 0.06, 0x7a2c4e, 0, 0.5, 1.27, bal);
  box(1.5, 0.85, 0.06, 0x7a2c4e, 0, 0.5, -1.27, bal);
  for (let i = 0; i < 3; i++) cyl(0.14, 0.1, 0.22, 0xb5523b, 0.3, 0.2, -1.0 + i * 0.4, bal);
  scene.add(bal);
  const aunty = makePerson({ shirt: 0xd81b60, accent: 0xffd23f, pants: 0xd81b60, skin: 0xb77a4a, hair: 0x111111, scale: 0.97, style: 'bun', shoe: 0xd81b60, skirt: 0xd81b60 });
  aunty.group.position.set(C.HALF_W - 0.9, 3.075, -6);
  aunty.group.rotation.y = -Math.PI / 2;
  scene.add(aunty.group);
  W.aunty = aunty;
  aunty.female = true;
  W.people.push(aunty);

  // chai tapri + chaiwala
  const tea = makeTeaCart();
  tea.position.set(-5.9, 0.16, -6.6);
  tea.rotation.y = Math.PI / 2;
  scene.add(tea);
  W.tea = tea;
  const vendor = makePerson({ shirt: 0x6a994e, accent: 0xffffff, pants: 0x3a3a3a, skin: 0xa86f43, hair: 0xdddddd, scale: 0.95, style: 'short' });
  vendor.group.position.set(-6.5, 0.16, -6.6);
  vendor.group.rotation.y = Math.PI / 2;
  scene.add(vendor.group);
  W.vendor = vendor;
  W.people.push(vendor);

  const scooter = makeScooter(0x2de2c8);
  scooter.position.set(5.7, 0.16, -10.2);
  scooter.rotation.y = -0.1;
  scene.add(scooter);
  W.scooter = scooter;
  const scooter2 = makeScooter(0xff3d8b);
  scooter2.position.set(-5.9, 0.16, -14);
  scooter2.rotation.y = Math.PI + 0.1;
  scene.add(scooter2);

  const cow = makeCow();
  cow.group.position.set(2.6, 0, -12);
  scene.add(cow.group);
  W.cow = cow;
  const dog = makeDog();
  dog.group.position.set(4.7, 0.16, -3.4);
  dog.group.rotation.y = Math.PI;
  scene.add(dog.group);
  W.dog = dog;

  // ---- electric poles, wires and a pole-mounted transformer, plus street lamps
  const glowPts = [];
  const glowCols = [];
  const addGlow = (x, y, z, col) => {
    glowPts.push(x, y, z);
    const c = new THREE.Color(col);
    glowCols.push(c.r, c.g, c.b);
  };
  const lampHeads = [];
  const concrete = 0x8d8a96;
  const cable = (a, b, sag, color = 0x120d1a) => {
    const pts = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      pts.push(new THREE.Vector3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t - Math.sin(t * Math.PI) * sag, a.z + (b.z - a.z) * t));
    }
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color })));
  };
  const elecPole = (x, z, { lamp = false, arm = true } = {}) => {
    const g = new THREE.Group();
    g.position.set(x, 0.16, z);
    part(new THREE.CylinderGeometry(0.1, 0.16, 9, 12), concrete, 0, 4.5, 0, g, { rough: 0.95 });
    if (arm) {
      part(new THREE.BoxGeometry(2.3, 0.1, 0.12), 0x3a3446, 0, 8.55, 0, g);
      for (const dx of [-0.85, 0, 0.85]) part(new THREE.CylinderGeometry(0.035, 0.055, 0.15, 8), 0xe6e0d0, dx, 8.7, 0, g, { rough: 0.35 });
    }
    if (lamp) {
      part(new THREE.BoxGeometry(0.1, 0.1, 1.1), 0x2a2238, 0, 7.6, -Math.sign(x) * 0.0, g);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.14, 0.9), new THREE.MeshBasicMaterial({ color: 0xfff3c8 }));
      head.position.set(-Math.sign(x) * 0.7, 7.55, 0);
      g.add(head);
      lampHeads.push(head.material);
      addGlow(x - Math.sign(x) * 0.7, 7.5, z, 0xffe9b0);
    }
    scene.add(g);
    return g;
  };
  const LX = -6.0; // power line runs down the left kerb
  elecPole(LX, 9, {});
  elecPole(LX, -3, { lamp: true });
  elecPole(LX, -10.9, {});
  elecPole(LX, -12.7, {});
  elecPole(LX, -26, { lamp: true });
  for (const [x, z] of [[6.2, -3], [6.2, -26], [6.2, 8]]) elecPole(x, z, { lamp: true, arm: false });
  for (const dx of [-0.85, 0, 0.85]) {
    for (const [z0, z1, sag] of [[9, -3, 0.55], [-3, -10.9, 0.5], [-10.9, -12.7, 0.05], [-12.7, -26, 0.6], [-26, -45, 0.8]]) {
      cable(new THREE.Vector3(LX + dx, 8.86, z0), new THREE.Vector3(LX + dx, 8.86, z1), sag);
    }
  }
  // H-frame transformer between the two poles at z=-10.9 / -12.7 (low and big so it can really be hit)
  const tz = -11.8;
  const ty = 3.9;
  for (const y of [3.2, 5.4]) part(new THREE.BoxGeometry(0.14, 0.14, 1.9), 0x3a3446, LX, y, tz, scene);
  part(new THREE.BoxGeometry(1.1, 0.1, 1.5), 0x3a3446, LX, 3.2, tz, scene); // platform
  const trafo = new THREE.Group();
  trafo.position.set(LX, ty, tz);
  part(new THREE.CylinderGeometry(0.52, 0.52, 1.15, 24), 0x56685a, 0, 0, 0, trafo, { rough: 0.6 });
  for (let i = -2; i <= 2; i++) part(new THREE.TorusGeometry(0.53, 0.03, 6, 24), 0x3d4a40, 0, i * 0.24, 0, trafo, { rx: Math.PI / 2, rough: 0.6 });
  part(new THREE.CylinderGeometry(0.5, 0.52, 0.1, 24), 0x2f3a32, 0, 0.62, 0, trafo, { rough: 0.6 });
  for (const dz of [-0.28, 0, 0.28]) part(new THREE.CylinderGeometry(0.05, 0.075, 0.4, 8), 0xe6e0d0, 0, 0.85, dz, trafo, { rough: 0.35 });
  const plate = signMesh('DANGER 11kV', { w: 0.8, h: 0.32, bg: '#ffd23f', fg: '#b3000c', size: 70, border: '#b3000c' });
  plate.position.set(0.54, 0, 0);
  plate.rotation.y = Math.PI / 2;
  trafo.add(plate);
  scene.add(trafo);
  for (const [dz, dx] of [[-0.28, -0.85], [0, 0], [0.28, 0.85]]) {
    cable(new THREE.Vector3(LX, ty + 1.05, tz + dz), new THREE.Vector3(LX + dx, 8.8, -10.9), 0.15);
  }
  W.transformerPos = new THREE.Vector3(LX, ty, tz);
  glowPts.length && void 0;

  // ---- string lights + paper lanterns across the street
  const bulbCols = [0xff3d8b, 0xffc233, 0x2de2c8, 0xff8a3d, 0x9b7bff, 0xffffff];
  const bulbs = [];
  const strand = (a, b, sag, count) => {
    const pts = [];
    for (let i = 0; i <= 18; i++) {
      const t = i / 18;
      pts.push(new THREE.Vector3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t - Math.sin(t * Math.PI) * sag, a.z + (b.z - a.z) * t));
    }
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x120a22 })));
    for (let i = 1; i < count; i++) {
      const t = i / count;
      bulbs.push([a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t - Math.sin(t * Math.PI) * sag - 0.07, a.z + (b.z - a.z) * t + rnd(-0.04, 0.04)]);
    }
  };
  for (const z of [-22, -11, 0, 10]) {
    strand(new THREE.Vector3(-6.9, 7.2, z), new THREE.Vector3(6.9, 7.2, z), 1.0, 30);
    for (const sx of [-1, 1]) box(0.14, 0.14, 0.14, 0x2a2238, sx * 6.95, 7.2, z, scene, { shadow: false }); // wall hooks
  }
  const bulbMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.075, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffffff }), bulbs.length);
  bulbs.forEach((p, i) => {
    dm.makeTranslation(p[0], p[1], p[2]);
    bulbMesh.setMatrixAt(i, dm);
    const col = pick(bulbCols);
    bulbMesh.setColorAt(i, new THREE.Color(col));
    addGlow(p[0], p[1], p[2], col);
  });
  scene.add(bulbMesh);

  // paper-star lanterns (aakash kandil)
  const lanternCols = [0xff3d8b, 0xffc233, 0x2de2c8, 0xff7a1a, 0x9b7bff];
  const lanternPos = [];
  for (const z of [-22, -11, 0, 10]) for (const x of [-4.2, -1.4, 1.4, 4.2]) lanternPos.push([x, 7.2 - 1.0 * Math.sin(((x + 6.9) / 13.8) * Math.PI) - 0.85, z]);
  const lanterns = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.3, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }), lanternPos.length);
  const sm = new THREE.Matrix4();
  lanternPos.forEach((p, i) => {
    sm.compose(new THREE.Vector3(p[0], p[1], p[2]), new THREE.Quaternion(), new THREE.Vector3(1, 1.5, 1));
    lanterns.setMatrixAt(i, sm);
    const col = pick(lanternCols);
    lanterns.setColorAt(i, new THREE.Color(col));
    addGlow(p[0], p[1], p[2], col);
    const wire = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(p[0], p[1] + 0.45, p[2]), new THREE.Vector3(p[0], 7.2 - 1.0 * Math.sin(((p[0] + 6.9) / 13.8) * Math.PI), p[2])]), new THREE.LineBasicMaterial({ color: 0x120a22 }));
    scene.add(wire);
  });
  scene.add(lanterns);
  W.lanterns = lanterns;

  const gGeo = new THREE.BufferGeometry();
  gGeo.setAttribute('position', new THREE.Float32BufferAttribute(glowPts, 3));
  gGeo.setAttribute('color', new THREE.Float32BufferAttribute(glowCols, 3));
  const glowMat = new THREE.PointsMaterial({ size: 1.1, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.85 });
  const glowPoints = new THREE.Points(gGeo, glowMat);
  glowPoints.frustumCulled = false;
  scene.add(glowPoints);

  // ---- festival gate closing the street
  const gate = new THREE.Group();
  gate.position.set(0, 0, C.END_Z + 3);
  for (const s of [-1, 1]) {
    box(1.8, 11, 1.8, 0xe7a92f, s * 4.6, 5.5, 0, gate);
    box(2.2, 0.5, 2.2, 0xfff3d6, s * 4.6, 11.2, 0, gate);
    mk(new THREE.SphereGeometry(1.1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), T(0xffc233), s * 4.6, 11.4, 0, gate, { outline: 0 });
  }
  box(11.4, 1.5, 1.8, 0xe0628f, 0, 10.2, 0, gate);
  mk(new THREE.SphereGeometry(2.2, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), T(0xffc233), 0, 11, 0, gate, { outline: 0 });
  const gsign = signMesh('MOHALLA CHOWK', { w: 6.4, h: 1.2, bg: '#1b1230', fg: '#ffc233', size: 100, border: '#ffc233' });
  gsign.position.set(0, 10.2, 0.92);
  gate.add(gsign);
  scene.add(gate);
  addGlow(0, 10.2, C.END_Z + 4.5, 0xffc233);
  gGeo.setAttribute('position', new THREE.Float32BufferAttribute(glowPts, 3));
  gGeo.setAttribute('color', new THREE.Float32BufferAttribute(glowCols, 3));
  const wall = box(30, 16, 2, 0x2a1a50, 0, 8, C.END_Z - 1, scene);
  void wall;

  // ---- people on the sidelines
  W.kids = [];
  const kidDefs = [
    { x: -6.2, z: -9, s: 0xffd23f }, { x: 6.2, z: -6.8, s: 0x38bdf8 }, { x: -6.2, z: -17.5, s: 0xf472b6 }, { x: 6.2, z: -14, s: 0x4ade80 },
  ];
  for (const k of kidDefs) {
    const kid = makePerson({ shirt: k.s, pants: 0x3a3f5c, skin: pick([0xc68a5c, 0xa8743f, 0xd9a273]), hair: 0x1b1410, scale: 0.7, outline: false, shorts: true, style: pick(['short', 'spiky', 'pony']) });
    kid.group.position.set(k.x, 0.16, k.z);
    kid.group.rotation.y = k.x < 0 ? Math.PI / 2 : -Math.PI / 2;
    scene.add(kid.group);
    W.kids.push(kid);
    kid.kid = true;
    W.people.push(kid);
  }

  // ---- pedestrians roaming the kerbs and crossing the far end of the gully
  W.walkers = [];
  const walkerDefs = [
    { f: false, s: 0x5a6fd6, p: 0x2f3550 }, { f: true, s: 0xe36bae, p: 0x7a2c4e }, { f: false, s: 0xd9a441, p: 0x4a3c30 }, { f: false, s: 0x7fc6a4, p: 0x23323a },
    { f: true, s: 0xf2c230, p: 0x2a5d4d }, { f: false, s: 0xcf5a4a, p: 0x2b2b33 }, { f: true, s: 0x9b7be0, p: 0x3a2f5c }, { f: false, s: 0xe8e0d0, p: 0x333a52 },
  ];
  walkerDefs.forEach((d, i) => {
    const rig = makePerson({ shirt: d.s, accent: 0xffffff, pants: d.p, skin: pick([0xc68a5c, 0xb07a4d, 0xd9a273, 0xa8743f]), hair: 0x1b1410, scale: rnd(0.96, 1.04), style: d.f ? 'long' : pick(['short', 'spiky']), skirt: d.f ? d.p : null });
    rig.female = d.f;
    scene.add(rig.group);
    W.people.push(rig);
    const cross = i >= 6;
    W.walkers.push({ rig, cross, dir: Math.random() < 0.5 ? 1 : -1, speed: rnd(1.0, 1.5), x: (i % 2 ? 1 : -1) * rnd(5.8, 6.3), z: rnd(-45, 12), phase: rnd(0, 6), pause: 0 });
  });

  // ---- fielders
  W.fielders = [];
  const fielderDefs = [
    { x: -4.2, z: -3.8, s: 0x7c4dff, p: 0x232042 },
    { x: 4.0, z: -5.4, s: 0xff8a3d, p: 0x1d2a4a },
    { x: -3.4, z: -12.8, s: 0xffd23f, p: 0x2b2d42 },
    { x: 3.7, z: -13.4, s: 0x38bdf8, p: 0x232042 },
    { x: 0.5, z: -15.4, s: 0x4ade80, p: 0x1d3557 },
    { x: -4.6, z: -0.8, s: 0xf472b6, p: 0x2d3142 },
    { x: 4.4, z: -1.0, s: 0xf8fafc, p: 0x3d405b },
  ];
  for (const f of fielderDefs) {
    const rig = makePerson({ shirt: f.s, accent: pick([0xffffff, 0xffd23f, 0x111111]), pants: f.p, skin: pick([0xd09a70, 0xb98255, 0xe0ab80, 0xa8743f]), hair: 0x1b1410, scale: rnd(0.74, 0.86), shorts: Math.random() < 0.5, style: pick(['short', 'spiky', 'pony', 'short']), cap: Math.random() < 0.3 ? 0xffc233 : null, number: 2 + ((Math.random() * 90) | 0), shoe: pick([0xffffff, 0xff6b6b, 0x4cc9f0]) });
    rig.group.position.set(f.x, 0, f.z);
    scene.add(rig.group);
    rig.kid = true;
    W.people.push(rig);
    W.fielders.push({ rig, home: new THREE.Vector3(f.x, 0, f.z), vel: new THREE.Vector3(), celebrate: 0 });
  }

  // ---- stumps
  W.stumps = [];
  const stumpGroup = new THREE.Group();
  stumpGroup.position.set(0, 0, C.STUMP_Z);
  scene.add(stumpGroup);
  for (let i = -1; i <= 1; i++) {
    const s = cyl(0.03, 0.03, 0.8, 0xfff0c9, i * 0.11, 0.4, 0, stumpGroup, { outline: 0 });
    s.userData.home = s.position.clone();
    W.stumps.push(s);
  }
  box(0.36, 0.025, 0.05, 0xff3d8b, 0, 0.82, 0, stumpGroup);
  const bowlStumps = new THREE.Group();
  bowlStumps.position.set(0, 0, -9.7);
  scene.add(bowlStumps);
  for (let i = -1; i <= 1; i++) cyl(0.03, 0.03, 0.8, 0xfff0c9, i * 0.11, 0.4, 0, bowlStumps);
  W.stumpGroup = stumpGroup;

  // ---- bowler (magenta kit)
  const bowler = makePerson({ shirt: 0xd63384, accent: 0xffffff, pants: 0xf4f0ff, skin: 0xb98250, hair: 0x1a1410, scale: 0.85, shorts: true, shoe: 0xd0d0d0, style: 'short', cap: 0xffffff, number: 7 });
  bowler.group.position.set(0, 0, C.BOWL_Z - 1.6);
  scene.add(bowler.group);
  W.bowler = bowler;
  bowler.kid = true;
  W.people.push(bowler);

  // ---- batter (teal kit, spiky hair) + bat
  const batter = makePerson({ shirt: 0x14b8a6, accent: 0xffc233, pants: 0x1f2a5a, skin: 0xd09a70, hair: 0x15100d, scale: 0.88, style: 'spiky', shoe: 0xffc233, number: 18 });
  batter.group.position.set(C.BAT_X, 0, C.BAT_Z);
  batter.group.rotation.y = 2.36;
  batter.head.rotation.y = 0.78;
  scene.add(batter.group);
  W.batter = batter;
  batter.kid = true;
  W.people.push(batter);

  const bat = new THREE.Group();
  bat.rotation.order = 'YXZ';
  bat.position.set(-0.55, 0.95, 5.55);
  capsule(0.065, 0.5, 0xe9b873, 0, -0.62, 0, bat, { sz: 1.9, outline: 0.01 });
  cyl(0.032, 0.032, 0.34, 0x1b1230, 0, -0.1, 0, bat, { outline: 0 });
  scene.add(bat);
  bat.scale.setScalar(0.88); // a junior-size bat
  W.bat = bat;

  // ---- ball + shadow blob + trail
  const ball = new THREE.Mesh(new THREE.SphereGeometry(C.BR, 18, 14), new THREE.MeshToonMaterial({ color: 0xe6ff3c, emissive: 0x7a9a10, gradientMap: toonGrad }));
  ball.add(new THREE.Mesh(ball.geometry, outlineMat(0.012)));
  ball.castShadow = true;
  ball.scale.setScalar(1.1);
  ball.visible = false;
  scene.add(ball);
  W.ball = ball;
  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.15, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.02;
  blob.visible = false;
  scene.add(blob);
  W.blob = blob;
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(30 * 3), 3));
  const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.8 }));
  trail.frustumCulled = false;
  trail.visible = false;
  scene.add(trail);
  W.trail = trail;

  // ---- power: everything electric lives behind this switch (transformer blast -> blackout)
  const signMats = [];
  scene.traverse((o) => {
    if (o.userData.sign) signMats.push(o.material);
  });
  W.power = true;
  W.setPower = (on) => {
    W.power = on;
    hemi.intensity = on ? 1.6 : 0.5;
    key.intensity = on ? 2.8 : 0.45;
    rim.intensity = on ? 0.9 : 0.55;
    pointLights.forEach((pl) => (pl.intensity = on ? 22 : 0));
    faceMats.forEach((m) => m.emissive.setHex(on ? 0xffffff : 0x000000));
    W.windows.forEach((w) => (w.glass.material.emissiveIntensity = on ? 0.9 : 0));
    signMats.forEach((m) => m.color.setHex(on ? 0xffffff : 0x2a2a3c));
    lampHeads.forEach((m) => m.color.setHex(on ? 0xfff3c8 : 0x2a2a30));
    bulbMesh.material.color.setHex(on ? 0xffffff : 0x1c1830);
    lanterns.material.color.setHex(on ? 0xffffff : 0x1c1830);
    glowPoints.visible = on;
    scene.fog.color.setHex(on ? 0x3b1d63 : 0x140b26);
  };

  return W;
}

function pick(a) {
  return a[Math.floor(Math.random() * a.length)];
}
