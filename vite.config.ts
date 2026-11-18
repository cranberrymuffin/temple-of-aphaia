/// <reference types="vitest/config" />
import { defineConfig } from 'vite'

// BASE_PATH: relative './' by default (local dev/preview); the GitHub Pages
// workflow sets '/temple-of-aphaia/'.
const base = process.env.BASE_PATH ?? './'

export default defineConfig({
  base,
  test: {
    include: ['tests/unit/**/*.test.ts'],
    setupFiles: ['tests/setup/yield-to-event-loop.ts'],
    environment: 'node',
    // Geometry/coplanarity checks run several times slower on 2-core CI runners than locally.
    testTimeout: 60_000,
    // On 2-core CI runners, parallel heavy geometry files starve the Vitest main process
    // (birpc "Timeout calling onTaskUpdate"); run files one at a time there.
    ...(process.env.CI ? { fileParallelism: false } : {}),
  },
})
