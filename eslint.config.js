import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import prettier from 'eslint-config-prettier/flat'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'public', 'test-results', 'playwright-report']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      // Accessibility: flags missing alt text, unlabeled inputs, etc.
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // A labeled region that scrolls sideways (a wide table) must be focusable so
      // keyboard users can scroll it (WCAG 2.1.1). The default allows only tabpanel.
      'jsx-a11y/no-noninteractive-tabindex': ['error', { roles: ['tabpanel', 'region'] }],
    },
  },
  // Security: block the usual ways text turns into running code, and keep secrets out of
  // places other scripts or extensions can read. See docs/security.md.
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'Render user and AI text as plain text. See docs/security.md.',
        },
        {
          selector:
            'AssignmentExpression > MemberExpression.left[property.name=/^(innerHTML|outerHTML)$/]',
          message: 'Use textContent. Setting HTML from strings can run injected code.',
        },
      ],
      'no-restricted-properties': [
        'error',
        { property: 'insertAdjacentHTML', message: 'Use textContent or DOM nodes.' },
        { object: 'document', property: 'write', message: 'Use DOM nodes.' },
        { property: 'createContextualFragment', message: 'Parses HTML strings; use DOM nodes.' },
      ],
      'no-restricted-globals': [
        'error',
        {
          name: 'localStorage',
          message:
            'Store data in IndexedDB (src/data). localStorage is readable by any script on the page; ' +
            'for a harmless UI preference, add an eslint-disable comment saying why.',
        },
        { name: 'sessionStorage', message: 'Same rule as localStorage.' },
      ],
    },
  },
  {
    // Hostile test strings are meant to look dangerous, and tests may inspect web storage.
    files: ['src/security/**', '**/*.test.{ts,tsx}'],
    rules: { 'no-script-url': 'off', 'no-restricted-globals': 'off' },
  },
  // Must stay last: turns off ESLint rules that would fight Prettier's formatting.
  prettier,
])
