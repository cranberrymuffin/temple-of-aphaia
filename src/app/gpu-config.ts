// detect-gpu benchmarks are self-hosted from public/detect-gpu/ (no third-party CDN).
// Pass as `benchmarksURL` to getGPUTier() (Step 6 quality.ts).
export const DETECT_GPU_BENCHMARKS_URL = `${import.meta.env.BASE_URL}detect-gpu`
