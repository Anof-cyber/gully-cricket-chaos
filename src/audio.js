// Tiny synthesized sound effects (no asset files needed).
let ctx = null;
let master = null;
let noiseBuf = null;

export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
  if (!outBuf && !outLoading) {
    outLoading = true;
    fetch(import.meta.env.BASE_URL + 'music/batsman-out.mp3')
      .then((r) => r.arrayBuffer())
      .then((b) => ctx.decodeAudioData(b))
      .then((buf) => (outBuf = buf))
      .catch(() => {});
  }
  if (!wowBuf && !wowLoading) {
    wowLoading = true;
    fetch(import.meta.env.BASE_URL + 'music/wow.mp3')
      .then((r) => r.arrayBuffer())
      .then((b) => ctx.decodeAudioData(b))
      .then((buf) => (wowBuf = buf))
      .catch(() => {});
  }
  if (!bowlOutBuf && !bowlOutLoading) {
    bowlOutLoading = true;
    fetch(import.meta.env.BASE_URL + 'music/bowler-out.mp3')
      .then((r) => r.arrayBuffer())
      .then((b) => ctx.decodeAudioData(b))
      .then((buf) => (bowlOutBuf = buf))
      .catch(() => {});
  }
  if (!cutBuf && !cutLoading) {
    cutLoading = true;
    fetch(import.meta.env.BASE_URL + 'music/powercut.mp3')
      .then((r) => r.arrayBuffer())
      .then((b) => ctx.decodeAudioData(b))
      .then((buf) => (cutBuf = buf))
      .catch(() => {});
  }
  if (!passBuf && !passLoading) {
    passLoading = true;
    fetch(import.meta.env.BASE_URL + 'music/pass-by.mp3')
      .then((r) => r.arrayBuffer())
      .then((b) => ctx.decodeAudioData(b))
      .then((buf) => (passBuf = buf))
      .catch(() => {});
  }
}

// seconds the two "out" clips take to finish, so the next ball can wait for them
export const outSoundLen = () => (outBuf && bowlOutBuf && !muted ? 1.2 + bowlOutBuf.duration + 0.3 : 0);
let wowBuf = null;
let wowLoading = false;
let bowlOutBuf = null;
let bowlOutLoading = false;
let cutBuf = null;
let cutLoading = false;
let passBuf = null;
let passLoading = false;

let outBuf = null;
let outLoading = false;
function playBuf(buf, vol, delay = 0) {
  if (!ctx) return;
  const src = ctx.createBufferSource();
  const g = ctx.createGain();
  src.buffer = buf;
  g.gain.value = vol;
  src.connect(g).connect(master);
  src.start(ctx.currentTime + delay);
}

function tone({ type = 'sine', f0 = 440, f1 = f0, dur = 0.2, vol = 0.3, delay = 0, vib = 0 }) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  if (vib) {
    const l = ctx.createOscillator();
    const lg = ctx.createGain();
    l.frequency.value = 6;
    lg.gain.value = vib;
    l.connect(lg).connect(o.frequency);
    l.start(t);
    l.stop(t + dur);
  }
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise({ dur = 0.2, vol = 0.3, hp = 0, lp = 18000, delay = 0, swell = 0 }) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  const h = ctx.createBiquadFilter();
  h.type = 'highpass';
  h.frequency.value = hp;
  const l = ctx.createBiquadFilter();
  l.type = 'lowpass';
  l.frequency.value = lp;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + (swell || 0.005));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(h).connect(l).connect(g).connect(master);
  s.start(t);
  s.stop(t + dur + 0.05);
}

