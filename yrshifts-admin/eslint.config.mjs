// ── ESLint (flat config) ────────────────────────────────────────────────────
// Deliberately minimal: `no-undef` only — the rule that catches "Can't find
// variable" runtime crashes (undefined imports/identifiers) that Vite builds
// let through. Run:  npm run lint
//
// Growing later: add 'eslint-plugin-react-hooks' for exhaustive-deps, or
// eslint's js.configs.recommended — expect a cleanup pass when you do.
// reportUnusedDisableDirectives is off so existing eslint-disable comments
// for rules not yet enabled stay in place without warnings.

import globals from 'globals'

export default [
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: { 'no-undef': 'error' },
  },
]
