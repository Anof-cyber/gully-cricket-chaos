import * as THREE from 'three';
import { buildWorld, C, emojiSprite, makeVehicle, makePerson } from './world.js';
import { loadTemplates, dressRig, makeAnimal, cloneModel } from './models.js';
import { sfx, outSoundLen, unlockAudio, startAmbience, setMuted, isMuted, makeEngine } from './audio.js';

// ------------------------------------------------------------------ setup
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 160);
const W = buildWorld(scene);

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const lerp = (a, b, t) => a + (b - a) * t;

const skinTints = [undefined, 0xe3b48f, 0xc08a60, 0xa86e45];
const G = 18;
const FIXED = 1 / 120;
let MAX_BALLS = 12; // overs, wickets and target are rolled fresh for every match
let MAX_WKTS = 3;
const FIELD_SPEED = 5.0;
const SW_DUR = 0.26; // swing length
const SW_CONTACT = 0.12; // moment the bat reaches the contact point
const REACH = 1.35;
const DRINK_LEN = 2.7; // seconds of the chai-drinking animation
const RUNUP = 0.85; // underarm wind-up + delivery (no run-up)

// ------------------------------------------------------------------ state
const S = {
  intro: 0,
  mode: 'menu', // menu | ready | runup | bowling | live | result | over
  t: 0,
  score: 0,
  wkts: 0,
  ballNo: 0,
  uncle: 0,
  best: Number(localStorage.getItem('gcc_best') || 0),
  aimYaw: 0,
  lofted: false,
  combo: 0,
  boost: false,
  chaiUsed: false, // the BOOST button is once a match
  chaiBalls: 0, // balls left that fly for six
  holdUntil: 0, // ready-state time until which the delivery waits (chai break)
  chaiPop: false,
  swing: { on: false, t: 0, resolved: false },
  swungThisBall: false,
  slowT: 0,
  slowScale: 1,
  shake: 0,
  cheerT: 0,
  stumpFly: false,
  history: [],
  delivery: null,
  resultText: '',
  round: 0,
  target: 18,
  won: false,
  calledOff: false,
  chaser: -1,
  react: { kind: null, t: 0 },
  follow: 0,
  landing: new THREE.Vector3(),
};

const ball = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), hit: false, bounced: false, e: 0.62, spin: 0, frozen: false, settle: 0, age: 0, hitsScooter: false };

// ------------------------------------------------------------------ particles
const MAXP = 320;
const pMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), MAXP);
pMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
pMesh.frustumCulled = false;
scene.add(pMesh);
const parts = Array.from({ length: MAXP }, () => ({ life: 0, max: 1, pos: new THREE.Vector3(), vel: new THREE.Vector3(), size: 0.1, grav: 1 }));
let pCursor = 0;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
for (let i = 0; i < MAXP; i++) {
  _m.makeScale(0, 0, 0);
  pMesh.setMatrixAt(i, _m);
  pMesh.setColorAt(i, _c.set(0xffffff));
}

function burst(pos, colors, n, speed, { up = 3, size = 0.09, life = 0.9, grav = 1 } = {}) {
  for (let i = 0; i < n; i++) {
    const p = parts[pCursor];
    const idx = pCursor;
    pCursor = (pCursor + 1) % MAXP;
    p.life = p.max = life * rand(0.6, 1.2);
    p.pos.copy(pos);
    p.vel.set(rand(-1, 1), rand(-0.2, 1), rand(-1, 1)).normalize().multiplyScalar(speed * rand(0.4, 1));
    p.vel.y += up * rand(0.3, 1);
    p.size = size * rand(0.6, 1.4);
    p.grav = grav;
    pMesh.setColorAt(idx, _c.set(Array.isArray(colors) ? pick(colors) : colors));
  }
  pMesh.instanceColor.needsUpdate = true;
}

function updateParticles(dt) {
  for (let i = 0; i < MAXP; i++) {
    const p = parts[i];
    if (p.life > 0) {
      p.life -= dt;
      p.vel.y -= G * 0.6 * p.grav * dt;
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < 0.03) {
        p.pos.y = 0.03;
        p.vel.multiplyScalar(0.5);
        p.vel.y = Math.abs(p.vel.y) * 0.4;
      }
      const k = clamp(p.life / p.max, 0, 1);
      _s.setScalar(p.size * (0.3 + k));
      _m.compose(p.pos, _q, _s);
    } else {
      _m.makeScale(0, 0, 0);
    }
    pMesh.setMatrixAt(i, _m);
  }
  pMesh.instanceMatrix.needsUpdate = true;
}

// soft round puffs (chai steam, bat sparks) instead of the blocky particles
const puffTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const puffs = Array.from({ length: 36 }, () => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false, opacity: 0 }));
  s.visible = false;
  scene.add(s);
  return { s, life: 0, max: 1, vel: new THREE.Vector3(), size: 0.1, grow: 1, op: 0.5 };
});
let puffCursor = 0;
function puff(pos, { color = 0xffffff, size = 0.08, life = 1, vel = [0, 0.3, 0], grow = 2.2, opacity = 0.5, additive = false } = {}) {
  const p = puffs[puffCursor];
  puffCursor = (puffCursor + 1) % puffs.length;
  p.life = p.max = life;
  p.size = size;
  p.grow = grow;
  p.op = opacity;
  p.vel.set(vel[0] + rand(-0.04, 0.04), vel[1], vel[2] + rand(-0.04, 0.04));
  p.s.position.copy(pos);
  p.s.material.color.set(color);
  p.s.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
  p.s.visible = true;
}
function updatePuffs(dt) {
  for (const p of puffs) {
    if (p.life <= 0) continue;
    p.life -= dt;
    if (p.life <= 0) {
      p.s.visible = false;
      continue;
    }
    const k = p.life / p.max;
    p.s.position.addScaledVector(p.vel, dt);
    p.s.scale.setScalar(p.size * (1 + (1 - k) * p.grow));
    p.s.material.opacity = p.op * Math.sin(Math.min(1, k * 1.4) * Math.PI * 0.5) * (k > 0.8 ? (1 - k) * 5 : 1);
  }
}

const floaters = [];
function floater(ch, pos, scale = 1.3) {
  const s = emojiSprite(ch, scale);
  s.position.copy(pos);
  scene.add(s);
  floaters.push({ s, life: 1.8 });
}

// ------------------------------------------------------------------ HUD
const el = {
  score: $('score'), wk: $('wk'), need: $('need'), target: $('target'), best: $('best'), dots: $('dots'), kind: $('kind'), pop: $('pop'), sub: $('sub'),
  uncle: $('uncle'), uncleFill: $('uncleFill'), uncleFace: $('uncleFace'), combo: $('combo'), grade: $('grade'), swipe: $('swipe'), loftBtn: $('loftBtn'), chaiBtn: $('chaiBtn'), chaiSub: $('chaiSub'),
  hint: $('hint'), menu: $('menu'), over: $('over'),
};
let subTimer = 0;
function pop(text, cls = 'norm', long = false) {
  el.pop.className = '';
  void el.pop.offsetWidth;
  el.pop.textContent = text;
  el.pop.className = `${cls} ${long ? 'goLong' : 'go'}`;
}
function sub(text, ms = 1900) {
  el.sub.textContent = text;
  el.sub.classList.add('show');
  clearTimeout(subTimer);
  subTimer = setTimeout(() => el.sub.classList.remove('show'), ms);
}
function buildDots() {
  el.dots.innerHTML = '';
  for (let i = 0; i < MAX_BALLS; i++) el.dots.appendChild(document.createElement('i'));
}
function refreshHud() {
  el.score.textContent = S.score;
  el.wk.textContent = S.wkts;
  $('wkMax').textContent = MAX_WKTS;
  el.target.textContent = S.target;
  const left = MAX_BALLS - S.ballNo;
  const need = Math.max(0, S.target - S.score);
  el.need.textContent = need > 0 ? `NEED ${need} OFF ${left} ${left === 1 ? 'BALL' : 'BALLS'}` : 'TARGET CHASED!';
  el.best.textContent = Math.max(S.best, S.score);
  const u = clamp(S.uncle, 0, 100);
  el.uncleFill.style.width = u + '%';
  el.uncleFace.textContent = u < 35 ? '🙂' : u < 70 ? '😠' : '🤬';
  el.uncle.classList.toggle('hot', u >= 70);
  const m = currentMult();
  el.combo.textContent = m > 1 ? `${S.boost ? '☕ BOOST' : '🔥 COMBO'}  NEXT BALL x${m}` : S.combo > 0 ? `STREAK ${S.combo}  •  score 3 in a row for x2` : '';
  const chaiTxt = S.chaiBalls > 0 ? `☕ CHAI POWER — ${S.chaiBalls} ${S.chaiBalls === 1 ? 'BALL' : 'BALLS'} = SIX` : '';
  if (chaiTxt) el.combo.textContent = chaiTxt;
  el.chaiBtn.classList.toggle('off', S.chaiUsed && S.chaiBalls <= 0);
  el.chaiBtn.classList.toggle('active', S.chaiBalls > 0);
  el.chaiSub.textContent = S.chaiBalls > 0 ? `${S.chaiBalls} left` : S.chaiUsed ? 'used' : touchy ? 'x1' : 'press B';
  el.combo.classList.toggle('on', m > 1 || S.combo > 0 || S.chaiBalls > 0);
  el.combo.classList.toggle('hot', m > 1 || S.chaiBalls > 0);
}

// ------------------------------------------------------------------ input
// Swipe (or mouse-flick) = swing; the swipe direction is the shot direction.
// One button toggles GROUND / LOFT. Keyboard: arrows/A/W/D swing, Shift/L toggles loft.
const touchy = window.matchMedia('(pointer: coarse)').matches;
const SWIPE_MIN = 26;
const swipe = { on: false, fired: false, x0: 0, y0: 0 };
const playing = () => S.mode === 'ready' || S.mode === 'runup' || S.mode === 'bowling';

function trySwing() {
  if (!(S.mode === 'runup' || S.mode === 'bowling') || S.swing.on || S.swungThisBall) return;
  S.swing = { on: true, t: 0, resolved: false };
  S.swungThisBall = true;
}
function shot(yaw) {
  S.aimYaw = yaw;
  trySwing();
}
function setLoft(v) {
  const changed = S.lofted !== v;
  S.lofted = v;
  el.loftBtn.innerHTML = (v ? 'LOFT ⬆' : 'GROUND') + (touchy ? '' : `<small>press L</small>`);
  el.loftBtn.classList.toggle('loft', v);
  document.body.classList.toggle('loft', v);
  if (changed && playing()) {
    floater(v ? '🚀' : '🏏', new THREE.Vector3(C.BAT_X, 2.7, C.BAT_Z), 1.1);
    sfx.tick();
  }
}
function drawSwipe(x, y) {
  const dx = x - swipe.x0;
  const dy = y - swipe.y0;
  el.swipe.style.left = swipe.x0 + 'px';
  el.swipe.style.top = swipe.y0 + 'px';
  el.swipe.style.width = Math.hypot(dx, dy) + 'px';
  el.swipe.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
  el.swipe.classList.add('on');
}
function endSwipe(delay = 0) {
  swipe.on = false;
  setTimeout(() => el.swipe.classList.remove('on'), delay);
}