export const sfx = {
  bat(q = 1) {
    tone({ type: 'sine', f0: 190 + q * 120, f1: 60, dur: 0.12, vol: 0.7 });
    noise({ dur: 0.07, vol: 0.6 + q * 0.3, hp: 1200 });
  },
  edge() {
    noise({ dur: 0.05, vol: 0.5, hp: 2500 });
    tone({ type: 'square', f0: 900, f1: 500, dur: 0.05, vol: 0.12 });
  },
  swish() {
    noise({ dur: 0.18, vol: 0.18, hp: 800, lp: 5000, swell: 0.1 });
  },
  bounce() {
    tone({ type: 'sine', f0: 140, f1: 70, dur: 0.07, vol: 0.28 });
  },
  wall() {
    tone({ type: 'sine', f0: 110, f1: 55, dur: 0.1, vol: 0.4 });
    noise({ dur: 0.05, vol: 0.2, hp: 600, lp: 3000 });
  },
  stumps() {
    noise({ dur: 0.25, vol: 0.5, hp: 400, lp: 4000 });
    tone({ type: 'triangle', f0: 260, f1: 90, dur: 0.25, vol: 0.4 });
  },
  crash() {
    noise({ dur: 0.7, vol: 0.7, hp: 2500 });
    noise({ dur: 0.3, vol: 0.5, hp: 4000, delay: 0.12 });
    tone({ type: 'sine', f0: 90, f1: 40, dur: 0.3, vol: 0.5 });
  },
  horn() {
    tone({ type: 'square', f0: 420, f1: 420, dur: 0.2, vol: 0.18 });
    tone({ type: 'square', f0: 525, f1: 525, dur: 0.2, vol: 0.18 });
    tone({ type: 'square', f0: 420, f1: 420, dur: 0.25, vol: 0.18, delay: 0.26 });
    tone({ type: 'square', f0: 525, f1: 525, dur: 0.25, vol: 0.18, delay: 0.26 });
  },
  bark() {
    for (let i = 0; i < 2; i++) {
      tone({ type: 'sawtooth', f0: 520, f1: 240, dur: 0.14, vol: 0.28, delay: i * 0.2 });
      noise({ dur: 0.1, vol: 0.12, hp: 800, lp: 2500, delay: i * 0.2 });
    }
  },
  moo() {
    tone({ type: 'sawtooth', f0: 130, f1: 85, dur: 1.0, vol: 0.28, vib: 6 });
    tone({ type: 'square', f0: 65, f1: 45, dur: 1.0, vol: 0.12 });
  },
  splash() {
    noise({ dur: 0.35, vol: 0.4, hp: 1500, lp: 7000, swell: 0.04 });
    tone({ type: 'sine', f0: 700, f1: 200, dur: 0.15, vol: 0.2 });
  },
  catch() {
    tone({ type: 'sine', f0: 320, f1: 200, dur: 0.1, vol: 0.5 });
    noise({ dur: 0.05, vol: 0.2, hp: 1000 });
  },
  wow() {
    if (wowBuf) playBuf(wowBuf, 1);
  },
  cheer() {
    noise({ dur: 1.4, vol: 0.38, hp: 500, lp: 3200, swell: 0.35 });
    tone({ type: 'sawtooth', f0: 420, f1: 520, dur: 0.6, vol: 0.05, delay: 0.1 });
  },
  aww() {
    tone({ type: 'sawtooth', f0: 380, f1: 150, dur: 0.8, vol: 0.14, vib: 4 });
  },
  out() {
    if (outBuf) {
      playBuf(outBuf, 1); // batsman's reaction
      if (bowlOutBuf) playBuf(bowlOutBuf, 1, 1.2); // bowler's celebration
      return;
    }
    tone({ type: 'square', f0: 330, f1: 330, dur: 0.18, vol: 0.18 });
    tone({ type: 'square', f0: 277, f1: 277, dur: 0.18, vol: 0.18, delay: 0.2 });
    tone({ type: 'square', f0: 220, f1: 220, dur: 0.4, vol: 0.18, delay: 0.4 });
  },
  slurp() {
    noise({ dur: 0.55, vol: 0.12, hp: 900, lp: 3500, swell: 0.4 });
    tone({ type: 'sine', f0: 700, f1: 1100, dur: 0.5, vol: 0.03, vib: 18 });
  },
  power() {
    tone({ type: 'triangle', f0: 330, f1: 660, dur: 0.18, vol: 0.2 });
    tone({ type: 'triangle', f0: 440, f1: 880, dur: 0.18, vol: 0.2, delay: 0.13 });
    tone({ type: 'triangle', f0: 660, f1: 1320, dur: 0.4, vol: 0.22, delay: 0.26 });
  },
  tick() {
    tone({ type: 'square', f0: 900, f1: 900, dur: 0.04, vol: 0.08 });
  },
  boom() {
    if (cutBuf) playBuf(cutBuf, 1);
    noise({ dur: 1.2, vol: 0.9, hp: 60, lp: 1800, swell: 0.01 });
    tone({ type: 'sine', f0: 120, f1: 28, dur: 1.0, vol: 0.9 });
    noise({ dur: 0.6, vol: 0.5, hp: 3000, delay: 0.05 });
    for (let i = 0; i < 6; i++) noise({ dur: 0.08, vol: 0.35, hp: 2500, delay: 0.3 + i * 0.12 }); // crackle
    tone({ type: 'sawtooth', f0: 900, f1: 60, dur: 0.9, vol: 0.2, delay: 0.35 }); // power-down whine
  },
  angry() {
    tone({ type: 'sawtooth', f0: 90, f1: 140, dur: 0.5, vol: 0.2, vib: 14 });
  },
};

// ------------------------------------------------------------------ gully ambience
// A layered street soundscape: crowd murmur, distant traffic, insects, dhol practice, crows, dogs, horns,
// a temple bell, a pressure cooker, firecrackers.
let amb = null;
let muted = false;

