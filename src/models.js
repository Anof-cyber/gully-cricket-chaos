// Drives real rigged humanoid models (Mixamo / Ready Player Me style skeletons) from the game's
// invisible procedural "puppet" rig. All batting / bowling / fielding poses and IK keep working:
// each frame the puppet's joints are retargeted onto the model's bones (limbs via two-bone IK scaled to
// the model's own limb lengths, spine and head by orientation).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

const canon = (n) => n.toLowerCase().replace(/^mixamorig[:_]?/, '').replace(/_\d+$/, '').replace(/[^a-z0-9]/g, '');
const NEED = ['hips', 'spine', 'spine1', 'spine2', 'neck', 'head', 'leftarm', 'leftforearm', 'lefthand', 'rightarm', 'rightforearm', 'righthand', 'leftupleg', 'leftleg', 'leftfoot', 'rightupleg', 'rightleg', 'rightfoot'];

export async function loadTemplates(urls, onProgress) {
  const loader = new GLTFLoader();
  const out = {};
  const prog = {}; // bytes loaded per file, for one combined progress value
  const report = () => {
    if (!onProgress) return;
    const vals = Object.values(prog);
    const loaded = vals.reduce((a, v) => a + v.loaded, 0);
    const total = vals.reduce((a, v) => a + (v.total || v.loaded), 0);
    onProgress(total ? Math.min(1, loaded / total) : 0);
  };
  await Promise.all(
    Object.entries(urls).map(async ([key, url]) => {
      prog[key] = { loaded: 0, total: 0 };
      try {
        const gltf = await loader.loadAsync(url, (e) => {
          prog[key] = { loaded: e.loaded, total: e.total || 0 };
          report();
        });
        out[key] = gltf.scene;
      } catch {
        /* model missing: that role keeps the procedural character */
      }
      prog[key] = { loaded: prog[key].total || 1, total: prog[key].total || 1 };
      report();
    })
  );
  return out;
}

// Turns a long kurta / coat into a T-shirt: drops the triangles below the hips and beyond mid upper-arm.
function cutToTshirt(mesh, bones) {
  const hipsY = bones.hips.getWorldPosition(new THREE.Vector3()).y;
  const hipsX = bones.hips.getWorldPosition(new THREE.Vector3()).x;
  const sh = bones.leftarm.getWorldPosition(new THREE.Vector3());
  const el = bones.leftforearm.getWorldPosition(new THREE.Vector3());
  const lim = Math.abs((sh.x + el.x) / 2 - hipsX) * 0.95; // sleeve ends about mid upper-arm
  const hemY = hipsY + (bones.spine1.getWorldPosition(new THREE.Vector3()).y - hipsY) * 0.35; // T-shirt hem a little above the hips
  const g = mesh.geometry.clone();
  const pos = g.attributes.position;
  const idx = g.index.array;
  const keep = [];
  const v = new THREE.Vector3();
  const c = new THREE.Vector3();
  mesh.updateWorldMatrix(true, false);
  for (let i = 0; i < idx.length; i += 3) {
    c.set(0, 0, 0);
    for (let k = 0; k < 3; k++) c.add(v.fromBufferAttribute(pos, idx[i + k]).applyMatrix4(mesh.matrixWorld));
    c.multiplyScalar(1 / 3);
    if (c.y > hemY && Math.abs(c.x - hipsX) <= lim) keep.push(idx[i], idx[i + 1], idx[i + 2]);
  }
  if (keep.length < 30) return; // unexpected shape: leave the garment alone
  g.setIndex(keep);
  mesh.geometry = g;
  if (mesh.material) {
    mesh.material = mesh.material.clone();
    mesh.material.side = THREE.DoubleSide;
  }
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _root = new THREE.Vector3();
const _tgt = new THREE.Vector3();
const _elb = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _G = new THREE.Quaternion();
const _tq = new THREE.Quaternion();
const _hq = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _sh = new THREE.Vector3();
const _el = new THREE.Vector3();
const _hd = new THREE.Vector3();
const _wr = new THREE.Vector3();
const _an = new THREE.Vector3();
const _fb = new THREE.Vector3();
const ARM_FALLBACK = new THREE.Vector3(0, -0.3, -1);
const LOCAL_ANKLE = new THREE.Vector3(0, -0.44, 0);

function setWorldQuat(bone, Wd) {
  bone.parent.updateWorldMatrix(true, false);
  bone.parent.getWorldQuaternion(_pq);
  bone.quaternion.copy(_pq.invert().multiply(Wd));
  bone.updateMatrixWorld(false);
}

// A static model (e.g. a vehicle) fitted to a length along Z, standing on the ground, facing +Z.
export function cloneModel(template, { length = 2, yaw = 0 } = {}) {
  const scene = cloneSkinned(template);
  const holder = new THREE.Group();
  holder.add(scene);
  scene.rotation.y = yaw;
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const k = length / Math.max(size.z, 0.001);
  scene.scale.setScalar(k);
  scene.position.set(-((box.min.x + box.max.x) / 2) * k, -box.min.y * k, -((box.min.z + box.max.z) / 2) * k);
  scene.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      o.userData.shared = true; // geometry/materials belong to the template: never dispose them
    }
  });
  return holder;
}

