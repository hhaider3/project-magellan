import * as THREE from 'three';

// The sky dome: a gradient from the horizon to the zenith that follows the time
// of day, a warm glow hugging the horizon around the sun at sunrise and
// sunset, the sun's disc and halo, the moon and stars at night, and clouds
// that drift with the wind and are lit from the sun's side (darker bases,
// bright edges, a silver lining near the sun). It travels with the camera.
// Clouds come from a small tiling noise texture made at startup, so the shader
// costs a few texture reads per pixel rather than long hash chains.
function noiseTexture(size = 256, cells = 32) {
  let seed = 1234;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const lattice = Array.from({ length: cells * cells }, random), data = new Uint8Array(size * size * 4);
  const at = (x, z) => lattice[((z % cells + cells) % cells) * cells + (x % cells + cells) % cells];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const fx = x / size * cells, fz = y / size * cells, ix = Math.floor(fx), iz = Math.floor(fz);
    let u = fx - ix, v = fz - iz; u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v);
    const n = (at(ix, iz) * (1 - u) + at(ix + 1, iz) * u) * (1 - v) + (at(ix, iz + 1) * (1 - u) + at(ix + 1, iz + 1) * u) * v;
    data.fill(Math.round(n * 255), (y * size + x) * 4, (y * size + x) * 4 + 3); data[(y * size + x) * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter; texture.generateMipmaps = true; texture.needsUpdate = true;
  return texture;
}