canvas.addEventListener('pointerdown', (e) => {
  unlockAudio();
  swipe.on = true;
  swipe.fired = false;
  swipe.x0 = e.clientX;
  swipe.y0 = e.clientY;
  canvas.setPointerCapture?.(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!swipe.on || swipe.fired) return;
  const dx = e.clientX - swipe.x0;
  const dy = e.clientY - swipe.y0;
  if (Math.hypot(dx, dy) < 6) return;
  drawSwipe(e.clientX, e.clientY);
  if (Math.hypot(dx, dy) >= SWIPE_MIN) {
    const angle = Math.atan2(dx, -dy); // 0 = straight up, + = right
    shot(clamp(angle, -1.4, 1.4) * 0.75);
    swipe.fired = true;
    endSwipe(260);
  }
});
const swipeEnd = () => {
  if (swipe.on && !swipe.fired) shot(0); // plain tap/click = straight shot
  endSwipe(0);
};
canvas.addEventListener('pointerup', swipeEnd);
canvas.addEventListener('pointercancel', () => endSwipe(0));
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
el.loftBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  unlockAudio();
  setLoft(!S.lofted);
});
function drinkChai() {
  // only in the calm moment before a delivery, once per match
  if (S.mode !== 'ready' || S.chaiUsed || S.chaiBalls > 0 || S.holdUntil > 0 || S.t < S.intro) return;
  S.chaiUsed = true;
  S.chaiBalls = 3;
  S.chaiPop = false;
  S.holdUntil = S.t + DRINK_LEN;
  S.sl1 = S.sl2 = false;
  sfx.tick();
  refreshHud();
}
el.chaiBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  unlockAudio();
  drinkChai();
});
window.addEventListener('keydown', (e) => {
  unlockAudio();
  if (e.repeat) return;
  if (e.code === 'KeyB') drinkChai();
  if (S.mode === 'menu' || S.mode === 'over') {
    if ((e.code === 'Space' || e.code === 'Enter') && !$('play').disabled) { e.preventDefault(); startGame(); }
    return;
  }
  switch (e.code) {
    case 'ArrowLeft': case 'KeyA': shot(-0.85); break;
    case 'ArrowRight': case 'KeyD': shot(0.85); break;
    case 'ArrowUp': case 'KeyW': case 'Space': e.preventDefault(); shot(0); break;
    case 'ShiftLeft': case 'ShiftRight': case 'KeyL': case 'ArrowDown': case 'KeyS': e.preventDefault(); setLoft(!S.lofted); break;
  }
});

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = camera.aspect < 0.75 ? 68 : camera.aspect < 1.2 ? 57 : 50;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------ deliveries
const KINDS = [
  { name: 'SEEDHI GEND', vz: [10, 12], land: 2.3, e: 0.62, w: 4 },
  { name: 'SLOW DHOKA', vz: [7.6, 8.6], land: 2.8, e: 0.62, w: 2 },
  { name: 'TEZ ROCKET', vz: [15, 18], land: 2.6, e: 0.6, w: 2, late: true },
  { name: 'YORKER BOMB', vz: [13, 15], land: 4.4, e: 0.5, w: 1.5, late: true },
  { name: 'BOUNCER DHAMAKA', vz: [12, 14], land: -1.2, e: 0.82, w: 1.5, late: true },
  { name: 'GHOOMTI SPIN', vz: [10, 12], land: 2.0, e: 0.62, w: 2, spin: true, late: true },
];
function makeDelivery() {
  const lvl = S.ballNo / (MAX_BALLS - 1);
  const pool = KINDS.filter((k) => !k.late || S.ballNo >= 2);
  let tot = pool.reduce((a, k) => a + k.w, 0);
  let r = Math.random() * tot;
  let k = pool[0];
  for (const c of pool) {
    r -= c.w;
    if (r <= 0) { k = c; break; }
  }
  const vz = rand(k.vz[0], k.vz[1]) * (1 + 0.12 * lvl);
  const spinx = k.spin ? rand(2.5, 3.8) * (Math.random() < 0.5 ? -1 : 1) : 0;
  return { ...k, vzv: vz, spinx, tx: Math.random() < 0.45 ? rand(-0.25, 0.25) : rand(-0.9, 1.0) };
}

function releaseBall() {
  const d = S.delivery;
  const x0 = ball.pos.x;
  const y0 = clamp(ball.pos.y, 0.5, 1.5); // underarm release
  const z0 = ball.pos.z;
  const t1 = (d.land - z0) / d.vzv;
  const vy = (0.5 * G * t1 * t1 - y0) / t1;
  const Tbat = t1 + (C.CONTACT.z - d.land) / (d.vzv * 0.88);
  const vx = (d.tx - d.spinx * (Tbat - t1) * 0.5 - x0) / Tbat;
  ball.pos.set(x0, y0, z0);
  ball.vel.set(vx, vy, d.vzv);
  ball.hit = false;
  ball.bounced = false;
  ball.e = d.e;
  ball.spin = d.spinx;
  ball.frozen = false;
  ball.settle = 0;
  ball.age = 0;
  ball.hitsScooter = false;
  ball.dropped = false;
  ball.attach = null;
  S.history.length = 0;
  S.follow = 0;
}

// ------------------------------------------------------------------ flow
function rollMatch() {
  MAX_BALLS = 6 + Math.floor(Math.random() * 13); // 6-18 balls
  MAX_WKTS = 2 + Math.floor(Math.random() * 4); // 2-5 wickets
  S.target = clamp(Math.round(MAX_BALLS * rand(1.5, 2.6)), 8, 45);
}
function newGameState() {
  rollMatch();
  S.combo = 0;
  S.boost = false;
  S.chaiUsed = false;
  S.chaiBalls = 0;
  setLoft(false);
  S.won = false;
  S.calledOff = false;
  W.setPower(true);
  document.body.classList.remove('blackout');
  S.score = 0;
  S.wkts = 0;
  S.ballNo = 0;
  S.uncle = 0;
  buildDots();
  for (const w of W.windows) {
    w.broken = false;
    w.glass.visible = true;
  }
  refreshHud();
}

function startGame() {
  unlockAudio();
  startAmbience();
  if (S.mode === 'over') S.round = S.won ? S.round + 1 : S.calledOff ? S.round : 0;
  el.menu.classList.add('hidden');
  el.over.classList.add('hidden');
  newGameState();
  el.hint.textContent = touchy ? 'SWIPE to hit  •  ← leg  ↑ straight  → off  •  tap LOFT for big shots' : 'FLICK the mouse or press ← ↑ → (A W D) to hit  •  SHIFT / L = LOFT';
  el.hint.classList.add('show');
  setTimeout(() => el.hint.classList.remove('show'), 9000);
  nextBall();
}

function nextBall() {
  if (S.calledOff || S.won || S.ballNo >= MAX_BALLS || S.wkts >= MAX_WKTS || S.uncle >= 100) return endGame();
  S.mode = 'ready';
  S.t = 0;
  S.holdUntil = 0;
  S.chaiPop = false;
  S.intro = S.ballNo === 0 ? 2.4 : 0; // first ball: batsman shows his face before taking stance
  S.swing = { on: false, t: 0, resolved: false };
  S.react.t = 0;
  S.follow = 0;
  ball.attach = null;
  S.swungThisBall = false;
  S.stumpFly = false;
  S.delivery = makeDelivery();
  ball.hit = false;
  ball.frozen = false;
  ball.vel.set(0, 0, 0);
  W.trail.visible = false;
  W.stumps.forEach((s) => {
    s.position.copy(s.userData.home);
    s.rotation.set(0, 0, 0);
  });
  W.bowler.group.position.set(rand(-0.3, 0.3), 0, C.BOWL_Z);
  W.dog.state = 'idle';
  W.dog.group.position.set(4.7, 0.16, -3.4);
  W.dog.group.rotation.y = Math.PI;
  resetFielders();
  el.kind.classList.remove('show');
  el.sub.classList.remove('show');
  const dots = el.dots.children;
  if (dots[S.ballNo]) dots[S.ballNo].style.outline = '2px solid #ff3b30';
}

function finish({ runs = 0, out = false, title, cls = 'norm', subText = '', uncle = 0, celebrate = false, long = false, dead = false }) {
  if (S.mode === 'result') return;
  S.mode = 'result';
  S.t = 0;
  if (S.chaiBalls > 0) S.chaiBalls--;
  S.resultLen = long || celebrate ? 2.3 : out ? 2.0 : 1.7;
  if (out) S.resultLen = Math.max(S.resultLen, outSoundLen()); // let both out sounds finish before the next ball
  const mult = out ? 1 : currentMult();
  const gained = runs * mult;
  if (mult > 1 && runs > 0) subText = `${subText}  (x${mult} = ${gained} runs!)`;
  S.combo = !out && runs > 0 ? S.combo + 1 : 0;
  S.boost = false;
  S.score += gained;
  if (S.score >= S.target) S.won = true;
  if (out) S.wkts++;
  S.uncle = clamp(S.uncle + uncle, 0, 100);
  if (S.score > S.best) {
    S.best = S.score;
    localStorage.setItem('gcc_best', String(S.best));
  }
  const dot = el.dots.children[S.ballNo];
  if (dot) {
    dot.style.outline = '';
    dot.className = 'used ' + (out ? 'out' : runs >= 6 ? 'six' : runs >= 4 ? 'four' : '');
  }
  S.react = { kind: out ? 'out' : celebrate ? 'six' : runs > 0 ? 'run' : null, t: out || celebrate ? 2.2 : 1.0 };
  S.ballNo++;
  if (dead) {
    ball.vel.set(0, 0, 0);
    ball.frozen = true;
  }
  pop(title, cls, celebrate || long);
  if (subText) sub(subText, S.resultLen * 1000 - 100);
  el.kind.classList.remove('show');
  if (celebrate) {
    S.cheerT = 2.4;
    sfx.cheer();
    sfx.wow();
    S.slowT = 0.8;
    S.slowScale = 0.35;
    const o = ball.pos.clone();
    o.z = Math.max(o.z, C.BOUNDARY_Z);
    burst(new THREE.Vector3(0, 3, -16), [0xff3b30, 0xffd23f, 0x2fbf4a, 0x4cc9f0, 0xf72585], 90, 7, { up: 7, size: 0.13, life: 1.8, grav: 0.5 });
  } else if (out) {
    sfx.out();
    S.shake = 0.5;
  }
  if (uncle > 0) sfx.angry();
  refreshHud();
}

function endGame() {
  S.mode = 'over';
  const s = S.score;
  let tag;
  let title;
  if (S.calledOff) {
    tag = 'MATCH CALLED OFF';
    title = 'BIJLI GUL!';
  } else if (S.won) {
    tag = `TARGET ${S.target} CHASED!`;
    title = pick(['MATCH JEET GAYE!', 'GALI KA BAAP!', 'MOHALLA CHAMPION!']);
    sfx.cheer();
    burst(new THREE.Vector3(0, 3, 2), [0xff3b30, 0xffd23f, 0x2fbf4a, 0x4cc9f0, 0xf72585], 90, 7, { up: 7, size: 0.13, life: 1.8, grav: 0.5 });
  } else {
    tag = S.uncle >= 100 ? 'UNCLE TOOK YOUR BAT!' : S.wkts >= MAX_WKTS ? 'ALL OUT!' : 'OVERS DONE!';
    title = s < 6 ? 'Tu to Aloo Hai' : s < 14 ? 'Chhota Bachcha' : 'Bas Thoda Aur!';
  }
  $('overTag').textContent = tag;
  $('overTitle').textContent = title;
  $('finalScore').textContent = s;
  $('overSub').textContent = S.calledOff ? `The transformer blew — no light, no cricket. Score: ${s}  •  Best: ${S.best}` : S.won ? `Next match: new target, overs and wickets  •  Best: ${S.best}` : `Needed ${S.target - s} more to win  •  Best: ${S.best}`;
  $('again').textContent = S.calledOff ? 'LIGHTS BACK ON' : S.won ? 'NEXT MATCH' : 'TRY AGAIN';
  setTimeout(() => el.over.classList.remove('hidden'), 700);
}

// ------------------------------------------------------------------ the shot
function resolveHit() {
  S.swing.resolved = true;
  sfx.swish();
  if (S.mode !== 'bowling' || ball.hit) return;
  const dx = (ball.pos.x - C.CONTACT.x) * 0.8;
  const dy = (ball.pos.y - C.CONTACT.y) * 0.7;
  const dz = ball.pos.z - C.CONTACT.z;
  const d = Math.hypot(dx, dy, dz);
  if (d > REACH) return;
  hitBall(1 - d / REACH, dz);
}

