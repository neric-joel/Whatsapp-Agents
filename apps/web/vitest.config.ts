import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  // tsconfig.json sets `"jsx": "preserve"` because Next owns the JSX transform in the
  // real build. Vite/oxc honours that here too, so without this every `.tsx` import
  // dies in vite:import-analysis with "content contains invalid JS syntax ... make sure
  // to not set jsx to preserve" — i.e. no component was importable by any test at all.
  // Transform-only; it does not touch the Next build, and `environment` below stays
  // 'node' for the whole suite. Because it restates a decision that otherwise lives only
  // in tsconfig.json and Next's own transform, `runtime`/`importSource` have to be kept
  // in sync with those — if Next's importSource ever changes, tests would silently
  // compile JSX differently from the shipped build.
  oxc: {
    jsx: { runtime: 'automatic', importSource: 'react' },
  },
  test: {
    // Node for the whole suite — every other test file here is pure logic and depends
    // on it. Component tests opt into a DOM per-file with the
    // `// @vitest-environment jsdom` docblock pragma instead of flipping this.
    environment: 'node',
    coverage: {
      provider: 'v8',
      // Scope coverage to unit-testable business logic. API routes are exercised
      // by Playwright e2e; barrel files have no logic worth unit-covering.
      include: ['lib/**/*.ts'],
      exclude: ['lib/**/__tests__/**', 'lib/**/*.d.ts'],
      reporter: ['text-summary', 'html'],
      // Realistic floor on the risk-area logic (baseline ~85% lines). Ratchet up
      // as coverage grows; CI fails if it regresses below these.
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 70,
        branches: 70,
      },
    },
  },
})