// Animated animal (e.g. a fox as the street dog). Faces +X like the game's procedural dog.
export function makeAnimal(template, { length = 0.9, yaw = Math.PI / 2 } = {}) {
  if (!template) return null;
  const scene = cloneSkinned(template);
  const holder = new THREE.Group();
  holder.add(scene);
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const s = length / Math.max(size.x, size.z);
  scene.scale.setScalar(s);
  scene.position.y = -box.min.y * s;
  holder.rotation.y = yaw;
  scene.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;
    }
  });
  const mixer = new THREE.AnimationMixer(scene);
  const clips = {};
  for (const c of template.animations || []) clips[c.name.toLowerCase()] = c;
  const pick = (re) => Object.keys(clips).find((k) => re.test(k));
  const actions = {
    idle: clips[pick(/survey|idle/)] && mixer.clipAction(clips[pick(/survey|idle/)]),
    walk: clips[pick(/walk/)] && mixer.clipAction(clips[pick(/walk/)]),
    run: clips[pick(/run|gallop/)] && mixer.clipAction(clips[pick(/run|gallop/)]),
  };
  let cur = null;
  const model = {
    holder,
    update(dt, state) {
      const next = actions[state] || actions.idle || actions.walk;
      if (next && next !== cur) {
        next.reset().fadeIn(0.2).play();
        if (cur) cur.fadeOut(0.2);
        cur = next;
      }
      mixer.update(dt);
    },
  };
  return model;
}

