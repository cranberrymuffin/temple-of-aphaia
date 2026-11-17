/// <reference types="vitest/config" />
import { defineConfig } from 'vite'

// BASE_PATH: relative './' by default (local dev/preview); the GitHub Pages
// workflow sets '/temple-of-aphaia/'.
const base = process.env.BASE_PATH ?? './'

export default defineConfig({
  base,
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    // Geometry/coplanarity checks run several times slower on 2-core CI runners than locally.
    testTimeout: 60_000,
  },
})
