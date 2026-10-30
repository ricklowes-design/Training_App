import * as THREE from 'three';
import type { DefenderPose } from './stateMachine';
import { J } from './mocap';

// The 3D defender (task 2.2): a simply rigged figure built from primitives (no third-party
// asset, so no licence question), seen from the player's eye height. Only the state
// machine's pose parameters drive it. Nothing in the scene signals the correct exit:
// both gates look the same at all times, and the kit colours never change.

export { RENDERER_VERSION_LABEL as RENDERER_VERSION } from './version';

const THIGH = 0.46;
const SHIN = 0.46;
const UPPER_ARM = 0.3;
const FOREARM = 0.28;

export interface DefenderScene {
  render(pose: DefenderPose): void;
  resize(w: number, h: number): void;
  dispose(): void;
}

function limb(radius: number, material: THREE.Material): THREE.Mesh {
  const g = new THREE.CylinderGeometry(radius, radius * 0.85, 1, 10);
  g.translate(0, 0.5, 0); // pivot at one end
  return new THREE.Mesh(g, material);
}

const UP = new THREE.Vector3(0, 1, 0);
/** Stretches a unit limb from a to b. */
function place(m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) {
  const d = new THREE.Vector3().subVectors(b, a);
  m.position.copy(a);
  m.scale.set(1, d.length(), 1);
  m.quaternion.setFromUnitVectors(UP, d.normalize());
}

/** Two-bone IK: knee position for a hip and a foot, bending toward `forward`. */
function knee(hip: THREE.Vector3, foot: THREE.Vector3, forward: THREE.Vector3): THREE.Vector3 {
  const d = new THREE.Vector3().subVectors(foot, hip);
  const len = Math.min(d.length(), THIGH + SHIN - 1e-3);
  const dir = d.clone().normalize();
  const a = Math.acos(Math.min(1, (THIGH * THIGH + len * len - SHIN * SHIN) / (2 * THIGH * len)));
  const side = new THREE.Vector3().crossVectors(dir, forward).normalize();
  const bendAxis = side.lengthSq() > 1e-6 ? side : new THREE.Vector3(1, 0, 0);
  return hip.clone().add(dir.applyAxisAngle(bendAxis, -a).multiplyScalar(THIGH));
}