let gradeTimer = 0;
function showGrade(q, dz) {
  const g = el.grade;
  let text;
  let cls;
  if (q <= 0.2) { text = 'EDGE!'; cls = 'bad'; }
  else if (q > 0.85) { text = 'PERFECT!'; cls = 'perfect'; }
  else if (q > 0.6) { text = 'GOOD SHOT'; cls = 'good'; }
  else { text = dz < 0 ? 'TOO EARLY' : 'TOO LATE'; cls = 'bad'; }
  g.className = '';
  void g.offsetWidth;
  g.textContent = text;
  g.className = `show ${cls}`;
  clearTimeout(gradeTimer);
  gradeTimer = setTimeout(() => (g.className = ''), 1100);
}

const currentMult = () => (S.combo >= 5 ? 3 : S.combo >= 2 ? 2 : 1) * (S.boost ? 2 : 1);

function hitBall(q, dz) {
  const chai = S.chaiBalls > 0; // chai power: any contact flies for six
  if (chai) q = Math.max(q, 0.92);
  ball.hit = true;
  ball.bounced = false;
  ball.e = 0.55;
  ball.settle = 0;
  ball.age = 0;
  S.mode = 'live';
  S.history.length = 0;
  W.trail.visible = true;
  const lofted = S.lofted || chai;

  if (q < 0.2) {
    // thick edge – flies behind the batter
    const dirx = rand(-0.6, 0.6);
    const sp = rand(6, 11);
    ball.vel.set(dirx * sp, rand(1.5, 5), sp * rand(0.5, 1));
    sfx.edge();
    showGrade(0, dz);
    burst(ball.pos, [0xffffff, 0xffd23f], 8, 4, { size: 0.06 });
    S.slowT = 0.05; S.slowScale = 0.1;
    if (Math.random() < 0.5) {
      finish({ out: true, title: 'EDGE! OUT!', cls: 'out', subText: 'Keeper ne pakda! Aise kaun khelta hai?' });
    } else {
      finish({ runs: 1, title: 'LUCKY EDGE', cls: 'norm', subText: 'Thick edge, 1 run. Kismat!' });
    }
    return;
  }

  let yaw = S.aimYaw + clamp(ball.pos.x, -1, 1) * 0.15 - dz * 0.1 + (1 - q) * rand(-0.35, 0.35);
  if (chai) yaw = clamp(yaw, -0.2, 0.2); // keep it inside the gully walls
  const perfect = q > 0.85;
  const speed = (lofted ? 11 + q * 16 : 8 + q * 17) * (perfect ? 1.08 : 1);
  const vy = lofted ? 4 + 8 * (0.5 + 0.5 * q) : 0.5 + rand(0, 1.3);
  showGrade(q, dz);
  ball.vel.set(Math.sin(yaw) * speed, vy, -Math.cos(yaw) * speed);
  assignChaser();
  sfx.bat(q);
  S.shake = 0.12 + q * 0.18;
  S.slowT = perfect ? 0.16 : 0.07;
  S.slowScale = 0.06;
  burst(ball.pos, [0xffffff, 0xffe9a8, 0xffd23f], 10 + Math.round(q * 14), 4 + q * 4, { size: 0.07, life: 0.5 });
  if (q > 0.82) floater('💥', ball.pos.clone().add(new THREE.Vector3(0, 0.6, 0)), 1.0);
}

// ------------------------------------------------------------------ simulation
function breakWindow(w) {
  w.broken = true;
  w.glass.visible = false;
  const p = new THREE.Vector3(w.side * (C.HALF_W - 0.3), w.y, w.z);
  burst(p, [0xbfe6ff, 0xe6f6ff, 0x8fd0ff], 60, 5, { up: 3, size: 0.1, life: 1.4 });
  floater('😡', new THREE.Vector3(w.side * (C.HALF_W - 0.5), w.y + 0.4, w.z), 1.6);
  sfx.crash();
  S.shake = 0.6;
  finish({ out: true, title: 'SHEESHA TOOTA!', cls: 'out', subText: pick(['Window toota = OUT! Gully ka rule!', 'Uncle: "Kiska bacha hai ye?!"', 'Ghar wale bahar aa gaye... bhaago!']), uncle: 40, long: true });
}

function stepBall(h) {
  const b = ball;
  if (b.frozen) return;
  b.age += h;
  b.vel.y -= G * h;
  b.pos.addScaledVector(b.vel, h);

  // ground
  if (b.pos.y <= C.BR) {
    b.pos.y = C.BR;
    if (b.vel.y < -1.2) {
      b.vel.y *= -b.e;
      b.vel.x *= 0.92;
      b.vel.z *= b.hit ? 0.92 : 0.85;
      if (!b.hit && !b.bounced) b.vel.x += b.spin;
      if (b.hit) b.bounced = true;
      b.bounced = true;
      if (S.mode !== 'result') sfx.bounce();
      b.e = b.hit ? 0.5 : b.e * 0.8;
    } else {
      b.vel.y = 0;
      const k = Math.max(0, 1 - 1.0 * h);
      b.vel.x *= k;
      b.vel.z *= k;
    }
  }
  // side walls
  const lim = C.HALF_W - C.BR;
  if (Math.abs(b.pos.x) > lim) {
    const side = Math.sign(b.pos.x);
    b.pos.x = side * lim;
    if (b.hit && S.mode !== 'result') {
      const w = W.windows.find((w) => !w.broken && w.side === side && Math.abs(b.pos.z - w.z) < 0.85 && Math.abs(b.pos.y - w.y) < 0.75);
      if (w) {
        breakWindow(w);
        b.vel.x = -b.vel.x * 0.3;
        return;
      }
    }
    if (Math.abs(b.vel.x) > 1.5 && S.mode !== 'result') sfx.wall();
    b.vel.x = -b.vel.x * 0.62;
    b.bounced = true;
  }
  // end wall
  if (b.pos.z < C.END_Z + C.BR) {
    b.pos.z = C.END_Z + C.BR;
    b.vel.z = Math.abs(b.vel.z) * 0.3;
  }
  // behind the batter
  if (b.pos.z > C.BAT_Z + 7) {
    b.pos.z = C.BAT_Z + 7;
    b.vel.z = -Math.abs(b.vel.z) * 0.2;
  }
}

function step(h) {
  S.t += h;

  // swing clock
  if (S.swing.on) {
    S.swing.t += h;
    if (!S.swing.resolved && S.swing.t >= SW_CONTACT) resolveHit();
    if (S.swing.t >= SW_DUR + 0.25) S.swing.on = false;
  }

  switch (S.mode) {
    case 'ready': {
      if (S.holdUntil > 0 && !S.chaiPop && S.t >= S.holdUntil - 0.75) {
        S.chaiPop = true;
        pop('☕ CHAI POWER!', 'six');
        sub('Agli 3 gend = SIX! Bas bat ghumao!', 2400);
        sfx.power();
        burst(new THREE.Vector3(C.BAT_X, 1.4, C.BAT_Z), [0xffd23f, 0xff8a1f, 0xff3b30], 50, 5, { up: 3, size: 0.1, life: 1.2, grav: 0.4 });
        refreshHud();
      }
      if (S.t > Math.max(1.1, S.intro, S.holdUntil) && !trafficBlocks()) {
        S.mode = 'runup';
        S.t = 0;
        el.kind.textContent = S.delivery.name;
        el.kind.classList.add('show');
        sfx.tick();
      }
      break;
    }
    case 'runup': {
      const p = clamp(S.t / RUNUP, 0, 1);
      ball.pos.set(W.bowler.group.position.x + 0.3, 0.9, W.bowler.group.position.z + 0.3);
      if (S.t >= RUNUP) {
        poseBowler(0); // final overhead pose -> ball.pos = the bowling hand
        S.mode = 'bowling';
        S.t = 0;
        releaseBall();
      }
      break;
    }
    case 'bowling':
    case 'live':
    case 'result': {
      stepBall(h);
      if (ball.hit) moveFielders(h);
      if (S.mode === 'bowling') bowlingEvents();
      else if (S.mode === 'live') liveEvents(h);
      if (S.mode === 'result') {
        if (S.t > S.resultLen) {
          S.mode = 'waiting';
          nextBall();
        }
      }
      break;
    }
  }
}

function bowlingEvents() {
  const p = ball.pos;
  // pads
  if (p.z > C.BAT_Z - 0.5 && p.z < C.BAT_Z + 0.5 && p.x > -1.0 && p.x < -0.28 && p.y < 0.95) {
    sfx.catch();
    finish({ title: 'PAD PE LAGA!', cls: 'norm', subText: pick(['"How is that?!" — Nahi, gully mein LBW nahi hota!', 'Pad pe laga, dot ball.']), dead: true });
    return;
  }
  // bowled
  if (p.z >= C.STUMP_Z - 0.05 && Math.abs(p.x) < 0.22 && p.y < 0.82) {
    S.stumpFly = true;
    W.stumps.forEach((s) => (s.userData.vel = new THREE.Vector3(rand(-1.5, 1.5), rand(2, 5), rand(1, 3.5))));
    sfx.stumps();
    burst(new THREE.Vector3(0, 0.5, C.STUMP_Z), [0xfff1c9, 0xff5a36], 20, 5);
    finish({ out: true, title: 'BOWLED!', cls: 'out', subText: pick(['Stumps ud gaye! Bhaiya ne ghar bhej diya.', 'Clean bowled! Aapka bat kya decoration hai?', 'Teen stump, teen tukde!']), dead: true });
    return;
  }
  if (p.z > C.STUMP_Z + 2.5) {
    finish({
      title: S.swungThisBall ? 'SWING & MISS' : 'LEFT ALONE',
      cls: 'norm',
      subText: S.swungThisBall ? pick(['Bat hawa mein, gend peeche.', 'Timing kahan hai, bhai?']) : pick(['Dekhta hi reh gaya!', 'Bat uthana bhool gaye?']),
      dead: true,
    });
  }
}

