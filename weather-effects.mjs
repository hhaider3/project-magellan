import * as THREE from 'three';

// Rain, snow and blowing sand around the camera: one draw call each, all motion in the
// vertex shader (no per-frame buffer updates). Particles live in a box that
// wraps around the camera, so the fall never runs out and nothing is
// allocated while driving or flying. Fewer are drawn on lower graphics.
const RAIN = 4200, SNOW = 3800, GRIT = 5200, BILLOWS = 420;
const RAIN_BOX = new THREE.Vector3(44, 30, 44), SNOW_BOX = new THREE.Vector3(46, 28, 46);
const GRIT_BOX = new THREE.Vector3(40, 18, 40), BILLOW_BOX = new THREE.Vector3(70, 26, 70);

function seeded(count, stride, fill) {
  let seed = 4242;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const data = new Float32Array(count * stride);
  for (let i = 0; i < count; i++) fill(data, i, random);
  return data;
}

export function createWeatherEffects(scene) {
  // uOffset is the fall so far, integrated each frame from the velocity
  // relative to the camera (and wrapped to the box), so a change of speed
  // bends the fall instead of making the particles jump.
  const light = { value: new THREE.Color(1, 1, 1) }; // the scene's light on the drops: dim at night
  const time = { value: 0 }, wind = { value: new THREE.Vector3() }, rainOffset = { value: new THREE.Vector3() }, snowOffset = { value: new THREE.Vector3() };
  const sandWind = { value: new THREE.Vector3() }, gritOffset = { value: new THREE.Vector3() }, billowOffset = { value: new THREE.Vector3() }, sandStrength = { value: 0 }, scale = { value: 600 };
  const sandColor = { value: new THREE.Color(.78, .6, .4) };

  // Rain: short streaks along the fall direction relative to the camera, so
  // they slant as you drive or fly through them.
  const rainGeometry = new THREE.BufferGeometry();
  const rainSeed = seeded(RAIN, 4, (d, i, r) => d.set([r(), r(), r(), r()], i * 4));
  const rainSeeds = new Float32Array(RAIN * 2 * 4), rainEnds = new Float32Array(RAIN * 2);
  for (let i = 0; i < RAIN; i++) for (let e = 0; e < 2; e++) { rainSeeds.set(rainSeed.subarray(i * 4, i * 4 + 4), (i * 2 + e) * 4); rainEnds[i * 2 + e] = e; }
  rainGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RAIN * 2 * 3), 3));
  rainGeometry.setAttribute('seed', new THREE.BufferAttribute(rainSeeds, 4));
  rainGeometry.setAttribute('end', new THREE.BufferAttribute(rainEnds, 1));
  const rainMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: time, uFall: wind, uOffset: rainOffset, uBox: { value: RAIN_BOX }, uStrength: { value: 0 }, uLight: light },
    vertexShader: `attribute vec4 seed; attribute float end;
      uniform float uTime; uniform vec3 uFall, uOffset, uBox; varying float vAlpha;
      void main(){
        // uFall is the rain's velocity relative to the camera; drops differ a
        // little in speed.
        vec3 p = seed.xyz * uBox + uOffset + vec3(0.0, -uTime * seed.w * 2.5, 0.0);
        p = mod(p - cameraPosition, uBox) - uBox * .5;
        // Streaks stretch with speed through the rain, as motion blur would:
        // about a metre falling past a parked car, several metres from a plane.
        float rush = length(uFall);
        vec3 streak = uFall / rush * clamp(rush * .075, 1.0, 7.0) * (.75 + .5 * seed.w);
        p -= streak * end;
        float d = length(p);
        vAlpha = (1.0 - smoothstep(uBox.x * .3, uBox.x * .5, d)) * smoothstep(.6, 2.5, d) * (.5 + .5 * end) * (1.0 + smoothstep(15.0, 60.0, rush) * .6);
        gl_Position = projectionMatrix * viewMatrix * vec4(p + cameraPosition, 1.0);
      }`,
    fragmentShader: `uniform float uStrength; uniform vec3 uLight; varying float vAlpha;
      void main(){
        gl_FragColor = vec4(vec3(.82, .86, .9) * uLight, vAlpha * .55 * uStrength);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const rain = new THREE.LineSegments(rainGeometry, rainMaterial);
  rain.frustumCulled = false; rain.renderOrder = 4; rain.name = 'Rain'; rain.visible = false; scene.add(rain);

  // Snow: soft round flakes drifting down with a gentle sway.
  const snowGeometry = new THREE.BufferGeometry();
  snowGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SNOW * 3), 3));
  snowGeometry.setAttribute('seed', new THREE.BufferAttribute(seeded(SNOW, 4, (d, i, r) => d.set([r(), r(), r(), r()], i * 4)), 4));
  const snowMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: time, uOffset: snowOffset, uBox: { value: SNOW_BOX }, uStrength: { value: 0 }, uScale: { value: 600 }, uLight: light },
    vertexShader: `attribute vec4 seed;
      uniform float uTime, uScale; uniform vec3 uOffset, uBox; varying float vAlpha;
      void main(){
        float t = uTime * (.75 + .5 * seed.w);
        vec3 p = seed.xyz * uBox + uOffset + vec3(sin(t * .9 + seed.w * 40.0) * .7, -uTime * seed.w * .5, cos(t * .7 + seed.x * 30.0) * .7);
        p = mod(p - cameraPosition, uBox) - uBox * .5;
        float d = length(p);
        vAlpha = (1.0 - smoothstep(uBox.x * .3, uBox.x * .5, d)) * smoothstep(.4, 1.6, d);
        vec4 view = viewMatrix * vec4(p + cameraPosition, 1.0);
        gl_PointSize = clamp((.11 + .09 * seed.w) * uScale / -view.z, 1.5, 22.0);
        gl_Position = projectionMatrix * view;
      }`,
    fragmentShader: `uniform float uStrength; uniform vec3 uLight; varying float vAlpha;
      void main(){
        float r = length(gl_PointCoord - .5);
        float a = (1.0 - smoothstep(.15, .5, r)) * vAlpha * .95 * uStrength;
        if (a < .01) discard;
        gl_FragColor = vec4(vec3(.96, .97, 1.0) * uLight, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const snow = new THREE.Points(snowGeometry, snowMaterial);
  snow.frustumCulled = false; snow.renderOrder = 4; snow.name = 'Snow'; snow.visible = false; scene.add(snow);

  // Sandstorm: fine grit streaking past on the wind, close to the ground's
  // pace of the gusts (so it races sideways rather than falling), and big,
  // faint billows of dust rolling through, which make the murk move.
  const gritGeometry = new THREE.BufferGeometry();
  const gritSeed = seeded(GRIT, 4, (d, i, r) => d.set([r(), r(), r(), r()], i * 4));
  const gritSeeds = new Float32Array(GRIT * 2 * 4), gritEnds = new Float32Array(GRIT * 2);
  for (let i = 0; i < GRIT; i++) for (let e = 0; e < 2; e++) { gritSeeds.set(gritSeed.subarray(i * 4, i * 4 + 4), (i * 2 + e) * 4); gritEnds[i * 2 + e] = e; }
  gritGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(GRIT * 2 * 3), 3));
  gritGeometry.setAttribute('seed', new THREE.BufferAttribute(gritSeeds, 4));
  gritGeometry.setAttribute('end', new THREE.BufferAttribute(gritEnds, 1));
  const gritMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: time, uWind: sandWind, uOffset: gritOffset, uBox: { value: GRIT_BOX }, uStrength: sandStrength, uLight: light, uColor: sandColor },
    vertexShader: `attribute vec4 seed; attribute float end;
      uniform float uTime; uniform vec3 uWind, uOffset, uBox; varying float vAlpha;
      void main(){
        // Each grain tumbles a little up and down as it blows along.
        float t = uTime * (1.5 + seed.w * 2.0) + seed.x * 50.0;
        vec3 p = seed.xyz * uBox + uOffset * (.8 + .4 * seed.w) + vec3(0.0, sin(t) * .6, 0.0);
        p = mod(p - cameraPosition, uBox) - uBox * .5;
        float rush = length(uWind);
        vec3 streak = uWind / max(rush, .001) * clamp(rush * .06, .3, 4.0) * (.6 + .6 * seed.w);
        p -= streak * end;
        float d = length(p);
        vAlpha = (1.0 - smoothstep(uBox.x * .25, uBox.x * .5, d)) * (1.0 - smoothstep(uBox.y * .3, uBox.y * .5, abs(p.y))) * smoothstep(.5, 2.0, d) * (.35 + .65 * end);
        gl_Position = projectionMatrix * viewMatrix * vec4(p + cameraPosition, 1.0);
      }`,
    fragmentShader: `uniform float uStrength; uniform vec3 uLight, uColor; varying float vAlpha;
      void main(){
        gl_FragColor = vec4(uColor * 1.7 * uLight, vAlpha * .4 * uStrength);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const grit = new THREE.LineSegments(gritGeometry, gritMaterial);
  grit.frustumCulled = false; grit.renderOrder = 4; grit.name = 'Sand'; grit.visible = false; scene.add(grit);

  const billowGeometry = new THREE.BufferGeometry();
  billowGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BILLOWS * 3), 3));
  billowGeometry.setAttribute('seed', new THREE.BufferAttribute(seeded(BILLOWS, 4, (d, i, r) => d.set([r(), r(), r(), r()], i * 4)), 4));
  const billowMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: time, uOffset: billowOffset, uBox: { value: BILLOW_BOX }, uStrength: sandStrength, uScale: scale, uLight: light, uColor: sandColor },
    vertexShader: `attribute vec4 seed;
      uniform float uTime, uScale; uniform vec3 uOffset, uBox; varying float vAlpha; varying float vShade;
      void main(){
        vec3 p = seed.xyz * uBox + uOffset * (.7 + .3 * seed.w);
        p = mod(p - cameraPosition, uBox) - uBox * .5;
        float d = length(p);
        // Each billow swells and thins over a few seconds, so the murk churns.
        float pulse = .5 + .5 * sin(uTime * (.3 + .4 * seed.w) + seed.z * 40.0);
        // Faded out toward the box's faces, so wrapping round never shows.
        vAlpha = (1.0 - smoothstep(uBox.x * .3, uBox.x * .5, d)) * (1.0 - smoothstep(uBox.y * .3, uBox.y * .5, abs(p.y))) * smoothstep(1.5, 7.0, d) * (.4 + .6 * pulse);
        vShade = .8 + .3 * seed.y;
        vec4 view = viewMatrix * vec4(p + cameraPosition, 1.0);
        gl_PointSize = clamp((4.0 + 6.0 * seed.w) * uScale / max(-view.z, .1), 2.0, 420.0);
        gl_Position = projectionMatrix * view;
      }`,
    fragmentShader: `uniform float uStrength; uniform vec3 uLight, uColor; varying float vAlpha; varying float vShade;
      void main(){
        vec2 c = gl_PointCoord - .5; float r = dot(c, c) * 4.0;
        float a = (1.0 - r) * (1.0 - r) * vAlpha * .16 * uStrength;
        if (r > 1.0 || a < .004) discard;
        gl_FragColor = vec4(uColor * vShade * uLight, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const billows = new THREE.Points(billowGeometry, billowMaterial);
  billows.frustumCulled = false; billows.renderOrder = 3; billows.name = 'SandBillows'; billows.visible = false; scene.add(billows);

  let density = 1;
  const relative = new THREE.Vector3(), snowFall = new THREE.Vector3();
  const advance = (offset, velocity, box, dt) => {
    offset.addScaledVector(velocity, dt);
    offset.set(offset.x % box.x, offset.y % box.y, offset.z % box.z);
  };
  return {
    // Rain, snow and sand amounts are 0–1 each (they cross-fade); cameraVelocity
    // and gust in m/s; pixels: drawing-buffer height, so flakes keep their size.
    update({ rainAmount, snowAmount, sandAmount = 0, cameraVelocity, gust, pixels, fov }, dt) {
      time.value += dt;
      scale.value = pixels / (2 * Math.tan(fov * Math.PI / 360));
      // Fall velocity relative to the camera: rain ~9 m/s, snow ~1.3 m/s,
      // pushed sideways by the wind.
      relative.set(gust.x, 0, gust.z).sub(cameraVelocity); // includes the camera's own climb or fall
      rainMaterial.uniforms.uStrength.value = rainAmount; snowMaterial.uniforms.uStrength.value = snowAmount;
      rain.visible = rainAmount > .01; snow.visible = snowAmount > .01;
      if (rain.visible) {
        wind.value.set(relative.x, -9 + relative.y, relative.z);
        advance(rainOffset.value, wind.value, RAIN_BOX, dt);
        rainGeometry.setDrawRange(0, Math.round(RAIN * density * Math.min(1, .25 + rainAmount)) * 2);
      }
      if (snow.visible) {
        snowFall.set(relative.x, -1.3 + relative.y, relative.z);
        advance(snowOffset.value, snowFall, SNOW_BOX, dt);
        snowGeometry.setDrawRange(0, Math.round(SNOW * density * Math.min(1, .25 + snowAmount)));
        snowMaterial.uniforms.uScale.value = scale.value;
      }
      sandStrength.value = sandAmount;
      grit.visible = billows.visible = sandAmount > .01;
      if (grit.visible) {
        // Sand rides the wind itself (the gust is a storm's 15–25 m/s here),
        // with a slight lift off the ground.
        sandWind.value.set(relative.x, .6 + relative.y, relative.z);
        advance(gritOffset.value, sandWind.value, GRIT_BOX, dt);
        advance(billowOffset.value, sandWind.value, BILLOW_BOX, dt);
        gritGeometry.setDrawRange(0, Math.round(GRIT * density * Math.min(1, .25 + sandAmount)) * 2);
        billowGeometry.setDrawRange(0, Math.round(BILLOWS * Math.min(1, .5 + density * .5) * Math.min(1, .3 + sandAmount)));
      }
    },
    setDensity(value) { density = value; },
    setLight(color) { light.value.copy(color); },
    // The colour of the blowing sand (the desert's own).
    setSandColor(color) { sandColor.value.copy(color); },
    get counts() { return { rain: rain.visible ? rainGeometry.drawRange.count / 2 : 0, snow: snow.visible ? snowGeometry.drawRange.count : 0, sand: grit.visible ? gritGeometry.drawRange.count / 2 : 0, billows: billows.visible ? billowGeometry.drawRange.count : 0 }; },
  };
}

// Fog is applied after tone mapping, the sky before it, so the fog must be the
// sky's horizon colour after ACES at the renderer's exposure (three.js r160's
// ACESFilmicToneMapping), or fogged terrain leaves a band on the skyline.
const ACES_IN = [[.59719, .35458, .04823], [.07600, .90834, .01566], [.02840, .13383, .83777]];
const ACES_OUT = [[1.60475, -.53108, -.07367], [-.10208, 1.10813, -.00605], [-.00327, -.07276, 1.07602]];
const encode = c => c <= .0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - .055;
export function toneMappedHorizon(color, exposure, target = new THREE.Color()) {
  const v = [color.r, color.g, color.b].map(c => c * exposure / .6);
  const fit = x => (x * (x + .0245786) - .000090537) / (x * (.983729 * x + .4329510) + .238081);
  const mid = ACES_IN.map(row => fit(row[0] * v[0] + row[1] * v[1] + row[2] * v[2]));
  const [r, g, b] = ACES_OUT.map(row => encode(Math.min(1, Math.max(0, row[0] * mid[0] + row[1] * mid[1] + row[2] * mid[2]))));
  return target.setRGB(r, g, b, THREE.SRGBColorSpace);
}
