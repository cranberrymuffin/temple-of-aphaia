// Main-thread side of the geometry Worker. One generation per page load (the tier is fixed at startup).
import type { GenerateRequest, GenerateResponse } from '../geometry/protocol'

export type GenerateResult = Extract<GenerateResponse, { ok: true }> & { wallMs: number }

export function generateTemple(req: GenerateRequest): Promise<GenerateResult> {
  return new Promise((resolve, reject) => {
    const t0 = performance.now()
    const worker = new Worker(new URL('../geometry/worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<GenerateResponse>) => {
      worker.terminate()
      if (e.data.ok) resolve({ ...e.data, wallMs: performance.now() - t0 })
      else reject(new Error(e.data.error))
    }
    worker.onerror = (e) => {
      worker.terminate()
      reject(new Error(e.message))
    }
    worker.postMessage(req)
  })
}