export function createDefenderScene(canvas: HTMLCanvasElement, onLost?: () => void): DefenderScene {
  // A lost WebGL context (the Chromebook reset the GPU) is reported, so the block can fall back with a reason (audit task 12).
  const lost = (e: Event) => {
    e.preventDefault();
    onLost?.();
  };
  canvas.addEventListener('webglcontextlost', lost);
  // preserveDrawingBuffer keeps the last frame for screenshots and replays paused mid-rep.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1b2430);
  scene.fog = new THREE.Fog(0x1b2430, 9, 18);
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.05, 40);
  // The player's eyes: about 1.3 m up, looking down the lane at the defender.
  camera.position.set(0, 1.3, 0);
  camera.lookAt(0, 0.85, -3);

  scene.add(new THREE.HemisphereLight(0xdfe8f2, 0x203018, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(2, 5, 2);
  scene.add(sun);

  // Pitch: a plain floor with faint lane lines and two identical gates.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 22), new THREE.MeshLambertMaterial({ color: 0x2f6b3a }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = -8;
  scene.add(floor);
  const lineMat = new THREE.MeshBasicMaterial({ color: 0x6fa57a });
  for (const x of [-1.6, 1.6]) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 20), lineMat);
    line.rotation.x = -Math.PI / 2;
    line.position.set(x, 0.002, -8);
    scene.add(line);
  }
  const coneMat = new THREE.MeshLambertMaterial({ color: 0xd9822b });
  for (const x of [-1.9, -1.1, 1.1, 1.9]) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.25, 12), coneMat);
    cone.position.set(x, 0.125, -2.4);
    scene.add(cone);
  }

  // The defender.
  const kit = new THREE.MeshLambertMaterial({ color: 0x3a4f7a });
  const shorts = new THREE.MeshLambertMaterial({ color: 0x1d2433 });
  const skin = new THREE.MeshLambertMaterial({ color: 0xc8a07e });
  const socks = new THREE.MeshLambertMaterial({ color: 0x2b3550 });
  const boots = new THREE.MeshLambertMaterial({ color: 0x111111 });
  const root = new THREE.Group();
  scene.add(root);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.45, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.003;
  root.add(shadow);
  const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.2), shorts);
  root.add(pelvis);
  const torso = new THREE.Group();
  root.add(torso);
  const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.32, 6, 12), kit);
  chest.position.y = 0.3;
  chest.scale.set(1.15, 1, 0.75);
  torso.add(chest);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), skin);
  head.position.y = 0.68;
  torso.add(head);
  const parts = {
    thighL: limb(0.075, shorts),
    thighR: limb(0.075, shorts),
    shinL: limb(0.055, socks),
    shinR: limb(0.055, socks),
    armL: limb(0.05, kit),
    armR: limb(0.05, kit),
    foreL: limb(0.042, skin),
    foreR: limb(0.042, skin),
  };
  for (const m of Object.values(parts)) root.add(m);
  const footL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.24), boots);
  const footR = footL.clone();
  root.add(footL, footR);

  const fwd = new THREE.Vector3(0, 0, 1); // the defender faces the player (+z in its own frame)

  // The recorded-motion figure: the same kit, posed directly from 19 joint positions (mocap.ts).
  const body = new THREE.Group();
  body.visible = false;
  scene.add(body);
  const seg = (r: number, m: THREE.Material, r2 = r * 0.85) => {
    const g = new THREE.CylinderGeometry(r, r2, 1, 12);
    g.translate(0, 0.5, 0);
    const mesh = new THREE.Mesh(g, m);
    body.add(mesh);
    return mesh;
  };
  const joint = (r: number, m: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), m);
    body.add(mesh);
    return mesh;
  };
  const mc = {
    thighL: seg(0.085, shorts), thighR: seg(0.085, shorts), shinL: seg(0.058, socks, 0.045), shinR: seg(0.058, socks, 0.045),
    footL: seg(0.055, boots, 0.045), footR: seg(0.055, boots, 0.045),
    armL: seg(0.052, kit, 0.045), armR: seg(0.052, kit, 0.045), foreL: seg(0.043, skin, 0.035), foreR: seg(0.043, skin, 0.035),
    kneeL: joint(0.06, socks), kneeR: joint(0.06, socks), elbowL: joint(0.045, kit), elbowR: joint(0.045, kit), handL: joint(0.045, skin), handR: joint(0.045, skin),
    neck: seg(0.05, skin),
  };
  const mChest = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.3, 6, 14), kit);
  const mPelvis = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.12, 4, 12), shorts);
  const mHead = new THREE.Group();
  body.add(mChest, mPelvis, mHead);
  mHead.add(new THREE.Mesh(new THREE.SphereGeometry(0.105, 18, 14), skin));
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.112, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), new THREE.MeshLambertMaterial({ color: 0x2a2018 }));
  hair.rotation.x = -0.5;
  mHead.add(hair);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
  for (const x of [-0.035, 0.035]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), eyeMat);
    e.position.set(x, 0.015, 0.095);
    mHead.add(e);
  }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), skin);
  nose.position.set(0, -0.01, 0.105);
  mHead.add(nose);
  const mShadow = shadow.clone();
  body.add(mShadow);
  const V = (f: Float32Array, j: number) => new THREE.Vector3(f[j * 3], f[j * 3 + 1], f[j * 3 + 2]);
  const basis = (m: THREE.Object3D, up: THREE.Vector3, across: THREE.Vector3) => {
    const y = up.clone().normalize();
    const z = new THREE.Vector3().crossVectors(across, y).normalize();
    const x = new THREE.Vector3().crossVectors(y, z);
    m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  };
  function renderJoints(p: DefenderPose, f: Float32Array) {
    body.position.set(p.x, 0, -p.z);
    body.rotation.y = p.yaw;
    const [sL, sR, hL, hR] = [V(f, J.leftShoulder), V(f, J.rightShoulder), V(f, J.leftHip), V(f, J.rightHip)];
    for (const [k, hip, other, kn, an, he, to] of [
      ['L', hL, hR, J.leftKnee, J.leftAnkle, J.leftHeel, J.leftToe],
      ['R', hR, hL, J.rightKnee, J.rightAnkle, J.rightHeel, J.rightToe],
    ] as const) {
      const knee = V(f, kn);
      const ankle = V(f, an);
      place(mc[`thigh${k}`], hip.clone().lerp(other, 0.05), knee);
      place(mc[`shin${k}`], knee, ankle);
      mc[`knee${k}`].position.copy(knee);
      // Boot along the heel-to-toe direction, flat on the floor when planted.
      const dir = V(f, to).sub(V(f, he));
      dir.y = 0;
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
      dir.normalize();
      const f0 = ankle.clone().add(dir.clone().multiplyScalar(-0.06));
      f0.y = Math.max(0.03, Math.min(f0.y, V(f, he).y + 0.03));
      const f1 = f0.clone().add(dir.multiplyScalar(0.26));
      f1.y = Math.max(0.03, V(f, to).y);
      place(mc[`foot${k}`], f0, f1);
    }
    for (const [k, sh, el, wr] of [
      ['L', sL, J.leftElbow, J.leftWrist],
      ['R', sR, J.rightElbow, J.rightWrist],
    ] as const) {
      const elbow = V(f, el);
      const wrist = V(f, wr);
      place(mc[`arm${k}`], sh, elbow);
      place(mc[`fore${k}`], elbow, wrist);
      mc[`elbow${k}`].position.copy(elbow);
      mc[`hand${k}`].position.copy(wrist);
    }
    const hipMid = hL.clone().add(hR).multiplyScalar(0.5);
    const shMid = sL.clone().add(sR).multiplyScalar(0.5);
    const spine = shMid.clone().sub(hipMid);
    basis(mChest, spine, sL.clone().sub(sR));
    mChest.position.copy(hipMid.clone().lerp(shMid, 0.55));
    mChest.scale.set(1.25, 1, 0.7);
    basis(mPelvis, spine, hL.clone().sub(hR));
    mPelvis.rotateZ(Math.PI / 2);
    mPelvis.position.copy(hipMid).add(new THREE.Vector3(0, 0.03, 0));
    mPelvis.scale.set(1.35, 1, 0.8);
    const ears = V(f, J.leftEar).add(V(f, J.rightEar)).multiplyScalar(0.5);
    const up = spine.clone().normalize();
    const head = ears.clone().add(up.clone().multiplyScalar(0.02));
    mHead.position.copy(head);
    const face = V(f, J.nose).sub(ears);
    face.y *= 0.3;
    const zf = face.sub(up.clone().multiplyScalar(face.dot(up))).normalize();
    const xf = new THREE.Vector3().crossVectors(up, zf);
    mHead.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xf, up, zf));
    place(mc.neck, shMid.clone().add(up.clone().multiplyScalar(-0.02)), head);
    mShadow.position.set(hipMid.x, 0.003, hipMid.z);
    renderer.render(scene, camera);
  }

  function render(p: DefenderPose) {
    body.visible = !!p.joints;
    root.visible = !p.joints;
    if (p.joints) return renderJoints(p, p.joints);
    root.position.set(p.x, 0, -p.z);
    root.rotation.y = p.yaw;
    const hipY = 0.92 - 0.32 * p.crouch;
    const half = p.stanceWidth / 2;
    const step = (s: number) => 0.18 * p.stepAmp * Math.sin(p.stepPhase + s);
    const lift = (s: number) => 0.08 * p.stepAmp * Math.max(0, Math.sin(p.stepPhase + s));
    // Feet in the defender's frame; x is mirrored because it faces the player.
    const fL = new THREE.Vector3(half, 0.03 + lift(0), step(0));
    const fR = new THREE.Vector3(-half, 0.03 + lift(Math.PI), step(Math.PI));
    footL.position.copy(fL);
    footR.position.copy(fR);
    const shift = p.hipShift + p.weightSide * 0.06; // hips over the weighted leg
    pelvis.position.set(shift, hipY, -0.04 * p.crouch);
    const hipL = new THREE.Vector3(shift + 0.1, hipY - 0.05, 0);
    const hipR = new THREE.Vector3(shift - 0.1, hipY - 0.05, 0);
    const kL = knee(hipL, fL, fwd);
    const kR = knee(hipR, fR, fwd);
    place(parts.thighL, hipL, kL);
    place(parts.shinL, kL, fL);
    place(parts.thighR, hipR, kR);
    place(parts.shinR, kR, fR);
    torso.position.set(shift, hipY + 0.05, 0);
    torso.rotation.set(0.45 * p.crouch, 0, -p.lean); // + lean = toward the player's right (−z rotation seen from the camera)
    // Arms out for balance; spread grows in the stance.
    torso.updateMatrixWorld(true);
    root.updateMatrixWorld(true);
    for (const [arm, fore, s] of [
      [parts.armL, parts.foreL, 1],
      [parts.armR, parts.foreR, -1],
    ] as const) {
      const shoulderLocal = new THREE.Vector3(s * 0.22, 0.5, 0);
      const shoulder = torso.localToWorld(shoulderLocal.clone());
      const rootInv = root.matrixWorld.clone().invert();
      const sh = shoulder.applyMatrix4(rootInv);
      const spread = 0.25 + 0.55 * p.armSpread;
      const elbow = sh.clone().add(new THREE.Vector3(s * Math.sin(spread) * UPPER_ARM, -Math.cos(spread) * UPPER_ARM, 0.05));
      const hand = elbow.clone().add(new THREE.Vector3(s * 0.08, -FOREARM * 0.9, 0.12));
      place(arm, sh, elbow);
      place(fore, elbow, hand);
    }
    shadow.position.x = shift;
    renderer.render(scene, camera);
  }

  return {
    render,
    resize(w, h) {
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    },
    dispose() {
      canvas.removeEventListener('webglcontextlost', lost);
      renderer.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
        }
      });
      // Release the context now rather than when the garbage collector gets to it.
      renderer.forceContextLoss();
    },
  };
}
