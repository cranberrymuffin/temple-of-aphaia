// Rasterises the ornament SVG tiles (patterns.ts) into RepeatWrapping CanvasTextures at runtime.
// The texture exists immediately (filled with the ground colour) and is redrawn once the SVG decodes;
// `ready` resolves when every tile has been drawn, so screenshots never catch a blank ornament.
import { CanvasTexture, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace } from 'three'
import { patternSvg, type PatternColors, type PatternId } from './patterns'

export interface PatternTexture {
  texture: CanvasTexture
  ready: Promise<void>
}

function decode(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('ornament SVG failed to decode'))
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })
}

/** `size` = tile height in pixels (256 high tier, 128 med). Width follows the pattern's aspect. */
export function createPatternTexture(id: PatternId, colors: PatternColors, size: number, anisotropy = 1): PatternTexture {
  const { svg, aspect } = patternSvg(id, colors)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(size * aspect)
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = colors.ground
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  const texture = new CanvasTexture(canvas)
  texture.name = `pattern-${id}`
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearMipmapLinearFilter
  texture.anisotropy = anisotropy
  const ready = decode(svg)
    .then((img) => {
      ctx?.drawImage(img, 0, 0, canvas.width, canvas.height)
      texture.needsUpdate = true
    })
    .catch((err: unknown) => {
      // Keep the flat ground colour rather than failing the scene.
      console.warn(err)
    })
  return { texture, ready }
}
