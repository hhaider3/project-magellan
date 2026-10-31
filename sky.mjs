import * as THREE from 'three';
import { SYNTHWAVE, SUN_RADIUS } from './synthwave.mjs?v=synth-1';

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
    uSynth: { value: 0 }, uMeteorFrom: vec(), uMeteorDir: vec(), uMeteor: { value: new THREE.Vector3() }, ...Object.fromEntries(['horizon', 'low', 'mid', 'high', 'zenith', 'glow', 'sunTop', 'sunMid', 'sunLow'].map(name => [`uSw_${name}`, { value: new THREE.Color(SYNTHWAVE[name]) }])),
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
      // Synthwave (synthwave.mjs): indigo overhead to hot pink at the
      // horizon, glowing orange under a huge striped sun, with stars and the
      // odd shooting star. Its colours are the ones shown, not tone mapped.
      uniform float uSynth; uniform vec3 uSw_horizon, uSw_low, uSw_mid, uSw_high, uSw_zenith, uSw_glow, uSw_sunTop, uSw_sunMid, uSw_sunLow;
      // A shooting star: where its path starts, the way it runs (both on the
      // sky), and how far its head has gone, its tail's length (radians) and
      // its brightness (0: none).
      uniform vec3 uMeteorFrom, uMeteorDir, uMeteor;
      // Two layers of stars: faint, dense ones and a scatter of bright ones,
      // some tinted pink or cyan. Each star sits at a random spot in a cell
      // the sky passes through the middle of, measured in pixels so it draws
      // at least a pixel across and never flickers as the view turns.
      vec3 synthStars(vec3 ray, float px){
        vec3 stars=vec3(0.0);
        for(int i=0;i<2;i++){
          float scale=i==0?120.0:55.0;
          vec3 cell=floor(ray*scale); float h=starHash(cell);
          if(h<(i==0?.92:.96)||abs(length(cell+.5)-scale)>.3) continue;
          vec3 at=normalize(cell+.5+(vec3(starHash(cell+3.1),starHash(cell+7.7),starHash(cell+13.3))-.5)*.5);
          float d=length(ray-at)/px, size=i==0?.75:1.15, k=fract(h*97.0);
          float glow=exp(-d*d/(size*size))+(i==0?0.0:exp(-d*.55)*.12);
          vec3 tint=i==0||k<.6?vec3(1.0,.94,1.0):k<.8?vec3(1.0,.62,.9):vec3(.62,.92,1.0);
          stars+=tint*glow*(i==0?.45+.55*k:1.1+.5*k)*(.7+.3*sin(uTime*(1.5+k*2.0)+h*80.0));
        }
        return stars;
      }
      vec3 synthSky(vec3 ray){
        float y=ray.y, up=max(y,0.0);
        vec3 col=mix(uSw_horizon,uSw_low,smoothstep(0.0,.12,up));
        col=mix(col,uSw_mid,smoothstep(.08,.34,up));
        col=mix(col,uSw_high,smoothstep(.26,.6,up));
        col=mix(col,uSw_zenith,smoothstep(.5,1.0,up));
        float toward=max(dot(normalize(ray.xz+vec2(1e-5)),normalize(uSunDir.xz+vec2(1e-5))),0.0);
        col+=uSw_glow*exp(-up*10.0)*(.2+.8*pow(toward,5.0))*.8;
        // Faint ruled lines across the sky, as on the cover art.
        float ly=up*90.0, lw=fwidth(ly);
        col*=1.0-.14*(1.0-smoothstep(.08-lw,.08+lw,abs(fract(ly)-.5)*2.0))*smoothstep(.03,.12,up)*(1.0-smoothstep(.6,.9,up));
        // Stars fade out into the glow just above the horizon.
        float px=length(fwidth(ray));
        col+=synthStars(ray,px)*smoothstep(.01,.15,up);
        // The shooting star: a streak along a great circle, thinning and
        // fading from its bright head back along its tail.
        if(uMeteor.z>0.0){
          float behind=uMeteor.x-atan(dot(ray,uMeteorDir),dot(ray,uMeteorFrom)), off=dot(ray,cross(uMeteorFrom,uMeteorDir))/px;
          float tail=clamp(1.0-behind/uMeteor.y,0.0,1.0)*step(0.0,behind);
          vec3 head=uMeteorFrom*cos(uMeteor.x)+uMeteorDir*sin(uMeteor.x);
          float glow=exp(-length(ray-head)/px*.45);
          col+=vec3(1.0,.93,1.0)*(exp(-off*off/(.35+1.1*tail))*tail*tail*1.6+glow*1.3)*uMeteor.z*smoothstep(.0,.05,up);
        }
        // The sun: yellow at the top through orange to pink, its lower part cut
        // by stripes that widen toward the bottom and slide slowly down.
        vec3 sd=uSunDir, sUp=normalize(vec3(0.0,1.0,0.0)-sd*sd.y), sRight=cross(sUp,sd);
        vec2 q=vec2(dot(ray,sRight),dot(ray,sUp))/${SUN_RADIUS.toFixed(3)};
        float r=length(q), facing=step(0.0,dot(ray,sd)), aa=fwidth(r)*1.2;
        float disc=(1.0-smoothstep(1.0-aa,1.0+aa,r))*facing;
        float s=q.y*8.0+uTime*.3, sw=fwidth(s)*2.0, gap=mix(.0,.7,smoothstep(.5,-.45,q.y));
        disc*=smoothstep(.0,sw,abs(fract(s)-.5)*2.0-gap+sw*.5)+(1.0-smoothstep(.0,.03,gap));
        vec3 sun=mix(uSw_sunLow,uSw_sunMid,smoothstep(-.85,.1,q.y));
        sun=mix(sun,uSw_sunTop,smoothstep(.1,.85,q.y));
        col+=uSw_sunLow*exp(-max(r-1.0,0.0)*3.2)*.3*facing;
        col=mix(col,sun,clamp(disc,0.0,1.0)*smoothstep(-.003,.003,y));
        // Below the horizon (seen only past the far land): the fog's pink.
        return mix(col,uSw_horizon,smoothstep(0.0,-.01,y));
      }
      void main(){
        vec3 ray=normalize(vDir); float y=ray.y, up=max(y,0.0);
        if(uSynth>.5){
          gl_FragColor=vec4(synthSky(ray),1.0);
          #include <colorspace_fragment>
          return;
        }
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
  // Shooting stars, in the synthwave sky: every 4–12 seconds one streaks
  // down toward the horizon somewhere in view (the chase camera sees about
  // 18° up), in about half a second to a second, clear of the sun.
  // forward: the camera's direction.
  const meteor = { wait: 2, age: 0, life: 0, length: 0, bright: 0 }, across = new THREE.Vector3(), upward = new THREE.Vector3();
  function shootingStars(dt, forward) {
    const from = uniforms.uMeteorFrom.value, way = uniforms.uMeteorDir.value, state = uniforms.uMeteor.value;
    state.z = 0;
    if (!uniforms.uSynth.value) return;
    if (!meteor.life) {
      if ((meteor.wait -= dt) > 0) return;
      // Up to 40° either side of the view and 7–17° up, at least 26° round from the sun.
      const sun = uniforms.uSunDir.value, sunAzimuth = Math.atan2(sun.x, sun.z);
      let azimuth = Math.atan2(forward.x, forward.z) + (Math.random() * 2 - 1) * .7;
      let fromSun = Math.atan2(Math.sin(azimuth - sunAzimuth), Math.cos(azimuth - sunAzimuth));
      if (Math.abs(fromSun) < .45) { fromSun = Math.sign(fromSun || 1) * (.45 + Math.random() * .25); azimuth = sunAzimuth + fromSun; }
      const elevation = .12 + Math.random() * .18;
      from.set(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation));
      // Falling 15–50° below level, sideways (away from the sun when near it).
      across.set(0, 1, 0).cross(from).normalize(); upward.set(0, 1, 0).addScaledVector(from, -from.y).normalize();
      const fall = .26 + Math.random() * .6, side = Math.abs(fromSun) < .75 ? Math.sign(fromSun) : Math.random() < .5 ? -1 : 1;
      way.copy(across).multiplyScalar(side * Math.cos(fall)).addScaledVector(upward, -Math.sin(fall)).normalize();
      Object.assign(meteor, { age: 0, life: .5 + Math.random() * .6, length: .14 + Math.random() * .18, bright: .7 + Math.random() * .6 });
    }
    const t = (meteor.age += dt) / meteor.life;
    if (t >= 1) { meteor.life = 0; meteor.wait = 4 + Math.random() * 8; return; }
    // The head runs on, easing a little; its tail streams out behind it, and
    // the whole streak flares up at once and fades over its second half.
    const head = meteor.length * (1 - (1 - t) ** 1.4), fade = Math.min(1, t * 10) * Math.min(1, (1 - t) * 2.2);
    state.set(head, Math.max(1e-4, Math.min(head, meteor.length * .5)), meteor.bright * fade);
  }
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
    // The synthwave sky in place of the real one (the sun's direction still comes from update).
    setSynthwave(on) { uniforms.uSynth.value = on ? 1 : 0; },
    shootingStars,
  };
}