function pan(p = 0) {
  if (!ctx || !ctx.createStereoPanner) return master;
  const sp = ctx.createStereoPanner();
  sp.pan.value = p;
  sp.connect(master);
  return sp;
}
function ambNoise(out, { lp = 1000, hp = 0, gain = 0.1, q = 0.7, type = 'lowpass', lfo = 0 }) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = lp;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.value = gain;
  if (lfo) {
    const l = ctx.createOscillator();
    const lg = ctx.createGain();
    l.frequency.value = lfo;
    lg.gain.value = gain * 0.5;
    l.connect(lg).connect(g.gain);
    l.start();
  }
  s.connect(f).connect(g).connect(out);
  s.start();
  return g;
}
function bell(t0, f0, vol, dest) {
  [1, 2.76, 5.4, 8.93].forEach((m, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = f0 * m;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol / (i + 1), t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.2 / (1 + i * 0.5));
    o.connect(g).connect(dest);
    o.start(t0);
    o.stop(t0 + 3.4);
  });
}
function oneShot(fn, lo, hi) {
  if (!amb) return;
  const id = setTimeout(() => {
    if (!amb) return;
    if (!muted && ctx && ctx.state === 'running') fn();
    oneShot(fn, lo, hi);
  }, (lo + Math.random() * (hi - lo)) * 1000);
  amb.timers.push(id);
}
const caw = () => {
  const out = pan(Math.random() * 2 - 1);
  const n = 2 + ((Math.random() * 3) | 0);
  for (let i = 0; i < n; i++) {
    const t = ctx.currentTime + i * 0.33;
    const o = ctx.createOscillator();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(780, t);
    o.frequency.exponentialRampToValueAtTime(520, t + 0.22);
    f.type = 'bandpass';
    f.frequency.value = 1300;
    f.Q.value = 2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    o.connect(f).connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.3);
  }
};
const farBark = () => {
  const out = pan(Math.random() * 2 - 1);
  const n = 2 + ((Math.random() * 4) | 0);
  for (let i = 0; i < n; i++) {
    const t = ctx.currentTime + i * (0.28 + Math.random() * 0.12);
    const o = ctx.createOscillator();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(430 + Math.random() * 90, t);
    o.frequency.exponentialRampToValueAtTime(220, t + 0.14);
    f.type = 'lowpass';
    f.frequency.value = 1400;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
    o.connect(f).connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.2);
  }
};
const farHorn = () => {
  const out = pan(Math.random() * 2 - 1);
  const f0 = pick([410, 460, 520, 340]);
  const n = Math.random() < 0.5 ? 1 : 2;
  for (let i = 0; i < n; i++) {
    const t = ctx.currentTime + i * 0.3;
    for (const m of [1, 1.26]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      o.frequency.value = f0 * m;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.03, t + 0.02);
      g.gain.setValueAtTime(0.03, t + 0.2);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.3);
    }
  }
};
const templeBell = () => {
  const out = pan(Math.random() * 1.2 - 0.6);
  const t = ctx.currentTime;
  for (let i = 0; i < 3 + ((Math.random() * 3) | 0); i++) bell(t + i * 0.9, 520, 0.03, out);
};
const cooker = () => {
  const out = pan(Math.random() * 2 - 1);
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(2300, t);
  o.frequency.linearRampToValueAtTime(2900, t + 0.5);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.025, t + 0.1);
  g.gain.setValueAtTime(0.025, t + 0.9);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + 1.5);
};
const crackers = () => {
  const out = pan(Math.random() * 2 - 1);
  const burst = 3 + ((Math.random() * 8) | 0);
  const t0 = ctx.currentTime;
  for (let i = 0; i < burst; i++) {
    const t = t0 + i * (0.05 + Math.random() * 0.12);
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 1500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    s.connect(f).connect(g).connect(out);
    s.start(t);
    s.stop(t + 0.1);
  }
  if (Math.random() < 0.4) {
    // a rocket: whoosh, then a boom
    const t = t0 + burst * 0.1 + 0.2;
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(600, t);
    f.frequency.exponentialRampToValueAtTime(3500, t + 0.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
    s.connect(f).connect(g).connect(out);
    s.start(t);
    s.stop(t + 1.1);
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.frequency.setValueAtTime(110, t + 1.0);
    o.frequency.exponentialRampToValueAtTime(35, t + 1.6);
    og.gain.setValueAtTime(0.0001, t + 1.0);
    og.gain.exponentialRampToValueAtTime(0.18, t + 1.02);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 1.7);
    o.connect(og).connect(out);
    o.start(t + 1.0);
    o.stop(t + 1.8);
  }
};
const dhol = () => {
  const out = pan(-0.4 + Math.random() * 0.8);
  const t0 = ctx.currentTime;
  const hit = (t, f, v, noisy) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.55, t + 0.18);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.25);
    if (noisy) {
      const s = ctx.createBufferSource();
      s.buffer = noiseBuf;
      const f2 = ctx.createBiquadFilter();
      f2.type = 'bandpass';
      f2.frequency.value = 2200;
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.0001, t);
      g2.gain.exponentialRampToValueAtTime(v * 0.5, t + 0.005);
      g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      s.connect(f2).connect(g2).connect(out);
      s.start(t);
      s.stop(t + 0.1);
    }
  };
  const beat = 0.27;
  // a simple dhol groove: DHA . dha-ge na . dha-ge DHA
  const pat = [[0, 95, 0.1, 0], [2, 190, 0.05, 1], [3, 190, 0.05, 1], [4, 95, 0.08, 0], [6, 190, 0.05, 1], [8, 95, 0.1, 0], [10, 190, 0.05, 1], [11, 190, 0.05, 1], [12, 95, 0.08, 0], [14, 190, 0.06, 1], [15, 190, 0.06, 1]];
  for (let bar = 0; bar < 6; bar++) for (const [s, f, v, n] of pat) hit(t0 + (bar * 16 + s) * beat * 0.5, f, v, !!n);
};
function pick(a) {
  return a[Math.floor(Math.random() * a.length)];
}