// ---- fielders: the nearest kid chases the ball, catches it in the air or stops it on the ground
const F = W.fielders;
function resetFielders() {
  for (const f of F) {
    f.rig.group.position.set(clamp(f.home.x + rand(-1, 1), -5.2, 5.2), 0, f.home.z + rand(-1, 1));
    f.vel.set(0, 0, 0);
    f.celebrate = 0;
    f.scoop = 0;
    f.moving = false;
    f.face = 0;
  }
  S.chaser = -1;
}
function assignChaser() {
  const b = ball;
  const land = S.landing;
  if (b.vel.y > 1.5) {
    const disc = b.vel.y * b.vel.y + 2 * G * (b.pos.y - C.BR);
    const t = (b.vel.y + Math.sqrt(Math.max(0, disc))) / G;
    land.set(b.pos.x + b.vel.x * t, 0, b.pos.z + b.vel.z * t);
  } else {
    land.set(b.pos.x + b.vel.x * 0.9, 0, b.pos.z + b.vel.z * 0.9);
  }
  let best = -1;
  let bt = 1e9;
  F.forEach((f, i) => {
    const g = f.rig.group.position;
    const t = Math.hypot(g.x - land.x, g.z - land.z) / FIELD_SPEED;
    if (t < bt) { bt = t; best = i; }
  });
  S.chaser = best;
  S.chaseDelay = b.vel.y > 1.5 ? 0.45 : 0.2;
}
function moveFielders(h) {
  const b = ball;
  S.chaseDelay = Math.max(0, S.chaseDelay - h);
  F.forEach((f, i) => {
    const g = f.rig.group.position;
    f.moving = false;
    if (f.celebrate > 0) { f.celebrate -= h; return; }
    if (i !== S.chaser || S.chaseDelay > 0 || b.frozen) return;
    let tx;
    let tz;
    if (!b.bounced && b.pos.y > 0.6) { tx = S.landing.x; tz = S.landing.z; }
    else { tx = b.pos.x + b.vel.x * 0.3; tz = b.pos.z + b.vel.z * 0.3; }
    const dx = tx - g.x;
    const dz = tz - g.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.12) {
      const m = Math.min(FIELD_SPEED * h, d);
      g.x += (dx / d) * m;
      g.z += (dz / d) * m;
      f.face = Math.atan2(dx, dz);
      f.moving = true;
    }
  });
}
function fielding() {
  const b = ball;
  const p = b.pos;
  for (const f of F) {
    const g = f.rig.group.position;
    const d = Math.hypot(p.x - g.x, p.z - g.z);
    if (!b.bounced && !b.dropped && p.y > 0.3 && p.y < 2.3 && (b.vel.y < 1 || p.y < 1.4) && d < 0.85) {
      if (Math.random() < 0.3) {
        // butter fingers!
        b.dropped = true;
        b.vel.x *= 0.3;
        b.vel.z *= 0.3;
        b.vel.y = -2;
        f.scoop = 0.6;
        floater('😬', new THREE.Vector3(g.x, 2.6, g.z), 1.3);
        sfx.aww();
        sub('Catch chhoot gaya! Butter fingers!', 1600);
        continue;
      }
      b.attach = f.rig;
      f.celebrate = 1.8;
      sfx.catch();
      floater('🙌', new THREE.Vector3(g.x, 2.6, g.z), 1.3);
      finish({
        out: true,
        title: pick(['CATCH OUT!', 'CAUGHT!']),
        cls: 'out',
        subText: pick(['Chhotu ne catch pakda!', 'Pappu ne dive maar ke pakda!', 'Bunty ke haath mein gend! Out!']),
        dead: true,
        long: true,
      });
      return true;
    }
    if (b.bounced && p.y < 0.5 && d < 0.7) {
      const dist = C.CONTACT.z - g.z;
      const r = dist < 7 ? 0 : dist < 12 ? 1 : dist < 16 ? 2 : 3;
      b.attach = f.rig;
      f.scoop = 1.0;
      finish({
        runs: r,
        title: r === 0 ? 'DOT BALL' : r === 1 ? '1 RUN' : `${r} RUNS`,
        cls: r === 0 ? 'norm' : 'big',
        subText: r === 0 ? pick(['Fielder ne seedha roka.', 'Bacha liya! Ek bhi run nahi.']) : pick(['Daud ke liye!', 'Chalo chalo!', 'Singles chalte rahe!']),
        dead: true,
      });
      return true;
    }
  }
  return false;
}

const settleRuns = () => {
  const dist = C.CONTACT.z - ball.pos.z;
  return dist < 7 ? 0 : dist < 12 ? 1 : dist < 17 ? 2 : 3;
};

function liveEvents(h) {
  const b = ball;
  const p = b.pos;

  // boundary
  if (p.z < C.BOUNDARY_Z) {
    const six = !b.bounced;
    finish({
      runs: six ? 6 : 4,
      title: six ? 'SIX!' : 'FOUR!',
      cls: six ? 'six' : 'big',
      subText: six ? pick(['Seedha chhat pe!', 'Gend gayi mohalle ke bahar!', 'GALI KA BAAP!']) : pick(['Zameen ke saath boundary!', 'Chaar! Bacchon ki taaliyan!', 'Kya shot hai!']),
      celebrate: true,
    });
    return;
  }

  // the pole-mounted transformer: hit it and the whole street goes dark
  const tp = W.transformerPos;
  if (W.power && Math.abs(p.x - tp.x) < 1.5 && Math.abs(p.z - tp.z) < 1.2 && p.y > 2.2 && p.y < 5.8) {
    W.setPower(false);
    S.calledOff = true;
    sfx.boom();
    S.shake = 1.0;
    const f = $('flash');
    f.classList.remove('go');
    void f.offsetWidth;
    f.classList.add('go');
    document.body.classList.add('blackout');
    burst(tp.clone(), [0xffffff, 0xfff1a8, 0x9ad4ff, 0xff9a3c], 120, 9, { up: 3, size: 0.16, life: 1.6 });
    floater('💥', tp.clone().add(new THREE.Vector3(0.6, 0.8, 0)), 2.2);
    finish({ title: 'TRANSFORMER BLAST!', cls: 'out', subText: 'Bijli gul! Match called off.', dead: true, long: true });
    return;
  }

  if (fielding()) return;

  // Aunty on the balcony catches high balls
  if (p.x > 5.0 && p.y > 2.6 && p.y < 5.4 && Math.abs(p.z - C.BALCONY.z) < 1.6) {
    sfx.catch();
    W.aunty.catchT = 1.4;
    floater('🤲', new THREE.Vector3(6.0, 4.9, -6), 1.4);
    finish({ out: true, title: 'AUNTY CATCH!', cls: 'out', subText: 'Aunty: "Beta, gend meri ab!" — OUT!', dead: true, long: true });
    return;
  }

  // bhelpuri cart is solid: the ball stops dead and the vendor is not amused
  if (bhelOn && p.x > BHEL.x - 1.2 && p.x < BHEL.x + 1.2 && p.z > BHEL.z - 1.4 && p.z < BHEL.z + 1.4 && p.y < 2.8) {
    sfx.crash();
    burst(new THREE.Vector3(BHEL.x - 1, 1.4, BHEL.z), [0xffc233, 0xf2a23c, 0xe63946, 0x2a9d5c], 40, 4, { up: 3, life: 1.1 });
    floater('😡', new THREE.Vector3(BHEL.x - 1, 2.8, BHEL.z), 1.4);
    finish({ title: 'BHEL KHARAB!', cls: 'out', subText: 'Kailash bhaiya: "Meri bhelpuri pe gend?!"', uncle: 15, dead: true, long: true });
    return;
  }

  // tea cart
  const tcp = W.tea.position;
  if (p.x > tcp.x - 0.8 && p.x < tcp.x + 0.8 && p.z > tcp.z - 0.8 && p.z < tcp.z + 0.8 && p.y < 2.4) {
    sfx.splash();
    burst(new THREE.Vector3(tcp.x, 1.3, tcp.z), [0xc98a4b, 0xffe9b0, 0xffffff], 50, 4, { up: 4, life: 1.1 });
    floater('☕', new THREE.Vector3(tcp.x, 2.6, tcp.z), 1.3);
    W.vendor.cry = 1.5;
    finish({ runs: 2, title: 'CHAI CHHALAK GAYI!', cls: 'fun', subText: 'Chai boost! Next ball scores DOUBLE', uncle: 10, dead: true, long: true });
    S.boost = true;
    refreshHud();
    return;
  }

  // dog steals the ball
  if (W.dog.state === 'idle' && Math.hypot(p.x - W.dog.group.position.x, p.z - W.dog.group.position.z) < 0.75 && p.y < 1.0) {
    W.dog.state = 'fetch';
    sfx.bark();
    floater('🐕', new THREE.Vector3(W.dog.group.position.x, 1.8, W.dog.group.position.z), 1.2);
    finish({ title: 'KUTTA LE BHAGA!', cls: 'fun', subText: 'Dog ne gend utha li. Dot ball!', dead: true });
    return;
  }

  // cow blocks
  const cow = W.cow.group.position;
  if (Math.abs(p.x - cow.x) < 1.0 && Math.abs(p.z - cow.z) < 0.6 && p.y < 1.8) {
    sfx.moo();
    W.cow.startle = 1.0;
    floater('🐄', new THREE.Vector3(cow.x, 2.4, cow.z), 1.4);
    finish({ title: 'GAU MATA!', cls: 'fun', subText: 'Cow ne roka. Gau mata ko koi out nahi karta!', dead: true });
    return;
  }

  // passing traffic and pedestrians get in the way of the ball too
  for (const it of traffic.list) {
    if (!it.hit && Math.abs(p.x - it.x) < 0.75 && Math.abs(p.z - it.z) < it.v.len / 2 + 0.1 && p.y < 1.5) {
      it.hit = true;
      b.vel.x = (p.x > it.x ? 1 : -1) * rand(1.5, 3.5);
      b.vel.z *= -0.35;
      b.vel.y = Math.abs(b.vel.y) * 0.5 + 1.5;
      b.bounced = true;
      sfx.horn();
      S.uncle = clamp(S.uncle + 8, 0, 100);
      S.shake = 0.3;
      floater('😤', new THREE.Vector3(it.x, 2.2, it.z), 1.2);
      sub('Gaadi pe lagi! "Dekh ke khelo!"', 1600);
      refreshHud();
    }
  }
  for (const w of W.walkers) {
    if (Math.abs(p.x - w.x) < 0.55 && Math.abs(p.z - w.z) < 0.55 && p.y < 1.8) {
      sfx.aww();
      floater('😖', new THREE.Vector3(w.x, 2.4, w.z), 1.3);
      finish({ title: 'UNCLE KO LAG GAYI!', cls: 'fun', subText: 'Kisi ko lag gayi... sorry sorry!', uncle: 15, dead: true });
      return;
    }
  }

  // scooter bump (ball bounces back, uncle gets mad)
  if (!b.hitsScooter && p.x > 5.2 && p.x < 6.4 && p.z > -11.2 && p.z < -9.2 && p.y < 1.3) {
    b.hitsScooter = true;
    b.vel.x = -Math.abs(b.vel.x) * 0.7;
    b.vel.z *= 0.45;
    b.bounced = true;
    sfx.horn();
    S.uncle = clamp(S.uncle + 12, 0, 100);
    S.shake = 0.25;
    floater('💢', new THREE.Vector3(5.7, 1.9, -10.2), 1.2);
    sub('Scooter pe laga! "MERI GAADI!"', 1600);
    refreshHud();
  }

  // settle
  const speed = Math.hypot(b.vel.x, b.vel.z);
  if (p.y <= C.BR + 0.01 && speed < 0.8) b.settle += h;
  else b.settle = 0;
  if (b.settle > 0.3 || b.age > 7) {
    const r = settleRuns();
    finish({
      runs: r,
      title: r === 0 ? 'DOT BALL' : r === 1 ? '1 RUN' : `${r} RUNS`,
      cls: r === 0 ? 'norm' : 'big',
      subText: r === 0 ? pick(['Seedha fielder ke haath mein.', 'Gend mein dum nahi tha.']) : pick(['Daud ke liye!', 'Chalo chalo!', 'Singles chalte rahe!']),
      dead: true,
    });
  }
}

// ------------------------------------------------------------------ visuals
const camBase = new THREE.Vector3(0.5, 2.6, 11.6);
const lookBase = new THREE.Vector3(0.3, 0.6, -3);
const camLook = lookBase.clone();
const _tgt = new THREE.Vector3();
let batYaw = -0.5;
let batTilt = 0.55;
let time = 0;