export function createSky(scene) {
  const color = () => ({ value: new THREE.Color() }), vec = () => ({ value: new THREE.Vector3(0, 1, 0) });
  const uniforms = {
    uZenith: color(), uHorizon: color(), uSunColor: color(), uCloudLit: color(), uCloudShade: color(),
    uSunDir: vec(), uMoonDir: vec(), uDay: { value: 1 }, uNight: { value: 0 }, uGlow: { value: 0 },
    uCover: { value: 0 }, uClouds: { value: .38 }, uTime: { value: 0 }, uDust: { value: 0 }, uNoise: { value: noiseTexture() },
  };
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, uniforms,
    vertexShader: 'varying vec3 vDir; void main(){ vDir=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `varying vec3 vDir;
      uniform vec3 uZenith, uHorizon, uSunColor, uCloudLit, uCloudShade, uSunDir, uMoonDir;
      uniform float uDay, uNight, uGlow, uCover, uClouds, uTime, uDust; uniform sampler2D uNoise;
      float fbm(vec2 p){
        float n=texture2D(uNoise,p).r*.5;
        p=mat2(.8,-.6,.6,.8)*p*2.03; n+=texture2D(uNoise,p).r*.25;
        p=mat2(.8,-.6,.6,.8)*p*2.01; n+=texture2D(uNoise,p).r*.125;
        p=mat2(.8,-.6,.6,.8)*p*2.02; n+=texture2D(uNoise,p).r*.0625;
        return n/.9375;
      }
      float starHash(vec3 c){return fract(sin(dot(c,vec3(12.9898,78.233,37.719)))*43758.5453);}
      void main(){
        vec3 ray=normalize(vDir); float y=ray.y, up=max(y,0.0);
        vec3 col=mix(uHorizon,uZenith,pow(up,.55));
        col=mix(col,uHorizon*.75,smoothstep(0.0,-.25,y)); // below the horizon
        float cs=max(dot(ray,uSunDir),0.0);
        // Sunrise and sunset glow, strongest toward the sun and along the horizon.
        float band=exp(-up*4.5);
        col+=uSunColor*(pow(cs,5.0)*.75+cs*cs*.18)*band*uGlow;
        // The sun's halo by day.
        col+=uSunColor*pow(cs,220.0)*.8*uDay;
        // Sun disc (not below the horizon), the moon and stars, behind the clouds.
        vec3 lights=uSunColor*smoothstep(.99955,.99975,cs)*smoothstep(-.012,.008,y)*(7.0+5.0*uDay);
        float cm=dot(ray,uMoonDir);
        lights+=vec3(.86,.9,1.0)*(smoothstep(.99962,.9998,cm)*1.6+pow(max(cm,0.0),90.0)*.05)*uNight*smoothstep(-.01,.02,y);
        vec3 cell=floor(ray*230.0), f=fract(ray*230.0)-.5; float h=starHash(cell);
        float star=step(.9965,h)*smoothstep(.16,.0,length(f))*(.6+.4*sin(uTime*2.3+h*80.0));
        lights+=vec3(.92,.95,1.0)*star*1.4*uNight*smoothstep(.02,.18,y);
        // Clouds drift with the wind and slowly change shape: a slower noise
        // field, moving on its own, gently warps where the pattern is read, so
        // clouds swell, merge and tear apart as they go. uClouds (0 clear to 1
        // overcast) sets how much of the sky they cover.
        vec2 p=ray.xz/(up+.12)*.11+vec2(.0018,.0011)*uTime;
        // (Under one noise cell of warp: more would smear clouds into marbling.)
        vec2 warp=vec2(texture2D(uNoise,p*.5+vec2(.0011,-.0006)*uTime).r,texture2D(uNoise,p*.5+vec2(.43,.71)-vec2(.0008,.0012)*uTime).r)-.5;
        p+=warp*.045;
        // Very large, slowly drifting fields give each part of the sky its own
        // character, so it never repeats one texture: where clouds gather and
        // where it stays open, big cloud masses or small scattered puffs, and
        // crisp heaped cumulus or soft stretched wisps.
        vec2 q=p*.055+vec2(-.0003,.0002)*uTime;
        float gather=texture2D(uNoise,q).r, size=texture2D(uNoise,q*1.3+vec2(.37,.11)).r, wisp=smoothstep(.63,.8,texture2D(uNoise,q*.8+vec2(.71,.53)).r);
        float big=smoothstep(.35,.65,size);
        float n=mix(fbm(p),fbm(p*.45+vec2(.19,.83)),big);
        // Wisps: noise stretched along one direction, thinner and softer.
        vec2 along=normalize(vec2(.8,.6)+(vec2(size,gather)-.5)*.6);
        vec2 w=vec2(dot(p,along)*.32,dot(p,vec2(-along.y,along.x))*2.2);
        float nw=texture2D(uNoise,w).r*.62+texture2D(uNoise,w*2.1+.3).r*.38;
        n=mix(n,nw,wisp);
        float deck=smoothstep(.12,.45,uCover);
        float amount=clamp(max(uClouds,uCover)+(gather-.5)*.55*(1.0-deck),0.0,1.0);
        float lo=mix(.74,.2,amount), edge=mix(.07,.24,wisp)+.08*(1.0-amount);
        float density=smoothstep(lo,lo+edge,n)*mix(1.0,.42,wisp*(1.0-deck));
        // Rain or snow closes the sky into one unbroken overcast deck, right
        // down to the horizon.
        density=mix(density*smoothstep(.0,.14,y),1.0,deck*smoothstep(-.02,.02,y));
        // Lit from the sun's side: denser cloud toward the sun puts a point in
        // shade (heaped clouds shade strongly, wisps barely).
        vec2 toSun=normalize(uSunDir.xz+vec2(1e-4))*.018;
        float ahead=mix(fbm(p+toSun),fbm((p+toSun)*.45+vec2(.19,.83)),big);
        float shade=clamp(.6+(mix(n,nw,wisp)-mix(ahead,nw,wisp))*mix(5.0,1.5,wisp),0.0,1.0);
        shade=mix(shade,.55,deck*.85); // an overcast is lit evenly from above
        vec3 cloud=mix(uCloudShade,uCloudLit,shade)+uSunColor*pow(cs,9.0)*(1.0-density)*.7*(uDay+uGlow);
        col+=lights*(1.0-density);
        // The deck: broad, layered folds of darker and lighter cloud, not the
        // fine pattern of fair-weather clouds.
        float fold=texture2D(uNoise,vec2(dot(p,vec2(.8,.6))*.09,dot(p,vec2(-.6,.8))*.35)+uTime*vec2(.0004,.0001)).r*.6+texture2D(uNoise,p*.21+.5).r*.4;
        cloud*=mix(1.0,.78+.42*fold,deck);
        col=mix(col,cloud,density*mix(.88,1.0,deck));
        // Haze where the sky meets the land.
        col=mix(col,uHorizon,(1.0-smoothstep(0.0,.07,abs(y)))*.55);
        // Thick blowing sand: the sky is the dust itself, the horizon's colour
        // all the way round and up to well above the land, so fully fogged
        // hills and mountains leave no silhouette against it.
        col=mix(col,mix(uHorizon,uZenith,smoothstep(.4,1.0,up)),uDust);
        gl_FragColor=vec4(col,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(6000, 32, 20), material);
  mesh.name = 'Sky'; mesh.frustumCulled = false; scene.add(mesh);
  return {
    mesh, uniforms,
    // light: daylight() output; sky: { zenith, horizon, cloudLit, cloudShade } after weather; cover 0–1.
    update(light, sky, cover, seconds) {
      uniforms.uZenith.value.copy(sky.zenith); uniforms.uHorizon.value.copy(sky.horizon);
      uniforms.uCloudLit.value.copy(sky.cloudLit); uniforms.uCloudShade.value.copy(sky.cloudShade);
      uniforms.uSunColor.value.setRGB(...light.sunColor).multiplyScalar(1 - .85 * cover);
      uniforms.uSunDir.value.set(...light.sun); uniforms.uMoonDir.value.set(...light.moon);
      uniforms.uDay.value = light.day * (1 - .8 * cover); uniforms.uNight.value = light.night * (1 - .9 * cover);
      uniforms.uGlow.value = Math.min(1, light.golden + light.dusk) * (1 - .7 * cover);
      uniforms.uCover.value = cover; uniforms.uTime.value = seconds; uniforms.uClouds.value = sky.cloudiness ?? .38;
    },
    // 0–1: how far a sandstorm has turned the whole sky to plain dust.
    setDust(amount) { uniforms.uDust.value = amount; },
  };
}
