import * as THREE from 'three';
import { createTransformation, thrusterNozzles } from './vehicle-model.mjs?v=roadster-5';
import { createThrusterPlumes } from './thrusters.mjs?v=roadster-1';

// The garage's showroom: a car on a turntable in a dark studio, drawn by the
// game's renderer in place of the world while the garage is open. Each car is
// a clone of the game's model (sharing its geometry and materials) with a pose
// of its own, so the garage can unfold the ATLAS's wings and boat hull, or
// fire the Roadster's thrusters, without touching the car you drive.
const FOV = 26, ELEVATION = .2; // camera: vertical degrees, radians above the horizon
const FORM_RATE = 1 / 1.4; // a form or thruster preview takes 1.4 s
const SPIN = .28, IDLE = 2.5; // rad/s of auto-turn, resuming this long after a drag

// Colours as written to the screen (the studio shaders aren't tone mapped).
const studio = {
  vertexShader: `varying vec3 vWorld; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
};
const backdropMaterial = new THREE.ShaderMaterial({
  ...studio, side: THREE.BackSide, depthWrite: false,
  fragmentShader: `varying vec3 vWorld;
    void main(){ float up = normalize(vWorld).y;
      vec3 horizon = vec3(.165,.215,.2), top = vec3(.055,.085,.078);
      gl_FragColor = vec4(mix(horizon, top, smoothstep(0., .55, up)), 1.); }`,
});
// The floor fades from a lit pool under the car into the backdrop's horizon.
const floorMaterial = new THREE.ShaderMaterial({
  ...studio, uniforms: { uPool: { value: 6 } },
  fragmentShader: `uniform float uPool; varying vec3 vWorld;
    void main(){ float d = length(vWorld.xz) / uPool;
      vec3 c = mix(vec3(.25,.3,.28), vec3(.165,.215,.2), smoothstep(.15, 1.6, d));
      gl_FragColor = vec4(c, 1.); }`,
});

export function createShowroom() {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(FOV, 1, .1, 400);
  const backdrop = new THREE.Mesh(new THREE.SphereGeometry(150, 32, 16), backdropMaterial); backdrop.renderOrder = -2;
  const floor = new THREE.Mesh(new THREE.CircleGeometry(140, 64).rotateX(-Math.PI / 2), floorMaterial); floor.renderOrder = -1;
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(14, 48).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: .5 }));
  shadow.receiveShadow = true; shadow.position.y = .002;
  const ring = new THREE.Mesh(new THREE.RingGeometry(1, 1.012, 128).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#e9c98a', transparent: true, opacity: .45, depthWrite: false }));
  ring.position.y = .004;
  const key = new THREE.DirectionalLight('#fff0d2', 2.6); key.position.set(-6, 11, 7); key.castShadow = true;
  Object.assign(key.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 40 });
  key.shadow.mapSize.setScalar(2048); key.shadow.bias = -.0002; key.shadow.normalBias = .02; key.shadow.radius = 4;
  const rim = new THREE.DirectionalLight('#a8cad6', 1.3); rim.position.set(5, 4, -9);
  scene.add(backdrop, floor, shadow, ring, new THREE.HemisphereLight('#e4efed', '#3b3a2e', 1.1), key, rim);
  const turntable = new THREE.Group(); scene.add(turntable);

  const stands = new Map();
  let stand = null, angle = .7, spin = 0, idle = IDLE, arrive = 0, time = 0;
  const target = new THREE.Vector3(), framing = { radius: 3, y: 1 }, box = new THREE.Box3(), size = new THREE.Vector3();
  // The model's extent in its own frame, as drawn now (bounding boxes, not vertices).
  function measure(model) {
    const turn = turntable.rotation.y; turntable.rotation.y = 0; model.position.y = 0;
    model.updateMatrixWorld(true); box.makeEmpty();
    model.traverseVisible(o => { if (o.isMesh && !o.name.startsWith('Plume_')) box.expandByObject(o); });
    turntable.rotation.y = turn;
    return { min: box.min.y, radius: box.getSize(size).length() / 2, y: box.getCenter(size).y - box.min.y };
  }
  function makeStand(asset) {
    const model = asset.model.clone(), dropped = [];
    // Leave the game's plumes and vehicle-only shadow marks with the game's model.
    model.traverse(o => { delete o.userData.vehicle; if (o.name.startsWith('Plume_')) dropped.push(o); });
    for (const o of dropped) o.removeFromParent();
    const body = model.getObjectByName('Body');
    body.position.y = 0; body.rotation.set(0, 0, 0);
    model.traverse(o => { if (/^Wheel_F/.test(o.name)) o.rotation.y = 0; });
    const atlas = asset.kind === 'atlas';
    const s = { kind: asset.kind, model, preview: null, lift: 0, bank: 0, power: { rear: 0, lift: 0 }, wing: model.getObjectByName('Rear_Wing'), propeller: model.getObjectByName('Propeller'), propellerAngle: 0, forms: {} };
    if (atlas) for (const [name, clip] of [['boat', 'Transform_To_Boat'], ['plane', 'Transform_To_Plane']]) s.forms[name] = { rig: createTransformation(model, asset.clips, clip), progress: 0 };
    if (s.wing) s.wing.rotation.x = 0;
    for (const form of Object.values(s.forms)) form.rig.update(0);
    s.plumes = atlas ? null : createThrusterPlumes(thrusterNozzles(model));
    s.plumes?.update({}, 1, 0);
    // Framing for each form, measured once: the camera eases between them.
    s.base = measure(model);
    for (const [name, form] of Object.entries(s.forms)) { form.rig.update(1); form.frame = measure(model); form.rig.update(0); }
    model.position.y = -s.base.min;
    return s;
  }
  function show(asset) {
    if (!stands.has(asset.kind)) stands.set(asset.kind, makeStand(asset));
    if (stand) turntable.remove(stand.model);
    stand = stands.get(asset.kind); turntable.add(stand.model);
    ring.material.color.set(asset.kind === 'roadster' ? '#ff3b2f' : '#e9c98a');
    arrive = 1;
    return stand;
  }
  // Toggle a feature preview (see PREVIEWS in vehicle-specs.mjs); null for none.
  function preview(key) { if (stand) stand.preview = stand.preview === key ? null : key; return stand?.preview ?? null; }
  function update(dt) {
    time += dt;
    idle += dt;
    if (idle > IDLE) spin += (SPIN - spin) * (1 - Math.exp(-dt * 1.5));
    else spin *= Math.exp(-dt * 3); // a drag's flick, slowing
    angle += spin * dt; turntable.rotation.y = angle;
    if (!stand) return;
    const s = stand, step = dt * FORM_RATE, toward = (value, goal) => value + Math.max(-step, Math.min(step, goal - value));
    let lift = 0;
    for (const [name, form] of Object.entries(s.forms)) {
      const goal = s.preview === name ? 1 : 0;
      // Only one form at a time: the other folds away first.
      const other = Object.entries(s.forms).some(([n, f]) => n !== name && f.progress > 0);
      if (goal === 0 || !other) form.progress = toward(form.progress, goal);
      form.rig.update(form.progress);
    }
    if (s.forms.plane) {
      const p = s.forms.plane.progress, eased = p * p * (3 - 2 * p);
      lift = eased * (1.6 + Math.sin(time * 1.3) * .12); s.bank = eased * Math.sin(time * .7) * .12;
      s.propellerAngle += dt * eased * 30; s.propeller.rotation.z = s.propellerAngle;
    }
    if (s.plumes) {
      const hover = s.preview === 'hover';
      s.power.rear = toward(s.power.rear, s.preview === 'boost' ? 1 : 0);
      s.lift += ((hover ? 1 : 0) - s.lift) * (1 - Math.exp(-dt * 2.4));
      lift = s.lift * (1.25 + Math.sin(time * 1.8) * .07);
      s.plumes.update({ rear: s.power.rear, lift: hover ? .55 + Math.sin(time * 9) * .05 : 0 }, dt, time);
      s.wing.rotation.x += ((s.preview === 'wing' ? .95 : 0) - s.wing.rotation.x) * (1 - Math.exp(-dt * 5));
    }
    arrive *= Math.exp(-dt * 7);
    s.model.position.y = -s.base.min + lift; s.model.rotation.z = s.bank;
    s.model.scale.setScalar(1 - arrive * .08);
    shadow.material.opacity = .5 / (1 + lift * .6);
    // The camera eases toward the frame of the form being shown.
    let goal = s.base;
    for (const form of Object.values(s.forms)) if (form.progress > 0) goal = { radius: s.base.radius + (form.frame.radius - s.base.radius) * form.progress, y: s.base.y + (form.frame.y - s.base.y) * form.progress };
    const ease = 1 - Math.exp(-dt * 4);
    framing.radius += (goal.radius - framing.radius) * ease; framing.y += (goal.y + lift - framing.y) * ease;
    ring.scale.setScalar(s.base.radius * .92);
    floorMaterial.uniforms.uPool.value = s.base.radius * 2.2;
  }
  // view: the screen's size, and area the part of it left for the car (in
  // CSS pixels: left, top, right, bottom). The car is centred and fitted there.
  function render(draw, dt, view, area) {
    update(dt);
    const { width, height } = view, areaWidth = area.right - area.left, areaHeight = area.bottom - area.top;
    camera.aspect = width / height;
    camera.setViewOffset(width, height, width / 2 - (area.left + area.right) / 2, height / 2 - (area.top + area.bottom) / 2, width, height);
    // Fit the car's bounding sphere in that area, both ways.
    const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2)), half = Math.atan(tan * Math.min(areaWidth, areaHeight) / height);
    const distance = framing.radius / Math.sin(half) * 1.2;
    target.set(0, framing.y * .85, 0);
    camera.position.set(0, target.y + Math.sin(ELEVATION) * distance, Math.cos(ELEVATION) * distance);
    camera.lookAt(target); camera.updateProjectionMatrix();
    draw(scene, camera);
  }
  return {
    show, preview, render,
    get kind() { return stand?.kind ?? null; },
    get previewing() { return stand?.preview ?? null; },
    // Dragging turns the car; a flick keeps it turning for a moment.
    drag(dx, dt) { idle = 0; const turn = dx * .009; angle += turn; spin = dt > 0 ? Math.max(-6, Math.min(6, turn / dt)) : spin; },
  };
}
