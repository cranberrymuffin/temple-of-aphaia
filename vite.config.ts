/// <reference types="vitest/config" />
import { defineConfig } from 'vite'

// BASE_PATH: "/" for Vercel (default), "/temple-of-aphaia/" for GitHub Pages.
const base = process.env.BASE_PATH ?? '/'

export default defineConfig({
  base,
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
})
