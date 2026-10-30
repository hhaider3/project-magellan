import * as THREE from 'three';

// Blossom falling from the cherry trees near the camera: one draw call, all
// motion in the vertex shader (no per-frame buffer updates). Each petal
// belongs to one of TREES slots. A tree keeps its slot for as long as it stays
// near and fades in and out of it, so petals never jump from tree to tree as
// the nearest trees change. A petal leaves a point in its tree's crown,
// flutters down on the breeze, turning over as it goes, lands on the slope
// the tree stands on (or on the water beside it), lies there and fades. Each
// petal's cycle has a fixed length and starts and ends unseen, so the loop
// has no seam. Fewer petals fall on lower graphics.
export const TREES = 24;
const PER_TREE = 160, FADE = .8; // s for a tree's petals to fade in or out
// The prevailing breeze (the weather's mean wind), m/s. Steady, so petals
// lying where they landed don't slide about as the gusts come and go.
const BREEZE = [1.2, .6];

export function createPetals(scene) {
  const count = TREES * PER_TREE;
  // Petal-major order (slot = index % TREES), so a shorter draw range keeps
  // every tree falling, each with fewer petals.
  let seed = 7771;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const seeds = new Float32Array(count * 4), slotOf = new Float32Array(count);
  for (let i = 0; i < count; i++) { seeds.set([random(), random(), random(), random()], i * 4); slotOf[i] = i % TREES; }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 4));
  geometry.setAttribute('slot', new THREE.BufferAttribute(slotOf, 1));
  // Per slot. trees: the foot (xyz) and the tree's height in metres (w).
  // ground: the slope it stands on (dy/dx, dy/dz), the level of the water it
  // overlooks (far below when none), and how far its petals have faded in.
  const trees = Array.from({ length: TREES }, () => new THREE.Vector4());
  const ground = Array.from({ length: TREES }, () => new THREE.Vector4());
  const slots = Array.from({ length: TREES }, () => ({ id: null, weight: 0, wanted: false }));
  const uniforms = { uTime: { value: 0 }, uScale: { value: 600 }, uTrees: { value: trees }, uGround: { value: ground }, uLight: { value: new THREE.Color(1, 1, 1) } };
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms,
    vertexShader: `attribute vec4 seed; attribute float slot;
      uniform float uTime, uScale; uniform vec4 uTrees[${TREES}], uGround[${TREES}];
      varying float vAlpha, vSpin, vTurn, vTone;
      // Offset from the tree's foot after t seconds in the air: downwind, with
      // a slow swing from side to side.
      vec2 drift(vec2 from, float t) {
        return from + vec2(${BREEZE.map(v => v.toFixed(2)).join(', ')}) * t * (.3 + .3 * seed.z) + vec2(sin(t * 1.7 + seed.x * 40.0), cos(t * 1.3 + seed.y * 40.0)) * .5 * min(t, 1.0);
      }
      // What a petal lands on at an offset from the foot, relative to the foot:
      // the slope the tree stands on, or the water, whichever is higher.
      float floorAt(vec4 g, vec2 at, float foot) { return max(dot(g.xy, at), g.z - foot); }
      void main(){
        vec4 tree = uTrees[int(slot)], g = uGround[int(slot)];
        if (g.w <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
        // Where it leaves the crown, and how fast it sinks (petals fall slowly).
        float a = seed.x * 6.2832, reach = sqrt(seed.y) * .62 * tree.w, h = (.5 + .42 * seed.z) * tree.w;
        float sink = .55 + .45 * fract(seed.w * 7.31);
        // A fixed cycle: long enough to fall 6 m below the foot (down a bank to
        // the water), then lie there. It never depends on where it lands.
        float cycle = (h + 6.0) / sink + 3.0, t = mod(uTime + seed.w * 97.0, cycle);
        vec2 from = vec2(cos(a), sin(a)) * reach;
        // When it lands: where its fall meets the slope (drifting downwind, it
        // closes on the ground at sink + slope · wind) or the water, whichever
        // comes first, then one Newton step for the side-to-side swing.
        float closing = sink + dot(g.xy, vec2(${BREEZE.map(v => v.toFixed(2)).join(', ')}) * (.3 + .3 * seed.z));
        float onSlope = closing > .05 ? (h - dot(g.xy, from)) / closing : 1e4, onWater = (h - g.z + tree.y) / sink;
        float land = min(onSlope, onWater);
        land += (h - sink * land - floorAt(g, drift(from, land), tree.y)) / (onWater < onSlope ? sink : max(closing, .05));
        land = clamp(land, 0.0, cycle - 2.5);
        float flight = min(t, land);
        vec2 at = drift(from, flight);
        vec3 p = vec3(tree.x + at.x, tree.y + max(h - sink * flight, floorAt(g, at, tree.y) + .03), tree.z + at.y);
        vec4 view = viewMatrix * vec4(p, 1.0);
        float d = -view.z;
        // Unseen at both ends of the cycle: fades in leaving the crown and out
        // over its last two seconds, lying where it landed.
        vAlpha = g.w * smoothstep(0.0, .8, t) * (1.0 - smoothstep(cycle - 2.0, cycle, t)) * (1.0 - smoothstep(90.0, 150.0, length(view.xyz))) * smoothstep(.3, 1.2, d);
        // Spins and turns over in the air, still once landed.
        vSpin = flight * (1.2 + 2.5 * seed.z) + seed.x * 12.0;
        vTurn = cos(flight * (2.0 + 3.0 * seed.y) + seed.w * 20.0);
        vTone = seed.z;
        // Drawn a little larger than life, or they'd vanish beyond a few metres.
        gl_PointSize = clamp(.22 * uScale / max(d, .1), 1.5, 32.0);
        gl_Position = projectionMatrix * view;
      }`,
    fragmentShader: `uniform vec3 uLight; varying float vAlpha, vSpin, vTurn, vTone;
      void main(){
        vec2 q = gl_PointCoord - .5;
        float c = cos(vSpin), s = sin(vSpin);
        q = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
        // Narrower as it turns edge-on, and a notch at the tip.
        q.x /= max(abs(vTurn), .2);
        float petal = 1.0 - smoothstep(.3, .46, length(q * vec2(1.5, 1.0)));
        petal *= 1.0 - (1.0 - smoothstep(.0, .07, abs(q.x))) * step(.3, q.y);
        float alpha = petal * vAlpha;
        if (alpha < .02) discard;
        // The two faces catch the light differently as it turns over.
        vec3 pink = mix(vec3(.95, .3, .48), vec3(1.0, .64, .76), .45 + .35 * vTurn + .2 * vTone);
        gl_FragColor = vec4(pink * uLight, alpha * .95);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false; points.renderOrder = 4; points.name = 'Petals'; points.visible = false; scene.add(points);
  let density = 1;

  return {
    points,
    // The nearest trees as { id, x, y, z, height, gx, gz, water }. A tree
    // already falling keeps its slot; a new one takes a free slot and fades
    // in; one no longer listed fades out, then frees its slot.
    setTrees(list) {
      const near = new Map(list.slice(0, TREES).map(tree => [tree.id, tree]));
      for (const slot of slots) slot.wanted = near.has(slot.id);
      for (const [id, tree] of near) {
        if (slots.some(slot => slot.id === id)) continue;
        const i = slots.findIndex(slot => slot.id === null);
        if (i < 0) break; // the rest wait for a slot to fade out
        Object.assign(slots[i], { id, weight: 0, wanted: true });
        trees[i].set(tree.x, tree.y, tree.z, tree.height);
        ground[i].set(tree.gx, tree.gz, tree.water ?? -1e4, 0);
      }
    },
    // pixels: drawing-buffer height, so petals keep their size.
    update({ pixels, fov }, dt) {
      uniforms.uTime.value += dt;
      uniforms.uScale.value = pixels / (2 * Math.tan(fov * Math.PI / 360));
      slots.forEach((slot, i) => {
        slot.weight = Math.min(1, Math.max(0, slot.weight + (slot.wanted ? dt : -dt) / FADE));
        if (!slot.wanted && slot.weight === 0) slot.id = null;
        ground[i].w = slot.weight;
      });
      points.visible = slots.some(slot => slot.weight > 0);
      geometry.setDrawRange(0, Math.round(PER_TREE * density) * TREES);
    },
    setDensity(value) { density = value; },
    setLight(color) { uniforms.uLight.value.copy(color); },
    get count() { return points.visible ? slots.filter(slot => slot.weight > 0).length * Math.round(PER_TREE * density) : 0; },
  };
}