// tint {shirt, pants, shoe, skin, hideBeard, hideHat, kid, height}; returns a model attached to the rig (or null)
export function dressRig(rig, template, tint = {}) {
  if (!template) return null;
  const scene = cloneSkinned(template);
  const holder = new THREE.Group();
  holder.add(scene);

  const bones = {};
  scene.traverse((o) => {
    if (o.isBone) bones[canon(o.name)] = o;
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;
      const n = (o.material && o.material.name) || '';
      const mat = o.material;
      if (/outfit_top/i.test(n) && tint.shirt !== undefined) {
        o.material = mat.clone();
        o.material.map = null;
        o.material.color.set(tint.shirt);
      } else if (/outfit_bottom/i.test(n) && tint.pants !== undefined) {
        o.material = mat.clone();
        o.material.map = null;
        o.material.color.set(tint.pants);
      } else if (/footwear|outfit_shoes/i.test(n) && tint.shoe !== undefined) {
        o.material = mat.clone();
        o.material.map = null;
        o.material.color.set(tint.shoe);
      } else if (/skin|body/i.test(n) && tint.skin !== undefined) {
        o.material = mat.clone();
        o.material.color.set(tint.skin);
      } else if (/beard/i.test(n) && tint.hideBeard) {
        o.visible = false;
      } else if (/headwear/i.test(n) && tint.hideHat !== false) {
        o.visible = false;
      }
    }
  });
  for (const k of NEED) if (!bones[k]) return null; // not a standard humanoid skeleton

  if (tint.kid) bones.head.scale.multiplyScalar(tint.headScale ?? 1.16); // child-like head proportions

  // bind-pose data (holder is at identity here)
  holder.updateMatrixWorld(true);
  if (tint.tshirt) {
    scene.traverse((o) => {
      if (o.isMesh && o.geometry && o.geometry.index && /outfit_top/i.test((o.material && o.material.name) || '')) cutToTshirt(o, bones);
    });
  }
  const rest = {};
  for (const k of NEED) {
    rest[k] = { q: bones[k].getWorldQuaternion(new THREE.Quaternion()), p: bones[k].getWorldPosition(new THREE.Vector3()) };
  }
  const len = (u, l) => rest[u].p.distanceTo(rest[l].p);
  const limbs = {
    L: { arm: ['leftarm', 'leftforearm', 'lefthand'], leg: ['leftupleg', 'leftleg', 'leftfoot'] },
    R: { arm: ['rightarm', 'rightforearm', 'righthand'], leg: ['rightupleg', 'rightleg', 'rightfoot'] },
  };
  const info = (names) => {
    const [u, l, e] = names;
    return {
      u, l, e,
      l1: len(u, l), l2: len(l, e),
      d1: rest[l].p.clone().sub(rest[u].p).normalize(),
      d2: rest[e].p.clone().sub(rest[l].p).normalize(),
    };
  };
  const arms = { L: info(limbs.L.arm), R: info(limbs.R.arm) };
  const legs = { L: info(limbs.L.leg), R: info(limbs.R.leg) };
  const H0 = rest.hips.p.clone();
  const rigScale = rig.scale ?? 1;
  const s = ((0.93 * rigScale) / H0.y) * (tint.height ?? 1);
  holder.scale.setScalar(s);
  rig.group.add(holder);
  rig.root.visible = false; // hide the procedural puppet, keep it as the animation driver

  const model = { holder, bones };

  const solve = (L, rootRig, midRig, endRig, ref, k, explicit) => {
    // two-bone IK scaled to this model's limb lengths
    const l1 = L.l1 * s;
    const l2 = L.l2 * s;
    bones[L.u].getWorldPosition(_root);
    const rigLen = ref;
    const kk = (l1 + l2) / rigLen;
    if (explicit) _dir.copy(explicit).sub(_root);
    else _dir.copy(endRig).sub(rootRig).multiplyScalar(kk);
    let d = _dir.length();
    d = Math.min(Math.max(d, 0.05), (l1 + l2) * 0.999);
    _dir.normalize();
    _tgt.copy(_root).addScaledVector(_dir, d);
    _pole.copy(midRig).sub(rootRig);
    _pole.addScaledVector(_dir, -_pole.dot(_dir));
    if (_pole.lengthSq() < 1e-6) _pole.copy(k);
    _pole.normalize();
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    _elb.copy(_root).addScaledVector(_dir, a).addScaledVector(_pole, h);
    // upper bone
    _a.copy(_elb).sub(_root).normalize();
    _b.copy(L.d1).applyQuaternion(_G);
    _q1.setFromUnitVectors(_b, _a);
    _q2.copy(_G).multiply(rest[L.u].q);
    setWorldQuat(bones[L.u], _q1.multiply(_q2));
    // lower bone
    _a.copy(_tgt).sub(_elb).normalize();
    _b.copy(L.d2).applyQuaternion(_G);
    _q1.setFromUnitVectors(_b, _a);
    _q2.copy(_G).multiply(rest[L.l].q);
    setWorldQuat(bones[L.l], _q1.multiply(_q2));
  };


  model.sync = () => {
    const R = rig;
    R.group.updateMatrixWorld(true);
    R.group.getWorldQuaternion(_G);
    // hips follow the puppet's pelvis
    R.torso.getWorldPosition(_a);
    holder.parent.worldToLocal(_a);
    holder.position.copy(_a).addScaledVector(H0, -s);

    R.torso.getWorldQuaternion(_tq);
    R.head.getWorldQuaternion(_hq);
    setWorldQuat(bones.hips, _q1.copy(_G).multiply(rest.hips.q));
    setWorldQuat(bones.spine, _q1.copy(_G).slerp(_tq, 0.25).multiply(rest.spine.q));
    setWorldQuat(bones.spine1, _q1.copy(_G).slerp(_tq, 0.55).multiply(rest.spine1.q));
    setWorldQuat(bones.spine2, _q1.copy(_tq).multiply(rest.spine2.q));
    setWorldQuat(bones.neck, _q1.copy(_tq).slerp(_hq, 0.4).multiply(rest.neck.q));
    setWorldQuat(bones.head, _q1.copy(_hq).multiply(rest.head.q));

    const sc = rigScale;
    // arms: puppet shoulder -> elbow -> wrist
    for (const side of ['L', 'R']) {
      const sh = side === 'L' ? R.armL : R.armR;
      const el = side === 'L' ? R.elbowL : R.elbowR;
      const hand = side === 'L' ? R.handL : R.handR;
      sh.getWorldPosition(_sh);
      el.getWorldPosition(_el);
      hand.getWorldPosition(_hd);
      _wr.copy(_el).lerp(_hd, 0.26 / 0.33);
      // explicit grip targets (bat handle, catching hands) win over the scaled puppet pose
      const ht = R.handTarget && R.handTarget[side];
      solve(arms[side], _sh, _el, _wr, (0.29 + 0.26) * sc, ARM_FALLBACK, ht || null);
      if (ht) R.handTarget[side] = null;
    }
    // legs: puppet hip -> knee -> ankle
    _fb.set(0, 0, 1).applyQuaternion(_G);
    for (const side of ['L', 'R']) {
      const hip = side === 'L' ? R.legL : R.legR;
      const knee = side === 'L' ? R.kneeL : R.kneeR;
      hip.getWorldPosition(_sh);
      knee.getWorldPosition(_el);
      knee.updateWorldMatrix(true, false);
      _an.copy(LOCAL_ANKLE).applyMatrix4(knee.matrixWorld);
      solve(legs[side], _sh, _el, _an, 0.88 * sc, _fb, null);
      // foot follows the shin
      knee.getWorldQuaternion(_q1);
      setWorldQuat(bones[side === 'L' ? 'leftfoot' : 'rightfoot'], _q1.multiply(rest[side === 'L' ? 'leftfoot' : 'rightfoot'].q));
    }
    holder.updateMatrixWorld(true);
  };

  // centre of the palm in world space
  model.handPos = (side, out) => {
    const hand = bones[side === 'L' ? 'lefthand' : 'righthand'];
    const fore = bones[side === 'L' ? 'leftforearm' : 'rightforearm'];
    hand.getWorldPosition(out);
    fore.getWorldPosition(_c);
    _c.sub(out).negate().normalize();
    return out.addScaledVector(_c, 0.07);
  };
  rig.model = model;
  model.sync();
  return model;
}
