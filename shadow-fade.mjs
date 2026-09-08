import { ShaderChunk } from 'three';

let installed = false;
// Install before any materials compile. Apply at the shadow receiver so terrain,
// cars and instanced props share the transition, including on sloping ground.
// The map stays the same size/resolution; no extra shadow pass is required.
export function installSunShadowFade() {
  if (installed) return;
  installed = true;
  ShaderChunk.shadowmap_pars_fragment += `
    #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
    float getFadedSunShadow(sampler2D shadowMap, vec2 mapSize, float bias, float radius, vec4 shadowCoord) {
      vec3 coord = shadowCoord.xyz / shadowCoord.w;
      vec3 edge = min(coord, vec3(1.0) - coord);
      // Leave a small fully lit guard band before clipping; fade over about
      // 19 metres of the 96 metre map, with full strength in the central area.
      float coverage = smoothstep(0.02, 0.22, min(edge.x, edge.y))
                     * smoothstep(0.02, 0.12, edge.z);
      return mix(1.0, getShadow(shadowMap, mapSize, bias, radius, shadowCoord), coverage);
    }
    #endif
  `;
  for (const chunk of ['lights_fragment_begin', 'shadowmask_pars_fragment']) {
    ShaderChunk[chunk] = ShaderChunk[chunk].replaceAll('getShadow( directionalShadowMap', 'getFadedSunShadow( directionalShadowMap');
  }
}
