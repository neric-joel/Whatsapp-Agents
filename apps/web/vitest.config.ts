import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      // Scope coverage to unit-testable business logic. API routes are exercised
      // by Playwright e2e (Phase 3), and thin Supabase client factories / barrel
      // files have no logic worth unit-covering.
      include: ['lib/**/*.ts'],
      exclude: ['lib/**/__tests__/**', 'lib/supabase/**', 'lib/**/*.d.ts'],
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