// ---- pose helpers (work on makePerson rigs)
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
function resetPose(r) {
  r.legL.rotation.set(0, 0, 0);
  r.legR.rotation.set(0, 0, 0);
  r.kneeL.rotation.set(0, 0, 0);
  r.kneeR.rotation.set(0, 0, 0);
  r.armL.rotation.set(0, 0, 0.08);
  r.armR.rotation.set(0, 0, -0.08);
  r.elbowL.rotation.set(-0.15, 0, 0);
  r.elbowR.rotation.set(-0.15, 0, 0);
  r.torso.rotation.set(0, 0, 0);
  r.root.position.y = 0;
}
function crouch(r, a) {
  r.legL.rotation.x = r.legR.rotation.x = -0.55 * a;
  r.kneeL.rotation.x = r.kneeR.rotation.x = 1.0 * a;
  r.root.position.y = -0.11 * a;
}
function runCycle(r, ph, amp = 1) {
  const a = Math.sin(ph);
  const b = Math.sin(ph + Math.PI);
  r.legL.rotation.x = a * 0.95 * amp;
  r.legR.rotation.x = b * 0.95 * amp;
  r.kneeL.rotation.x = Math.max(0, -Math.cos(ph)) * 1.4 * amp + 0.1;
  r.kneeR.rotation.x = Math.max(0, Math.cos(ph)) * 1.4 * amp + 0.1;
  r.armL.rotation.x = b * 0.9 * amp;
  r.armR.rotation.x = a * 0.9 * amp;
  r.elbowL.rotation.x = r.elbowR.rotation.x = -1.2;
  r.root.position.y = Math.abs(Math.sin(ph)) * 0.05;
  r.torso.rotation.x = 0.22 * amp;
}
function armsUp(r, bend = 0.3) {
  r.armL.rotation.x = r.armR.rotation.x = -2.9;
  r.armL.rotation.z = 0.35;
  r.armR.rotation.z = -0.35;
  r.elbowL.rotation.x = r.elbowR.rotation.x = -bend;
}
function lookAtPoint(r, x, z, k = 0.2) {
  const g = r.group.position;
  const rel = clamp(wrapAngle(Math.atan2(x - g.x, z - g.z) - r.group.rotation.y - r.torso.rotation.y), -1.1, 1.1);
  r.head.rotation.y = lerp(r.head.rotation.y, rel, k);
}

// four-legged walk cycle: diagonal pairs swing together, knees flex on the way forward
function legSwing(legs, ph, amp, kneeAmp) {
  legs.forEach((l, i) => {
    const p = ph + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI / 2 : 0);
    l.rotation.z = Math.sin(p) * amp;
    l.userData.knee.rotation.z = -Math.max(0, -Math.cos(p)) * kneeAmp;
  });
}

function turnTo(obj, target, k) {
  obj.rotation.y += wrapAngle(target - obj.rotation.y) * k;
}

// ---- two-bone arm IK: puts a hand exactly on a world-space target (so hands really hold the bat / ball)
const _ikv = new THREE.Vector3();
const _iku = new THREE.Vector3();
const _ikn = new THREE.Vector3();
const _ikf = new THREE.Vector3();
const _ikqS = new THREE.Quaternion();
const _ikqF = new THREE.Quaternion();
const DOWN = new THREE.Vector3(0, -1, 0);
const POLE_L = new THREE.Vector3(-0.7, -0.8, -0.35);
const POLE_R = new THREE.Vector3(0.7, -0.8, -0.35);
function ikArm(rig, side, worldTarget) {
  (rig.handTarget || (rig.handTarget = {}))[side < 0 ? 'L' : 'R'] = worldTarget.clone();
  const sh = side < 0 ? rig.armL : rig.armR;
  const el = side < 0 ? rig.elbowL : rig.elbowR;
  const pole = side < 0 ? POLE_L : POLE_R;
  const l1 = 0.29;
  const l2 = 0.33;
  _ikv.copy(worldTarget);
  rig.torso.worldToLocal(_ikv);
  _ikv.sub(sh.position);
  const d = clamp(_ikv.length(), 0.12, l1 + l2 - 0.004);
  _ikv.setLength(d);
  const vh = _ikf.copy(_ikv).normalize();
  const A = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
  _ikn.crossVectors(vh, pole);
  if (_ikn.lengthSq() < 1e-5) _ikn.set(1, 0, 0);
  _ikn.normalize();
  const u1 = _iku.copy(vh).applyAxisAngle(_ikn, A);
  const u2 = vh.clone().applyAxisAngle(_ikn, -A);
  const u = u1.dot(pole) >= u2.dot(pole) ? u1.clone() : u2;
  sh.quaternion.setFromUnitVectors(DOWN, u);
  const f = _ikv.clone().sub(u.clone().multiplyScalar(l1)).normalize();
  _ikqF.setFromUnitVectors(DOWN, f);
  el.quaternion.copy(_ikqS.copy(sh.quaternion).invert().multiply(_ikqF));
}
const _bw = new THREE.Vector3();
const _hd = new THREE.Vector3();
const syncRig = (r) => { if (r.model) r.model.sync(); };
const handPos = (r, out) => (r.model ? r.model.handPos('R', out) : r.handR.getWorldPosition(out));
const gripCur = new THREE.Vector3(0.05, 0.3, 0.34);
const gripTgt = new THREE.Vector3();

// the glass of cutting chai he drinks on BOOST
const cup = new THREE.Group();
{
  // a tapered "cutting chai" glass: clear walls, milky-brown chai, foam on top, thick base
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.028, 0.09, 20, 1, true), new THREE.MeshStandardMaterial({ color: 0xeaf4ff, transparent: true, opacity: 0.32, roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false }));
  const tea = new THREE.Mesh(new THREE.CylinderGeometry(0.0335, 0.0275, 0.07, 20), new THREE.MeshStandardMaterial({ color: 0xc27a2c, roughness: 0.3, emissive: 0x4a2306, emissiveIntensity: 0.6 }));
  tea.position.y = -0.008;
  const foam = new THREE.Mesh(new THREE.CylinderGeometry(0.0335, 0.0335, 0.006, 20), new THREE.MeshStandardMaterial({ color: 0xf1d9b0, roughness: 0.9 }));
  foam.position.y = 0.029;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.0025, 8, 24), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1 }));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.045;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.03, 0.012, 20), new THREE.MeshStandardMaterial({ color: 0xdfeaf2, transparent: true, opacity: 0.7 }));
  base.position.y = -0.045;
  cup.add(glass, tea, foam, rim, base);
  cup.scale.setScalar(1.5);
  cup.visible = false;
  scene.add(cup);
}
const _hp = new THREE.Vector3();
const _mouth = new THREE.Vector3();
const _rest = new THREE.Vector3();
const sm3 = (x) => {
  x = clamp(x, 0, 1);
  return x * x * (3 - 2 * x);
};

function poseBatter(dt) {
  const bt = W.batter;
  resetPose(bt);
  const react = S.react.t > 0 ? S.react.kind : null;
  // 'stand' = how much he stands upright facing the camera (first-ball intro, chai break) vs. his batting stance
  const intro = S.mode === 'ready' ? Math.max(0, S.intro - S.t) : 0;
  let stand = intro > 0 ? 1 - sm3(1 - intro / 0.9) : 0;
  const dT = S.mode === 'ready' && S.holdUntil > 0 ? S.t - (S.holdUntil - DRINK_LEN) : -1;
  const drinking = dT >= 0 && dT < DRINK_LEN;
  if (drinking) stand = Math.max(stand, sm3(dT / 0.5) * (1 - sm3((dT - 2.05) / 0.6)));
  const st = 1 - stand;
  const sip = drinking ? sm3((dT - 0.45) / 0.35) * (1 - sm3((dT - 1.95) / 0.3)) : 0;
  const pulse = drinking && dT > 0.8 ? 0.5 + 0.5 * Math.sin((dT - 0.8) * 4.4 - 1.57) : 0;
  let ty = -0.3;
  let tt = 0.3;
  let sw = 0;
  if (S.swing.on) {
    const q = clamp(S.swing.t / SW_DUR, 0, 1);
    sw = q;
    ty = -1.94 + 3.6 * q;
    tt = lerp(0.4, 1.4, clamp(q * 3.5, 0, 1));
    batYaw = ty;
    batTilt = tt;
  } else {
    if (react === 'six' || react === 'run') { ty = 0.2; tt = 2.7; }
    else if (react === 'out' || drinking) { ty = -0.3; tt = 0.1; }
    const k = 1 - Math.exp(-8 * dt);
    batYaw = lerp(batYaw, ty, k);
    batTilt = lerp(batTilt, tt, k);
  }
  W.bat.rotation.set(batTilt, batYaw, 0);
  const off = (batYaw + 0.3) * 0.28;
  bt.group.rotation.y = lerp(0, 2.36 + off, st);

  // stance: knees bent, bat tapping, eyes on the ball
  const wait = S.mode === 'ready' || S.mode === 'runup';
  crouch(bt, S.swing.on ? lerp(0.95, 0.3, clamp(sw * 2, 0, 1)) : lerp(0.05, 0.95, st) + (wait ? Math.sin(time * 5) * 0.04 : 0));
  bt.legL.rotation.x -= S.swing.on ? 0.25 * sw : 0.15; // front foot strides into the shot
  bt.torso.rotation.x = S.swing.on ? lerp(0.55, 0.15, sw) : lerp(0.02, 0.55, st);
  bt.torso.rotation.y = S.swing.on ? (sw - 0.35) * 0.5 : 0;
  bt.head.rotation.x = react === 'out' ? 0.35 : -0.3 * sip * pulse;
  bt.group.position.y = react === 'six' || react === 'run' ? Math.abs(Math.sin(time * 10)) * 0.25 : 0;
  if (react === 'six' || react === 'run') {
    bt.torso.rotation.x = -0.1;
    bt.legL.rotation.x = bt.legR.rotation.x = 0;
    bt.kneeL.rotation.x = bt.kneeR.rotation.x = 0;
    bt.root.position.y = 0;
  } else if (react === 'out') {
    bt.torso.rotation.x = 0.25;
  }

  // where the hands hold the bat (torso space) -> world, then both arms reach it via IK
  if (S.swing.on) gripTgt.set(lerp(0.15, -0.25, sw), 0.3, lerp(0.3, 0.42, sw));
  else if (react === 'six' || react === 'run') gripTgt.set(0.1, 0.95, 0.22);
  else if (react === 'out') gripTgt.set(0.05, 0.18, 0.32);
  else if (drinking) gripTgt.set(-0.16, 0.02, 0.26); // bat hangs low in the left hand
  else gripTgt.set(0.04, 0.2, 0.36);
  if (S.swing.on) gripCur.copy(gripTgt);
  else gripCur.lerp(gripTgt, 1 - Math.exp(-12 * dt));
  bt.group.updateMatrixWorld(true);
  bt.torso.localToWorld(W.bat.position.copy(gripCur));
  W.bat.updateMatrixWorld(true);
  _hd.set(0, 1, 0).applyQuaternion(W.bat.quaternion); // handle direction
  ikArm(bt, -1, _bw.copy(W.bat.position).addScaledVector(_hd, -0.02)); // top hand
  ikArm(bt, 1, _bw.copy(W.bat.position).addScaledVector(_hd, -0.17)); // bottom hand
  if (drinking) {
    // right hand brings the glass up to his mouth for a couple of sips
    const s = bt.scale || 1;
    const hb = bt.model && bt.model.bones && bt.model.bones.head;
    if (hb) hb.getWorldPosition(_hp);
    else bt.head.getWorldPosition(_hp);
    const yaw = bt.group.rotation.y + bt.torso.rotation.y;
    _mouth.set(_hp.x + Math.sin(yaw) * 0.14 * s, _hp.y + (hb ? -0.07 : -0.12) * s, _hp.z + Math.cos(yaw) * 0.14 * s);
    bt.torso.localToWorld(_rest.set(0.22, 0.02, 0.3));
    _mouth.y += 0.02 * pulse * sip;
    POLE_R.set(0.35, -1, -0.15); // elbow stays low and close to the body
    ikArm(bt, 1, _bw.lerpVectors(_rest, _mouth, sip));
    POLE_R.set(0.7, -0.8, -0.35);
    if (dT > 0.8 && !S.sl1) { S.sl1 = true; sfx.slurp(); }
    if (dT > 1.5 && !S.sl2) { S.sl2 = true; sfx.slurp(); }
  }
  syncRig(bt);
  if (drinking && dT < 2.45) {
    handPos(bt, cup.position);
    cup.position.y += 0.01;
    cup.rotation.x = -0.45 * sip * pulse; // tips towards his mouth on each sip
    cup.visible = true;
    if (Math.random() < 0.35) puff(_hp.copy(cup.position).setY(cup.position.y + 0.1), { size: 0.06, life: 1.3, vel: [0, 0.22, 0], grow: 2.6, opacity: 0.4 });
  } else cup.visible = false;
  if (S.chaiBalls > 0 && Math.random() < 0.35) puff(W.bat.position, { color: Math.random() < 0.5 ? 0xffd23f : 0xff8a1f, size: 0.07, life: 0.7, vel: [0, 0.5, 0], grow: 0.6, opacity: 0.9, additive: true });

  const showing = S.mode === 'bowling' || S.mode === 'live' || (S.mode === 'result' && ball.hit);
  if (stand > 0.5) lookAtPoint(bt, camBase.x, camBase.z, 0.2);
  else if (showing) lookAtPoint(bt, ball.pos.x, ball.pos.z, 0.25);
  else lookAtPoint(bt, W.bowler.group.position.x, W.bowler.group.position.z, 0.15);
}