export function startAmbience() {
  if (!ctx || amb) return;
  const out = ctx.createGain();
  out.gain.value = 0;
  out.connect(master);
  out.gain.linearRampToValueAtTime(muted ? 0 : 0.9, ctx.currentTime + 3);
  amb = { out, timers: [] };
  ambNoise(out, { lp: 700, gain: 0.06, lfo: 0.13 }); // crowd murmur / far talk
  ambNoise(out, { lp: 160, gain: 0.08, lfo: 0.07 }); // distant traffic rumble
  ambNoise(out, { type: 'bandpass', lp: 5200, q: 8, gain: 0.012, lfo: 17 }); // insects
  oneShot(caw, 6, 16);
  oneShot(farBark, 9, 24);
  oneShot(farHorn, 5, 13);
  oneShot(templeBell, 25, 50);
  oneShot(cooker, 30, 70);
  oneShot(crackers, 3, 9);
  oneShot(dhol, 40, 90);
}
export function setMuted(m) {
  muted = m;
  if (amb) amb.out.gain.setTargetAtTime(m ? 0 : 0.9, ctx.currentTime, 0.2);
  if (master) master.gain.setTargetAtTime(m ? 0 : 0.55, ctx.currentTime, 0.1);
}
export const isMuted = () => muted;

// a vehicle engine whose loudness / pitch is driven every frame from the vehicle's position
export function makeEngine(kind) {
  if (!ctx) return null;
  if (passBuf) {
    // recorded pass-by clip, started once the vehicle is close enough to hear
    let src = null;
    return {
      set(vol) {
        if (src || vol < 0.012) return;
        src = ctx.createBufferSource();
        const g = ctx.createGain();
        src.buffer = passBuf;
        g.gain.value = muted ? 0 : 2.6;
        src.connect(g).connect(master);
        src.start();
      },
      stop() {}, // let the clip finish naturally
    };
  }
  const o = ctx.createOscillator();
  const o2 = ctx.createOscillator();
  const f = ctx.createBiquadFilter();
  const g = ctx.createGain();
  const lfo = ctx.createOscillator();
  const lg = ctx.createGain();
  const base = { auto: 62, scooter: 120, bike: 85, car: 70, cycle: 0 }[kind] ?? 80;
  o.type = kind === 'auto' ? 'square' : 'sawtooth';
  o2.type = 'sawtooth';
  o.frequency.value = base;
  o2.frequency.value = base * 2.01;
  f.type = 'lowpass';
  f.frequency.value = kind === 'scooter' ? 1400 : 900;
  lfo.frequency.value = kind === 'auto' ? 24 : kind === 'bike' ? 14 : 30; // putt-putt
  lg.gain.value = kind === 'cycle' ? 0 : 0.5;
  g.gain.value = 0;
  lfo.connect(lg).connect(g.gain);
  o.connect(f);
  o2.connect(f);
  f.connect(g).connect(master);
  if (kind !== 'cycle') {
    o.start();
    o2.start();
    lfo.start();
  }
  return {
    set(vol, pitch) {
      if (kind === 'cycle') return;
      g.gain.setTargetAtTime(muted ? 0 : vol, ctx.currentTime, 0.05);
      o.frequency.setTargetAtTime(base * pitch, ctx.currentTime, 0.05);
      o2.frequency.setTargetAtTime(base * 2.01 * pitch, ctx.currentTime, 0.05);
    },
    stop() {
      if (kind === 'cycle') return;
      g.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
      setTimeout(() => {
        try { o.stop(); o2.stop(); lfo.stop(); } catch { /* already stopped */ }
      }, 400);
    },
  };
}
