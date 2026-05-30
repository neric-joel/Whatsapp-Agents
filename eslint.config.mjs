import js from '@eslint/js'
import next from '@next/eslint-plugin-next'
import prettier from 'eslint-config-prettier'
import react from 'eslint-plugin-react-hooks'
import simpleImportSort from 'eslint-plugin-simple-import-sort'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/build/**',
      'apps/web/next-env.d.ts',
      '**/.worktrees/**',
      '**/.git/**',
      '**/pnpm-lock.yaml',
      '**/.turbo/**',
    ],
  },

  // Base JS + TS for all files
  {
    files: ['**/*.{ts,tsx,js,jsx,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parser: tseslint.parser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
        projectService: false, // Disable type-aware linting for speed
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      'simple-import-sort': simpleImportSort,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tseslint.configs.recommended.rules,

      // Downgrade noisy rules to warn
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/no-require-imports': 'warn',
      'no-empty': 'warn',
      'no-constant-condition': 'warn',
      'no-undef': 'error', // Keep this to catch missing globals

      // Import sorting as warn
      'simple-import-sort/imports': 'warn',
      'simple-import-sort/exports': 'warn',
    },
  },

  // Node environments for bridge, packages/shared, and scripts
  {
    files: [
      'bridge/**/*.{ts,tsx,js,jsx,mjs,cjs}',
      'packages/shared/**/*.{ts,tsx,js,jsx,mjs,cjs}',
      'scripts/**/*.{ts,tsx,js,jsx,mjs,cjs}',
    ],
    languageOptions: {
      globals: {
        ...globals.node,
        NodeJS: 'readonly',
      },
    },
  },

  // Browser + Next.js environment for apps/web
  {
    files: ['apps/web/**/*.{ts,tsx,js,jsx,mjs,cjs}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        React: 'readonly',
        CustomEventInit: 'readonly',
      },
    },
    plugins: {
      'react-hooks': react,
      '@next/next': next,
    },
    rules: {
      ...react.configs.recommended.rules,
      ...next.configs.recommended.rules,
      ...next.configs['core-web-vitals'].rules,

      // Downgrade react-hooks issues to warn since they require code changes
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/set-state-in-effect': 'warn',

      // Next.js specific: Configure path for link checking
      '@next/next/no-html-link-for-pages': [
        'warn',
        "D:\\What's app Agents\\Whatsapp-Agents\\apps\\web\\app",
      ],

      // Warn on custom fonts (not error) - this is expected in App Router
      '@next/next/no-page-custom-font': 'warn',

      // Suppress unused images in <img> (will be fixed later)
      '@next/next/no-img-element': 'warn',
    },
  },

  // Disable formatting rules (prettier handles those)
  prettier,
)
