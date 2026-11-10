import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

/**
 * src/lib/** is framework-free (structure.md; morse-engine Req 15.6, input-sources Req 11.1,
 * conversation-ui Req 7.6): no React, no Next.js, nothing from src/components or src/hooks.
 * The typescript-eslint version of the rule is used so a path can allow type-only imports.
 */
const LIB_IMPORT_PATTERNS = [
  {
    regex: '^(react|react-dom|next)(/.*)?$',
    message: 'src/lib is framework-free: do not import React or Next.js here.',
  },
  {
    regex: '^(@/(components|hooks)|(\\.\\./)+(components|hooks))(/.*)?$',
    message: 'src/lib must not import from src/components or src/hooks.',
  },
];

/** Adapter modules the pure input modules must not reach (input-sources Req 11.1). */
const INPUT_ADAPTER_PATTERNS = [
  {
    regex: '^(\\./|\\.\\./|@/lib/input/)(blink/)?browser$',
    message: 'Pure input modules must not import a browser adapter.',
  },
];

/** morse-engine Req 15.2: no clock, random source, storage, DOM or browser global. */
const MORSE_GLOBALS = [
  'Date',
  'performance',
  'setTimeout',
  'setInterval',
  'crypto',
  'window',
  'document',
  'localStorage',
  'navigator',
  'globalThis',
];

/** input-sources Req 11.1 for the Input_Arbiter, Debouncer, focus classification, KeyMachine and Blink_Detector. */
const PURE_INPUT_GLOBALS = [
  'Date',
  'performance',
  'setTimeout',
  'setInterval',
  'requestAnimationFrame',
  'queueMicrotask',
  'crypto',
  'window',
  'document',
  'navigator',
  'localStorage',
  'globalThis',
  'self',
];

/** conversation-ui Req 7.1: the session core reads no clock, timer, storage, DOM or network. */
const CONVERSATION_GLOBALS = [
  'window',
  'document',
  'localStorage',
  'sessionStorage',
  'navigator',
  'performance',
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'requestAnimationFrame',
  'queueMicrotask',
  'fetch',
  'XMLHttpRequest',
  'crypto',
  'globalThis',
  'self',
];

const CLOCK_AND_RANDOM = [
  { object: 'Date', property: 'now', message: 'Pass time in; do not read the clock here.' },
  { object: 'Math', property: 'random', message: 'Inject randomness; do not read Math.random here.' },
];

const restrictedGlobals = (names, why) => names.map((name) => ({ name, message: why }));

const TEST_FILES = ['**/*.test.ts', '**/*.test.tsx'];

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    name: 'dit/lib-boundaries',
    files: ['src/lib/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', { patterns: LIB_IMPORT_PATTERNS }],
    },
  },
  {
    name: 'dit/morse-purity',
    files: ['src/lib/morse/**/*.ts'],
    ignores: TEST_FILES,
    rules: {
      'no-restricted-globals': [
        'error',
        ...restrictedGlobals(MORSE_GLOBALS, 'The Morse engine is deterministic: time and storage are passed in.'),
      ],
      'no-restricted-properties': ['error', ...CLOCK_AND_RANDOM],
    },
  },
  {
    name: 'dit/input-purity',
    files: [
      'src/lib/input/debounce.ts',
      'src/lib/input/arbiter.ts',
      'src/lib/input/focus.ts',
      'src/lib/input/key-machine.ts',
      'src/lib/input/blink/detector.ts',
    ],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { patterns: [...LIB_IMPORT_PATTERNS, ...INPUT_ADAPTER_PATTERNS] },
      ],
      'no-restricted-globals': [
        'error',
        ...restrictedGlobals(PURE_INPUT_GLOBALS, 'Pure input modules take time from the Clock passed in.'),
      ],
      'no-restricted-properties': ['error', ...CLOCK_AND_RANDOM],
    },
  },
  {
    name: 'dit/expansion-data',
    files: ['src/lib/expansion/word-freq.ts', 'src/lib/expansion/phrase-bank.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: 'ImportExpression', message: 'Data files are plain constants: no dynamic import().' },
        { selector: 'Identifier[name="fetch"]', message: 'Data files are plain constants: no fetch.' },
      ],
    },
  },
  {
    name: 'dit/conversation-imports',
    files: ['src/lib/conversation/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/lib/expansion/client',
              allowTypeImports: true,
              message: 'The session core may only use types from the expansion client.',
            },
          ],
          patterns: LIB_IMPORT_PATTERNS,
        },
      ],
    },
  },
  {
    name: 'dit/conversation-purity',
    files: ['src/lib/conversation/**/*.ts', 'src/lib/speech/listen.ts'],
    ignores: ['src/lib/conversation/browser.ts', ...TEST_FILES],
    rules: {
      'no-restricted-globals': [
        'error',
        ...restrictedGlobals(CONVERSATION_GLOBALS, 'The session core is pure: browser access lives in browser.ts.'),
      ],
      'no-restricted-properties': ['error', ...CLOCK_AND_RANDOM],
    },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'public/mediapipe/**',
    '.tmp/**',
    '.agents/**',
  ]),
]);