function poseBowler(realDt) {
  const bw = W.bowler;
  resetPose(bw);
  const react = S.react.t > 0 ? S.react.kind : null;
  if (S.mode === 'ready') {
    bw.armR.rotation.x = -0.6;
    bw.elbowR.rotation.x = -1.0;
    bw.torso.rotation.x = 0.1 + Math.sin(time * 2) * 0.02;
    bw.armL.rotation.x = 0.2;
  } else if (S.mode === 'runup') {
    // underarm: ball held at the chest, arm swings back, then forward and releases low
    const p = clamp(S.t / RUNUP, 0, 1);
    const sm = (lo, hi) => {
      const x = clamp((p - lo) / (hi - lo), 0, 1);
      return x * x * (3 - 2 * x);
    };
    const back = sm(0.1, 0.5);
    const fwd = sm(0.5, 1);
    bw.armR.rotation.x = lerp(lerp(-0.5, 0.9, back), -1.15, fwd);
    bw.elbowR.rotation.x = lerp(-0.9, -0.1, back);
    bw.armL.rotation.x = -0.5 - 0.3 * fwd;
    bw.torso.rotation.x = lerp(0.04, 0.15, fwd);
    bw.legL.rotation.x = lerp(0, -0.5, fwd); // steps into the delivery
    bw.kneeL.rotation.x = 0.15 * fwd;
    bw.kneeR.rotation.x = 0.3 * fwd;
    bw.root.position.y = -0.05 * sm(0.3, 0.9);
    bw.group.updateMatrixWorld(true);
    syncRig(bw);
    handPos(bw, ball.pos);
  } else {
    S.follow += realDt;
    const f = clamp(S.follow / 0.3, 0, 1);
    const e = f * f * (3 - 2 * f);
    const relax = clamp((S.follow - 0.8) / 0.6, 0, 1);
    bw.armR.rotation.x = lerp(lerp(-1.15, -1.7, e), 0.2, relax);
    bw.elbowR.rotation.x = -0.15;
    bw.armL.rotation.x = lerp(lerp(-0.8, 0.3, e), 0.1, relax);
    bw.torso.rotation.x = lerp(lerp(0.15, 0.4, e), 0.1, relax);
    bw.legL.rotation.x = lerp(-0.5, 0, relax);
    bw.kneeL.rotation.x = lerp(0.15, 0, relax);
    bw.legR.rotation.x = 0;
    bw.kneeR.rotation.x = lerp(0.3, 0, relax);
    bw.root.position.y = lerp(-0.05, 0, relax);
    if (react === 'out') { armsUp(bw, 0.3); bw.group.position.y = Math.abs(Math.sin(time * 10)) * 0.25; }
    else if (react === 'six') { armsUp(bw, 2.4); bw.armL.rotation.x = bw.armR.rotation.x = -2.5; bw.torso.rotation.x = 0.2; }
  }
  if (!(react === 'out' && S.mode !== 'runup')) bw.group.position.y = 0;
  if (S.mode !== 'runup') syncRig(bw);
  const watching = S.mode === 'bowling' || S.mode === 'live' || S.mode === 'result';
  if (watching) lookAtPoint(bw, ball.hit ? ball.pos.x : C.BAT_X, ball.hit ? ball.pos.z : C.BAT_Z, 0.2);
  else lookAtPoint(bw, C.BAT_X, C.BAT_Z, 0.2);
}

function animateFielders(dt) {
  const calm = S.mode === 'ready' || S.mode === 'runup' || S.mode === 'bowling';
  for (let i = 0; i < F.length; i++) {
    const f = F[i];
    const r = f.rig;
    const g = r.group.position;
    resetPose(r);
    g.y = 0;
    if (f.celebrate > 0) {
      r.torso.rotation.x = -0.1;
      g.y = Math.abs(Math.sin(time * 10 + i)) * 0.28;
      lookAtPoint(r, ball.pos.x, ball.pos.z, 0.3);
      r.group.updateMatrixWorld(true);
      // hands together above the head, ball safely caught
      ikArm(r, -1, r.torso.localToWorld(_bw.set(-0.05, 1.05, 0.28)));
      ikArm(r, 1, r.torso.localToWorld(_bw.set(0.05, 1.05, 0.28)));
    } else if (f.scoop > 0) {
      f.scoop -= dt;
      crouch(r, 1.15);
      r.torso.rotation.x = 0.85;
      r.group.updateMatrixWorld(true);
      const yaw = r.group.rotation.y;
      const fx = g.x + Math.sin(yaw) * 0.5;
      const fz = g.z + Math.cos(yaw) * 0.5;
      const lift = clamp(1 - (f.scoop - 0.3) / 0.4, 0, 1); // pick up, then bring the ball up to the chest
      ikArm(r, -1, _bw.set(fx - 0.08, lerp(0.12, 0.95, lift), fz));
      ikArm(r, 1, _bw.set(fx + 0.08, lerp(0.12, 0.95, lift), fz));
    } else if (f.moving) {
      runCycle(r, time * 15 + i, 1.05);
      turnTo(r.group, f.face, 0.3);
      lookAtPoint(r, ball.pos.x, ball.pos.z, 0.3);
    } else {
      // ready stance: knees bent, hands on knees, weight shifting, the odd clap
      const a = Math.sin(time * 1.7 + i * 1.9);
      crouch(r, 0.6 + 0.1 * a);
      r.torso.rotation.x = 0.42 + 0.05 * a;
      r.armL.rotation.x = r.armR.rotation.x = -0.65;
      r.elbowL.rotation.x = r.elbowR.rotation.x = -0.35;
      r.legL.rotation.z = 0.12;
      r.legR.rotation.z = -0.12;
      if (calm && Math.sin(time * 0.45 + i * 2.7) > 0.94) {
        const c = Math.sin(time * 20);
        r.torso.rotation.x = 0.1;
        r.armL.rotation.x = r.armR.rotation.x = -1.25;
        r.armL.rotation.z = 0.5 - c * 0.2;
        r.armR.rotation.z = -0.5 + c * 0.2;
        r.elbowL.rotation.x = r.elbowR.rotation.x = -1.4;
      }
      if (calm) {
        turnTo(r.group, Math.atan2(C.BAT_X - g.x, C.BAT_Z - g.z), 0.08);
        lookAtPoint(r, ball.pos.x, ball.pos.z + 3, 0.1);
      } else {
        lookAtPoint(r, ball.pos.x, ball.pos.z, 0.25);
      }
    }
    syncRig(r);
  }
}

function animatePeople(realDt) {
  // chaiwala stirs the pot, hand on hip
  const v = W.vendor;
  resetPose(v);
  v.armR.rotation.x = -1.0;
  v.elbowR.rotation.x = -0.9 + Math.sin(time * 5) * 0.3;
  v.armL.rotation.z = 0.5;
  v.elbowL.rotation.x = -1.6;
  v.legL.rotation.x = 0.1;
  if (v.cry > 0) { v.cry -= realDt; armsUp(v, 2.0); v.armL.rotation.x = v.armR.rotation.x = -2.6; }
  // aunty leans on the railing; throws her hands up for a catch
  const au = W.aunty;
  resetPose(au);
  if (au.catchT > 0) {
    au.catchT -= realDt;
    armsUp(au, 0.2);
  } else {
    au.armL.rotation.x = au.armR.rotation.x = -0.8;
    au.elbowL.rotation.x = au.elbowR.rotation.x = -0.5 + Math.sin(time * 1.3) * 0.05;
    au.torso.rotation.x = 0.15;
  }
  au.group.position.y = 3.075 + (au.catchT > 0 ? Math.abs(Math.sin(time * 14)) * 0.1 : 0);
  syncRig(au);
  syncRig(v);
  // the regulars at the chai tapri / sabzi cart: weight shifts, glances, an occasional sip
  W.regulars.forEach((r, i) => {
    resetPose(r);
    const sip = Math.sin(time * 0.5 + i * 2.1) > 0.85;
    r.torso.rotation.x = 0.03 + Math.sin(time * 1.4 + i) * 0.015;
    r.armL.rotation.x = -0.6;
    r.elbowL.rotation.x = -1.2;
    r.armR.rotation.x = sip ? -1.9 : -0.4;
    r.elbowR.rotation.x = sip ? -1.3 : -0.9;
    r.legL.rotation.x = 0.08 + Math.sin(time * 0.7 + i) * 0.04;
    r.head.rotation.y = Math.sin(time * 0.5 + i * 1.7) * 0.5;
    r.head.rotation.x = sip ? -0.2 : 0;
    syncRig(r);
  });
  // kids on the kerb
  S.cheerT = Math.max(0, S.cheerT - realDt);
  W.kids.forEach((k, i) => {
    resetPose(k);
    if (S.cheerT > 0) {
      armsUp(k, 0.4);
      k.armL.rotation.x += Math.sin(time * 14 + i) * 0.3;
      k.armR.rotation.x += Math.cos(time * 14 + i) * 0.3;
      k.group.position.y = 0.16 + Math.abs(Math.sin(time * 9 + i * 1.3)) * 0.45;
    } else {
      const c = Math.sin(time * 0.6 + i * 2) > 0.9 ? Math.sin(time * 18) : 0; // clapping now and then
      k.armL.rotation.x = k.armR.rotation.x = c ? -1.2 : Math.sin(time * 2 + i) * 0.1;
      k.elbowL.rotation.x = k.elbowR.rotation.x = c ? -1.3 : -0.15;
      k.armL.rotation.z = c ? 0.45 - c * 0.15 : 0.08;
      k.armR.rotation.z = c ? -0.45 + c * 0.15 : -0.08;
      k.group.position.y = 0.16 + Math.abs(Math.sin(time * 3 + i)) * 0.015;
    }
    syncRig(k);
  });
}

// ------------------------------------------------------------------ life in the gully: traffic + pedestrians
let TPL = null; // real-model templates once loaded
const riderPool = [];
const traffic = { list: [], timer: rand(5, 9), noted: false };
const VEHICLES = [{ kind: 'auto', w: 1, speed: [6.5, 8.5], colors: [0xf2c230], yaw: Math.PI }]; // the real auto-rickshaw model is the only vehicle
const _vt = new THREE.Vector3();
const _vt2 = new THREE.Vector3();

function getRider() {
  if (riderPool.length) return riderPool.pop();
  const rig = makePerson({
    shirt: pick([0x5a6fd6, 0xcf5a4a, 0x7fc6a4, 0xd9a441, 0xe8e0d0, 0x3a3a48]),
    accent: 0xffffff,
    pants: pick([0x2f3550, 0x23323a, 0x4a3c30]),
    skin: pick([0xc68a5c, 0xb07a4d, 0xd9a273]),
    hair: 0x1b1410,
    scale: rand(0.97, 1.03),
    style: pick(['short', 'spiky']),
  });
  rig.opts.height = rand(0.97, 1.04);
  if (TPL && (TPL.male || TPL.female)) {
    const tpl = TPL.male || TPL.female;
    dressRig(rig, tpl, { shirt: rig.opts.shirt, pants: rig.opts.pants, shoe: 0x222222, skin: pick(skinTints), hideBeard: Math.random() < 0.5, height: rig.opts.height });
  }
  return rig;
}

