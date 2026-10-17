import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

// CLAUDE.md §1: the codebase must never contain HTML/JS execution sinks.
const HTML_SINK = 'Raw HTML/JS sinks are banned (CLAUDE.md §1). Render through the A2UI Trusted Catalog.'

const bannedSinks = {
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
  'no-restricted-properties': [
    'error',
    { object: 'document', property: 'write', message: HTML_SINK },
    { object: 'document', property: 'writeln', message: HTML_SINK },
  ],
  'no-restricted-syntax': [
    'error',
    { selector: "AssignmentExpression > MemberExpression.left[property.name=/^(inner|outer)HTML$/]", message: HTML_SINK },
    { selector: "CallExpression[callee.property.name='insertAdjacentHTML']", message: HTML_SINK },
    { selector: "CallExpression[callee.property.name='createContextualFragment']", message: HTML_SINK },
    { selector: "CallExpression[callee.property.name='setHTMLUnsafe']", message: HTML_SINK },
    { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: HTML_SINK },
  ],
}

// CLAUDE.md §3: LiteRT.js is reached only through the audited adapter.
const LITERT_ADAPTER = 'src/inference/litert-adapter.ts'
const liteRtBoundary = {
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        {
          group: ['@litertjs/*'],
          message: `Import LiteRT.js only in ${LITERT_ADAPTER}; use the LiteRtPort types elsewhere (CLAUDE.md §3).`,
        },
      ],
    },
  ],
}

export default defineConfig([
  globalIgnores(['dist', 'coverage', 'playwright-report', 'test-results']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.browser, ...globals.node },
    },
    rules: { ...bannedSinks, ...liteRtBoundary },
  },
  {
    files: [LITERT_ADAPTER],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: ['**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
    rules: bannedSinks,
  },
])
