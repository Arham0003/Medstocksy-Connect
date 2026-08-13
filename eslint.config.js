import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  {
    // Build output, vendored assets and the separate wa-bot package
    // (it has its own tsconfig + toolchain).
    ignores: ['dist', 'graphify-out', 'node_modules', 'wa-bot', 'scratch'],
  },

  // ── Browser app: src/**
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      // Allow intentionally-unused args/vars when prefixed with _.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // Supabase's generated types force a lot of `as unknown as T` casts;
      // banning `any` outright is the useful half of that rule.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  // Contexts deliberately export a Provider component *and* its consumer hook
  // from one file; ui/ primitives export cva variant helpers alongside the
  // component. Both are intentional here, so the fast-refresh hint is noise.
  {
    files: ['src/contexts/**/*.tsx', 'src/components/ui/**/*.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },

  // ── Vercel serverless functions: api/**  (Node, not browser)
  {
    files: ['api/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