const VEH_TPL = {}; // real vehicle models, when present in public/models/vehicles/<kind>.glb
function spawnVehicle() {
  const pool = VEHICLES.filter((k) => !k.glbOnly || VEH_TPL[k.kind]);
  let r = Math.random() * pool.reduce((a, k) => a + k.w, 0);
  let spec = pool[0];
  for (const k of pool) {
    r -= k.w;
    if (r <= 0) { spec = k; break; }
  }
  const v = makeVehicle(spec.kind, pick(spec.colors));
  if (VEH_TPL[spec.kind]) {
    // swap the built-from-boxes body for the real model (riders keep their seat positions)
    v.group.children.slice().forEach((c) => (c.visible = false));
    v.group.add(cloneModel(VEH_TPL[spec.kind], { length: spec.len || v.len, yaw: spec.yaw || 0 }));
    v.rider = false; // the real model brings its own driver
  }
  const dir = Math.random() < 0.5 ? 1 : -1; // +1 drives towards the camera
  const x = spec.kind === 'cycle' ? pick([-3.6, 3.6]) : pick([-3.2, -1.6, 0, 1.8, 3.2]);
  const z = dir > 0 ? -40 : 17;
  v.group.position.set(x, 0, z);
  v.group.rotation.y = dir > 0 ? 0 : Math.PI;
  scene.add(v.group);
  let rig = null;
  if (v.rider) {
    rig = getRider();
    rig.group.position.set(v.seat.x, v.seat.y - 0.93 * rig.scale, v.seat.z);
    v.group.add(rig.group);
    rig.group.visible = true;
  }
  const item = { v, spec, dir, x, z, speed: rand(spec.speed[0], spec.speed[1]), rig, snd: makeEngine(spec.kind), honked: false, pedal: 0, hit: false };
  traffic.list.push(item);
  traffic.noted = false;
}

function removeVehicle(item) {
  scene.remove(item.v.group);
  if (item.rig) {
    item.v.group.remove(item.rig.group);
    riderPool.push(item.rig);
  }
  if (item.snd) item.snd.stop();
  item.v.group.traverse((o) => {
    if (o.isMesh) {
      if (o.userData.shared) return;
      o.geometry.dispose();
      if (o.material.isMeshBasicMaterial) o.material.dispose();
    } else if (o.isSprite) o.material.dispose();
  });
  traffic.list.splice(traffic.list.indexOf(item), 1);
}

function poseRider(item) {
  const r = item.rig;
  const k = item.spec.kind;
  resetPose(r);
  const cyc = k === 'cycle';
  const lean = k === 'bike' ? 0.5 : cyc ? 0.45 : k === 'auto' ? 0.12 : 0.22;
  r.torso.rotation.x = lean;
  if (cyc) {
    const a = Math.sin(item.pedal);
    const b = Math.sin(item.pedal + Math.PI);
    r.legL.rotation.x = -0.95 + a * 0.45;
    r.legR.rotation.x = -0.95 + b * 0.45;
    r.kneeL.rotation.x = 1.25 - a * 0.55;
    r.kneeR.rotation.x = 1.25 - b * 0.55;
  } else {
    const t = k === 'bike' ? -1.15 : k === 'auto' ? -1.35 : -1.3;
    r.legL.rotation.x = r.legR.rotation.x = t;
    r.legL.rotation.z = 0.06;
    r.legR.rotation.z = -0.06;
    r.kneeL.rotation.x = r.kneeR.rotation.x = 1.45;
  }
  item.v.group.updateMatrixWorld(true);
  ikArm(r, -1, item.v.group.localToWorld(_vt.copy(item.v.hands.L)));
  ikArm(r, 1, item.v.group.localToWorld(_vt2.copy(item.v.hands.R)));
  syncRig(r);
}

const trafficBlocks = () => traffic.list.length > 0;

function updateTraffic(dt, realDt) {
  // vehicles only turn up between balls, and the next ball waits until the lane is clear
  const between = S.mode === 'ready' || S.mode === 'result';
  if (between && traffic.list.length === 0) {
    traffic.timer -= realDt;
    if (traffic.timer <= 0 && S.mode === 'ready') {
      spawnVehicle();
      traffic.timer = rand(10, 18);
    }
  }
  for (let i = traffic.list.length - 1; i >= 0; i--) {
    const it = traffic.list[i];
    const sp = it.speed;
    it.z += it.dir * sp * dt;
    it.v.group.position.z = it.z;
    for (const w of it.v.wheels) w.g.rotation.x += (sp * dt) / w.r;
    it.pedal += sp * dt * 2.2;
    if (!it.honked && it.spec.kind !== 'cycle' && Math.abs(it.z - 11) < 30) {
      it.honked = true;
      sfx.horn();
    }
    if (it.snd) {
      const dist = Math.abs(it.z - camBase.z);
      const vol = clamp(1 - dist / 55, 0, 1) * (it.spec.kind === 'car' ? 0.2 : 0.26);
      const pitch = 1 + 0.1 * -Math.tanh(((it.z - camBase.z) * it.dir) / 9);
      it.snd.set(vol * vol * 2.2, pitch);
    }
    if (it.rig) poseRider(it);
    if ((it.dir > 0 && it.z > 18) || (it.dir < 0 && it.z < -42)) removeVehicle(it);
  }
  if (traffic.list.length && S.mode === 'ready' && S.t > 1.1 && !traffic.noted) {
    traffic.noted = true;
    sub('GAADI AA RAHI HAI! Raasta do...', 2200);
  }
}

function updateWalkers(dt) {
  for (const w of W.walkers) {
    const r = w.rig;
    if (w.pause > 0) {
      w.pause -= dt;
      resetPose(r);
      r.torso.rotation.x = 0.04;
      r.elbowL.rotation.x = r.elbowR.rotation.x = -0.3;
      syncRig(r);
      continue;
    }
    if (w.cross) {
      w.x += w.dir * w.speed * dt;
      if (Math.abs(w.x) > C.HALF_W - 1.4) {
        w.dir = -Math.sign(w.x);
        w.x = Math.sign(w.x) * (C.HALF_W - 1.4);
        w.pause = rand(2, 5);
        w.z = rand(-44, -24);
      }
    } else {
      w.z += w.dir * w.speed * dt;
      if (w.z > 15 || w.z < -48) {
        w.dir = -w.dir;
        w.pause = rand(1, 4);
      }
    }
    w.phase += w.speed * dt * 2.6;
    runCycle(r, w.phase, 0.5);
    r.torso.rotation.x = 0.05;
    r.elbowL.rotation.x = r.elbowR.rotation.x = -0.35;
    r.group.position.set(w.x, Math.abs(w.x) > 5.5 ? 0.16 : 0, w.z);
    r.group.rotation.y = w.cross ? (w.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : w.dir > 0 ? 0 : Math.PI;
    r.group.position.y += r.root.position.y * 0; // (bob is inside root)
    syncRig(r);
  }
}

const BHEL = { x: 8.4, z: -5.4 };
let bhelOn = false;
let bhelMixer = null;
function animate(dt, realDt) {
  if (bhelMixer) bhelMixer.update(realDt);
  time += dt;

  S.react.t = Math.max(0, S.react.t - realDt);
  poseBatter(realDt);

  poseBowler(realDt);
  animatePeople(realDt);
  animateFielders(dt);
  updateTraffic(dt, realDt);
  updateWalkers(realDt);
  if (ball.attach) {
    ball.attach.group.updateMatrixWorld(true);
    handPos(ball.attach, ball.pos);
  }

  // ball + shadow + trail
  const showBall = S.mode === 'runup' || S.mode === 'bowling' || S.mode === 'live' || S.mode === 'result';
  W.ball.visible = showBall;
  W.blob.visible = showBall && ball.pos.y < 6;
  if (showBall) {
    W.ball.position.copy(ball.pos);
    W.ball.rotation.x += dt * 12;
    W.blob.position.set(ball.pos.x, 0.02, ball.pos.z);
    const k = 1 / (1 + ball.pos.y * 0.6);
    W.blob.scale.setScalar(k);
    W.blob.material.opacity = 0.38 * k;
  }
  if (ball.hit && !ball.frozen) {
    S.history.unshift(ball.pos.x, ball.pos.y, ball.pos.z);
    if (S.history.length > 90) S.history.length = 90;
  }
  if (W.trail.visible) {
    const a = W.trail.geometry.attributes.position.array;
    const n = S.history.length / 3;
    for (let i = 0; i < 30; i++) {
      const j = Math.min(i, Math.max(0, n - 1)) * 3;
      a[i * 3] = S.history[j] ?? 0;
      a[i * 3 + 1] = S.history[j + 1] ?? 0;
      a[i * 3 + 2] = S.history[j + 2] ?? 0;
    }
    W.trail.geometry.attributes.position.needsUpdate = true;
    W.trail.geometry.setDrawRange(0, Math.min(30, Math.max(0, n)));
  }

  // flying stumps
  if (S.stumpFly) {
    for (const s of W.stumps) {
      const v = s.userData.vel;
      if (!v) continue;
      v.y -= G * dt;
      s.position.addScaledVector(v, dt);
      s.rotation.x += dt * 9;
      s.rotation.z += dt * 6;
      if (s.position.y < 0.05) { s.position.y = 0.05; v.multiplyScalar(0.5); v.y = Math.abs(v.y) * 0.3; }
    }
  }

  // dog
  const dog = W.dog;
  dog.tail.rotation.y = Math.sin(time * 14) * 0.6;
  if (dog.state === 'fetch') {
    const g = dog.group.position;
    const dx = ball.pos.x - g.x;
    const dz = ball.pos.z - g.z;
    const d = Math.hypot(dx, dz);
    dog.group.rotation.y = Math.atan2(-dz, dx) ;
    if (d > 0.35) {
      g.x += (dx / d) * 7 * dt;
      g.z += (dz / d) * 7 * dt;
    } else {
      dog.state = 'carry';
      ball.frozen = true;
    }
    legSwing(dog.legs, time * 28, 0.7, 0.9);
  } else if (dog.state === 'carry') {
    const g = dog.group.position;
    dog.group.rotation.y = Math.PI / 2;
    g.z -= 5 * dt;
    g.x += (4.8 - g.x) * dt * 2;
    ball.pos.set(g.x, 0.6, g.z - 0.5);
    ball.vel.set(0, 0, 0);
    legSwing(dog.legs, time * 28, 0.7, 0.9);
    if (g.z < -14) dog.state = 'gone';
  } else {
    legSwing(dog.legs, 0, 0, 0);
    dog.head.rotation.z = Math.sin(time * 2) * 0.08;
  }
  if (dog.model) dog.model.update(dt, dog.state === 'fetch' || dog.state === 'carry' ? 'run' : 'idle');

  // cow slowly wanders across the street
  const cow = W.cow;
  cow.dir = cow.dir ?? 1;
  const cp = cow.group.position;
  cp.x += cow.dir * 0.28 * dt;
  if (cp.x > 3.6) cow.dir = -1;
  if (cp.x < -3.6) cow.dir = 1;
  turnTo(cow.group, cow.dir > 0 ? 0 : Math.PI, 0.05);
  cow.tail.rotation.z = Math.sin(time * 3) * 0.4;
  legSwing(cow.legs, cp.x * 5, 0.32, 0.5);
  cow.head.rotation.z = Math.sin(time * 1.5) * 0.12;
  if (cow.model) {
    cow.model.update(dt, 'walk');
    // static model: a gentle plodding bob and sway while it walks
    cow.model.holder.position.y = Math.abs(Math.sin(cp.x * 4.5)) * 0.025;
    cow.model.holder.rotation.z = Math.sin(cp.x * 4.5) * 0.015;
  }
  if (cow.startle > 0) {
    cow.startle -= realDt;
    cow.group.position.y = Math.abs(Math.sin(time * 18)) * 0.12;
  } else cow.group.position.y = 0;

  // floating emoji
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.life -= realDt;
    f.s.position.y += realDt * 0.9;
    f.s.material.opacity = clamp(f.life, 0, 1);
    if (f.life <= 0) {
      scene.remove(f.s);
      f.s.material.map.dispose();
      f.s.material.dispose();
      floaters.splice(i, 1);
    }
  }

  fireworks(realDt);
  updateParticles(dt);
  updatePuffs(dt);

  // camera
  S.shake = Math.max(0, S.shake - realDt * 1.6);
  _tgt.copy(lookBase);
  if (S.mode === 'bowling' || S.mode === 'runup') _tgt.lerp(ball.pos, 0.18);
  else if ((S.mode === 'live' || S.mode === 'result') && ball.hit) _tgt.lerp(ball.pos, 0.6);
  const narrow = camera.aspect < 0.75; // portrait phone: recentre so the batter isn't clipped
  if (narrow) _tgt.x -= 0.6;
  camLook.lerp(_tgt, 1 - Math.exp(-3.5 * realDt));
  camera.position.copy(camBase);
  if (narrow) camera.position.x = -0.2;
  if (S.shake > 0) {
    const a = S.shake * 0.25;
    camera.position.x += (Math.random() - 0.5) * a;
    camera.position.y += (Math.random() - 0.5) * a;
  }
  camera.lookAt(camLook);
}

