import * as THREE from 'three';
import { waterWave } from './lakes.mjs?v=amphibious-1';

export function createWater(scene) {
  const patches = new Map();
  const time = { value: 0 };
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.FrontSide,
    uniforms: { uTime: time, uShallow: { value: new THREE.Color('#559e9b') }, uDeep: { value: new THREE.Color('#214f64') }, uSky: { value: new THREE.Color('#b9cdd0') } },
    vertexShader: `attribute float bedDepth; attribute vec2 lakeUV;
      uniform float uTime; varying vec3 vWorld; varying float vDepth; varying vec2 vLake;
      void main(){
        vec3 p=position;
        float wave=sin(p.x*.11+p.z*.07+uTime*1.6)*.045+sin(p.x*-.06+p.z*.14-uTime*1.2)*.025;
        p.y+=wave*smoothstep(0.,1.,bedDepth);
        vWorld=p;vDepth=bedDepth;vLake=lakeUV;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
      }`,
    fragmentShader: `uniform float uTime; uniform vec3 uShallow,uDeep,uSky;
      varying vec3 vWorld; varying float vDepth; varying vec2 vLake;
      void main(){
        if(vDepth<.015||length(vLake)>1.02)discard;
        vec2 p=vWorld.xz;
        float a=p.x*.11+p.y*.07+uTime*1.6,b=p.x*-.06+p.y*.14-uTime*1.2;
        vec3 n=normalize(vec3(-.055*cos(a)+.03*cos(b),1.,-.035*cos(a)-.07*cos(b)));
        vec3 view=normalize(cameraPosition-vWorld),light=normalize(vec3(-.55,.85,.35));
        float fresnel=pow(1.-max(dot(n,view),0.),3.);
        float glint=pow(max(dot(n,normalize(view+light)),0.),150.);
        float ripple=sin(p.x*2.1+p.y*.7+uTime*1.7)*sin(p.y*1.6-uTime)*.013;
        vec3 color=mix(uShallow,uDeep,smoothstep(.3,7.,vDepth));
        color=mix(color,uSky,fresnel*.58)+ripple+vec3(.8,.84,.7)*glint*.55;
        float edge=(1.-smoothstep(.15,.9,vDepth))*(.45+.3*sin(p.x*.7+p.y*.6-uTime*2.));
        color=mix(color,vec3(.7,.83,.76),edge*.65);
        color=mix(color,uSky,smoothstep(350.,1450.,distance(cameraPosition,vWorld)));
        gl_FragColor=vec4(color,mix(.75,.97,smoothstep(0.,1.8,vDepth)));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });
  function build(world, lake) {
    const x0 = Math.floor((lake.x - lake.rx * 1.03) / 4) * 4, z0 = Math.floor((lake.z - lake.rz * 1.03) / 4) * 4;
    const nx = Math.ceil(lake.rx * 2.06 / 4) + 1, nz = Math.ceil(lake.rz * 2.06 / 4) + 1;
    const positions = [], depths = [], uv = [], indices = [];
    for (let iz = 0; iz <= nz; iz++) for (let ix = 0; ix <= nx; ix++) {
      const x = x0 + ix * 4, z = z0 + iz * 4;
      positions.push(x, lake.level + .012, z); depths.push(lake.level - world.surface(x, z));
      uv.push((x - lake.x) / lake.rx, (z - lake.z) / lake.rz);
    }
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
      const a = iz * (nx + 1) + ix, b = a + 1, c = a + nx + 1, d = c + 1;
      if (Math.max(depths[a], depths[b], depths[c], depths[d]) <= 0) continue;
      indices.push(a, c, b, b, c, d);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('bedDepth', new THREE.Float32BufferAttribute(depths, 1));
    geometry.setAttribute('lakeUV', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(indices); geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material); mesh.name = lake.name; mesh.renderOrder = 1;
    scene.add(mesh); patches.set(lake.id, mesh);
  }
  function sync(world, x, z) {
    const lakes = world.lakesNear(x, z, 1000), wanted = new Set(lakes.map(l => l.id));
    for (const [id, mesh] of patches) if (!wanted.has(id)) { scene.remove(mesh); mesh.geometry.dispose(); patches.delete(id); }
    for (const lake of lakes) if (!patches.has(lake.id)) build(world, lake);
  }
  const capacity = 80, ripples = [], dummy = new THREE.Object3D();
  const wakeGeometry = new THREE.RingGeometry(.85, 1, 28).rotateX(-Math.PI / 2);
  const opacity = new Float32Array(capacity);
  wakeGeometry.setAttribute('wakeOpacity', new THREE.InstancedBufferAttribute(opacity, 1));
  const wakeMaterial = new THREE.ShaderMaterial({ transparent: true, depthWrite: false,
    vertexShader: `attribute float wakeOpacity; varying float alpha;
      void main(){alpha=wakeOpacity;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`,
    fragmentShader: `varying float alpha; void main(){gl_FragColor=vec4(.81,.91,.84,alpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`
  });
  const wakes = new THREE.InstancedMesh(wakeGeometry, wakeMaterial, capacity); wakes.frustumCulled = false; wakes.count = 0; wakes.renderOrder = 2; scene.add(wakes);
  let emission = 0;
  function update(world, pose, dt) {
    time.value = pose.time; emission += dt;
    const water = world.waterAt(pose.x, pose.z);
    if (water && pose.y < water.level + .2 && emission >= (Math.abs(pose.speed) > 1 ? .085 : .6)) {
      emission = 0;
      const s = Math.sin(pose.heading), c = Math.cos(pose.heading);
      for (const side of [-1, 1]) {
        if (ripples.length >= capacity) ripples.shift();
        ripples.push({ x: pose.x - s * 2.25 + c * side * (1 + pose.transform * .5), z: pose.z - c * 2.25 - s * side * (1 + pose.transform * .5), level: water.level, age: 0, heading: pose.heading, power: Math.min(1, .18 + Math.abs(pose.speed) / 15) });
      }
    }
    for (let i = ripples.length - 1; i >= 0; i--) { ripples[i].age += dt; if (ripples[i].age > 2.8) ripples.splice(i, 1); }
    ripples.forEach((r, i) => {
      dummy.position.set(r.x, r.level + .055 + waterWave(r.x, r.z, pose.time), r.z);
      dummy.rotation.set(0, r.heading, 0); dummy.scale.set(.22 + r.age * .7, 1, .38 + r.age * 1.2); dummy.updateMatrix();
      wakes.setMatrixAt(i, dummy.matrix); opacity[i] = r.power * (1 - r.age / 2.8) * .46;
    });
    wakes.count = ripples.length; wakes.instanceMatrix.needsUpdate = true; wakeGeometry.attributes.wakeOpacity.needsUpdate = true;
  }
  function clear() { for (const mesh of patches.values()) { scene.remove(mesh); mesh.geometry.dispose(); } patches.clear(); ripples.length = 0; wakes.count = 0; emission = 0; }
  return { sync, update, clear, get count() { return patches.size; }, get wakeCount() { return ripples.length; } };
}
