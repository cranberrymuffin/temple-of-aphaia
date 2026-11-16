import js from '@eslint/js'
import tseslint from 'typescript-eslint'

const threeBan = {
  paths: [{ name: 'three', message: 'src/geometry and src/data must stay pure (Worker/Node). Build three objects in src/app/build-scene.ts.' }],
  patterns: [{ group: ['three/*'], message: 'src/geometry and src/data must stay pure (Worker/Node).' }],
}

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'public/**', 'scan/**', 'tools/measure/.venv/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/geometry/**/*.ts', 'src/data/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', threeBan] },
  },
)