// ------------------------------------------------------------------ fireworks
let fwTimer = 1.5;
const fwColors = [[0xff3d8b, 0xffc2dd], [0xffc233, 0xfff1b0], [0x2de2c8, 0xb8fff3], [0x9b7bff, 0xd9ccff], [0xff7a1a, 0xffd0a0]];
function fireworks(realDt) {
  fwTimer -= realDt;
  if (fwTimer > 0) return;
  fwTimer = rand(1.4, 3.2);
  const cols = pick(fwColors);
  burst(new THREE.Vector3(rand(-16, 16), rand(15, 24), rand(-52, -34)), cols, 46, 12, { up: 2, size: 0.7, life: 1.7, grav: 0.25 });
}

// ------------------------------------------------------------------ loop
let last = performance.now();
let acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (document.hidden) { last = now; return; } // nothing to draw in a background tab
  const real = Math.min(0.05, (now - last) / 1000);
  last = now;
  let ts = 1;
  if (S.slowT > 0) {
    ts = S.slowScale;
    S.slowT -= real;
  }
  acc += real * ts;
  while (acc >= FIXED) {
    step(FIXED);
    acc -= FIXED;
  }
  animate(real * ts, real);
  renderer.render(scene, camera);
}

// ------------------------------------------------------------------ real human models (optional)
// Drop rigged humanoid GLBs into public/models/people/ (man.glb, woman.glb). If they are missing the
// procedural characters stay.
loadTemplates({ batter: import.meta.env.BASE_URL + 'models/Batsman/batter.glb', bowler: import.meta.env.BASE_URL + 'models/bowler/bowler.glb', male: import.meta.env.BASE_URL + 'models/people/man.glb', female: import.meta.env.BASE_URL + 'models/people/woman.glb', dog: import.meta.env.BASE_URL + 'models/animals/dog.glb', cow: import.meta.env.BASE_URL + 'models/animals/cow.glb', pole: import.meta.env.BASE_URL + 'models/props/pole.glb', bhel: import.meta.env.BASE_URL + 'models/props/bhelpuri.glb', ...Object.fromEntries(['auto'].map((k) => ['veh_' + k, import.meta.env.BASE_URL + `models/vehicles/${k}.glb`])) }, (p) => {
  $('loadFill').style.width = Math.round(p * 100) + '%';
  $('loadTxt').textContent = `LOADING THE GULLY… ${Math.round(p * 100)}%`;
}).then((t) => {
  TPL = t;
  for (const p of W.people) {
    // the two heroes use their own custom models: orange kurta for the batsman, white T-shirt for the bowler
    const hero = p === W.batter ? t.batter : p === W.bowler ? t.bowler : null;
    if (hero) {
      dressRig(p, hero, { shirt: p === W.batter ? 0xff7a1a : 0xffffff, tshirt: p === W.bowler, hideHat: true, height: 1 });
      continue;
    }
    const tpl = p.female ? t.female || t.male : t.male || t.female;
    if (!tpl) continue;
    const isMale = tpl === t.male;
    dressRig(p, tpl, {
      shirt: isMale ? p.opts.shirt : undefined,
      pants: isMale ? p.opts.pants : undefined,
      shoe: isMale ? p.opts.shoe : undefined,
      skin: isMale ? pick(skinTints) : undefined,
      hideBeard: isMale && (p.kid || Math.random() < 0.5),
      kid: !!p.kid && isMale,
      headScale: rand(1.14, 1.22),
      height: p.kid ? rand(0.96, 1.05) : rand(0.97, 1.04),
    });
  }
  for (const k of ['auto']) if (t['veh_' + k]) VEH_TPL[k] = t['veh_' + k];
  if (t.bhel) {
    // Kailash Bhelpuri cart on the right footpath, front facing the lane
    const m = t.bhel;
    m.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(m);
    const c = bb.getCenter(new THREE.Vector3());
    const holder = new THREE.Group();
    holder.add(m);
    m.position.set(-c.x, -bb.min.y, -c.z);
    m.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    holder.scale.setScalar(2.7 / (bb.max.y - bb.min.y));
    holder.rotation.y = -Math.PI / 2;
    holder.position.set(BHEL.x, 0.16, BHEL.z);
    scene.add(holder);
    if (t.bhel.animations && t.bhel.animations.length) {
      bhelMixer = new THREE.AnimationMixer(m);
      t.bhel.animations.forEach((a) => bhelMixer.clipAction(a).play());
    }
    bhelOn = true;
  }
  if (t.pole) {
    // real electricity poles: each module is two poles with wires between them, rotated to run down the street
    W.procPoles.visible = false;
    const zs = W.poleZs;
    const SC = 1.8;
    for (let i = 0; i < zs.length - 1; i++) {
      const mod = t.pole.clone(true);
      mod.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        o.userData.shared = true;
        // modules after the first start at the previous module's end pole: hide the duplicate first pole
        if (i > 0) {
          const bb = new THREE.Box3().setFromObject(o);
          if (bb.getCenter(new THREE.Vector3()).x > -4.5 && bb.getSize(new THREE.Vector3()).x < 1) o.visible = false;
        }
      });
      const holder = new THREE.Group();
      holder.add(mod);
      holder.scale.setScalar(SC);
      holder.rotation.y = -Math.PI / 2;
      holder.position.set(W.poleX, 0.16, zs[i]);
      scene.add(holder);
    }
  }
  if (t.cow) {
    const a = makeAnimal(t.cow, { length: 1.8, yaw: Math.PI / 2 });
    if (a) {
      W.cow.group.children.slice().forEach((c) => (c.visible = false));
      W.cow.group.add(a.holder);
      W.cow.model = a;
    }
  }
  if (t.dog) {
    const a = makeAnimal(t.dog, { length: 0.95, yaw: Math.PI / 2 });
    if (a) {
      W.dog.group.children.slice().forEach((c) => (c.visible = false));
      W.dog.group.add(a.holder);
      W.dog.model = a;
    }
  }
}).finally(() => {
  $('loader').classList.add('done');
  $('play').disabled = false;
});

// ------------------------------------------------------------------ boot
rollMatch();
buildDots();
refreshHud();
$('muteBtn').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  unlockAudio();
  setMuted(!isMuted());
  $('muteBtn').textContent = isMuted() ? '🔇' : '🔊';
});
$('play').addEventListener('click', () => { unlockAudio(); startGame(); });
$('again').addEventListener('click', () => { unlockAudio(); startGame(); });
// ------------------------------------------------------------------ share card
const rrect = (c, x, y, w, h, r) => {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
};
async function makeShareCard() {
  try { await document.fonts.load("60px 'Bungee'"); await document.fonts.load("700 30px 'Baloo 2'"); } catch { /* fonts optional */ }
  renderer.render(scene, camera); // same tick, so the canvas still holds the frame
  const img = new Image();
  img.src = canvas.toDataURL('image/jpeg', 0.92);
  await img.decode().catch(() => {});
  const CW = 1080, CH = 1350;
  const cv = document.createElement('canvas');
  cv.width = CW; cv.height = CH;
  const c = cv.getContext('2d');
  const g = c.createLinearGradient(0, 0, 0, CH);
  g.addColorStop(0, '#2a0f6b'); g.addColorStop(0.55, '#140a33'); g.addColorStop(1, '#4a0f3a');
  c.fillStyle = g; c.fillRect(0, 0, CW, CH);
  c.textAlign = 'center';
  c.font = "64px 'Bungee', Impact, sans-serif";
  c.fillStyle = '#ffc233'; c.shadowColor = '#ff3d8b'; c.shadowBlur = 24;
  c.fillText('GULLY CRICKET', CW / 2, 96);
  c.fillStyle = '#ff3d8b'; c.fillText('CHAOS', CW / 2, 164);
  c.shadowBlur = 0;
  // the game frame, cropped to fill a rounded window
  const fx = 60, fy = 200, fw = CW - 120, fh = 640;
  c.save(); rrect(c, fx, fy, fw, fh, 36); c.clip();
  if (img.width) {
    const k = Math.max(fw / img.width, fh / img.height);
    c.drawImage(img, fx + (fw - img.width * k) / 2, fy + (fh - img.height * k) / 2, img.width * k, img.height * k);
  }
  c.restore();
  c.lineWidth = 8; c.strokeStyle = '#fff'; rrect(c, fx, fy, fw, fh, 36); c.stroke();
  c.fillStyle = '#fff';
  c.font = "190px 'Bungee', Impact, sans-serif";
  c.fillText(String(S.score), CW / 2, 1030);
  c.font = "46px 'Bungee', Impact, sans-serif";
  c.fillStyle = '#2de2c8';
  c.fillText(S.score === 1 ? 'RUN' : 'RUNS', CW / 2, 1090);
  c.fillStyle = '#ffc233';
  c.font = "700 44px 'Baloo 2', sans-serif";
  c.fillText($('overTitle').textContent, CW / 2, 1160);
  c.fillStyle = '#cbb8ff';
  c.font = "700 34px 'Baloo 2', sans-serif";
  c.fillText(`${$('overTag').textContent}  •  Target ${S.target} in ${MAX_BALLS} balls, ${MAX_WKTS} wickets`, CW / 2, 1212);
  c.fillStyle = '#fff';
  c.font = "700 36px 'Baloo 2', sans-serif";
  c.fillText('Can you beat me? 🏏  ' + location.host + location.pathname.replace(/\/$/, ''), CW / 2, 1290);
  return new Promise((res) => cv.toBlob(res, 'image/png'));
}
$('share').addEventListener('click', async () => {
  const text = `I scored ${S.score} runs in Gully Cricket Chaos! 🏏 Can you beat me? ${location.href}`;
  const btn = $('share');
  btn.textContent = '…';
  try {
    const blob = await makeShareCard();
    const file = blob && new File([blob], 'gully-cricket-chaos.png', { type: 'image/png' });
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], text });
    } else if (blob) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'gully-cricket-chaos.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      try { await navigator.clipboard.writeText(text); } catch { /* clipboard optional */ }
      btn.textContent = 'SAVED!';
      setTimeout(() => (btn.textContent = 'SHARE'), 1600);
      return;
    }
  } catch { /* user cancelled */ }
  btn.textContent = 'SHARE';
});
requestAnimationFrame(frame);
window.__game = { S, ball, W, camera, spawnVehicle, traffic, renderer, makeShareCard }; // handy for debugging in the console
