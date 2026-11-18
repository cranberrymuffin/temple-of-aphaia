// Terrain and sea materials. Scenery, not reconstruction claims, so these tones live here rather than in
// palette.json. The ancient terraces are bare earth (Ministry board, research brief section 21); the hill
// outside them gets a subtle slope/height/noise tint (dry grass, pine scrub, limestone outcrops, a paler
// coastal band) over the Copernicus DSM.
import { Color, MeshStandardMaterial, Vector2, Vector4 } from 'three'

export const TERRAIN_TONES = {
  earth: '#9d8a69',
  dryGrass: '#a39668',
  scrub: '#66703f',
  rock: '#948c7e',
  coast: '#b8aa88',
  sea: '#2c6488',
} as const

export interface TerrainSite {
  /** Terrace extent in plan (x, z); inside it the ground is bare earth. */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  /** Sea level (y); absent when the DEM fallback is used. */
  seaLevelY?: number
}

const NOISE = /* glsl */ `
float aphHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float aphNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(aphHash(i), aphHash(i + vec2(1.0, 0.0)), u.x), mix(aphHash(i + vec2(0.0, 1.0)), aphHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
`

export function createTerrainMaterial(site: TerrainSite): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 })
  mat.name = 'terrain'
  const uniforms = {
    uSite: { value: new Vector4(site.bounds.minX, site.bounds.maxX, site.bounds.minZ, site.bounds.maxZ) },
    uSea: { value: new Vector2(site.seaLevelY ?? -1e4, site.seaLevelY === undefined ? 0 : 1) },
    uEarth: { value: new Color(TERRAIN_TONES.earth) },
    uGrass: { value: new Color(TERRAIN_TONES.dryGrass) },
    uScrub: { value: new Color(TERRAIN_TONES.scrub) },
    uRock: { value: new Color(TERRAIN_TONES.rock) },
    uCoast: { value: new Color(TERRAIN_TONES.coast) },
  }
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vAphW;\nvarying vec3 vAphN;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvAphW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvAphN = normalize(mat3(modelMatrix) * objectNormal);',
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vAphW;
varying vec3 vAphN;
uniform vec4 uSite;
uniform vec2 uSea;
uniform vec3 uEarth, uGrass, uScrub, uRock, uCoast;
${NOISE}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec2 p = vAphW.xz;
  float n1 = aphNoise(p / 38.0);
  float n2 = aphNoise(p / 7.0);
  float n = 0.65 * n1 + 0.35 * n2;
  float slope = 1.0 - clamp(normalize(vAphN).y, 0.0, 1.0);
  vec3 hill = mix(uGrass, uScrub, smoothstep(0.42, 0.68, n));
  hill = mix(hill, uRock, smoothstep(0.32, 0.55, slope + (n2 - 0.5) * 0.25));
  hill = mix(hill, uCoast, uSea.y * (1.0 - smoothstep(uSea.x + 1.5, uSea.x + 12.0, vAphW.y)));
  // Bare earth on the terraces, blended over a few metres past their extent.
  vec2 d = max(vec2(uSite.x - p.x, uSite.z - p.y), vec2(p.x - uSite.y, p.y - uSite.w));
  float outside = smoothstep(0.0, 8.0, max(max(d.x, d.y), 0.0));
  vec3 earth = uEarth * (0.94 + 0.12 * n2);
  diffuseColor.rgb = mix(earth, hill * (0.92 + 0.16 * n2), outside);
}`,
      )
  }
  return mat
}

export function createSeaMaterial(): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({ color: TERRAIN_TONES.sea, roughness: 0.3, metalness: 0 })
  mat.name = 'sea'
  return mat
}
