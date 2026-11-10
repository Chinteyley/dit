import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const folder = dirname(fileURLToPath(import.meta.url));
const hookFile = join(folder, '..', '..', 'hooks', 'useInputSources.ts');

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

const rel = (path: string): string => relative(folder, path).split('\\').join('/');
const isTest = (path: string): boolean => /\.test\.tsx?$/.test(path);
const moduleFiles = listFiles(folder).filter((path) => path.endsWith('.ts') && !isTest(path));

/** The modules Req 11.1 keeps free of clocks, timers, randomness and the DOM. */
const PURE = ['debounce.ts', 'arbiter.ts', 'focus.ts', 'key-machine.ts', 'blink/detector.ts'];
/** The only modules allowed to read browser globals. */
const ADAPTERS = ['browser.ts', 'blink/browser.ts'];

/** Req 11.1 identifiers, globalThis (which would bypass the list) and the DOM types. */
const BANNED = new Set([
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
  'globalThis',
  'self',
  'localStorage',
  'Element',
  'HTMLElement',
  'HTMLInputElement',
  'HTMLVideoElement',
  'Node',
  'Event',
  'EventTarget',
  'KeyboardEvent',
  'PointerEvent',
  'MouseEvent',
  'MediaStream',
  'MediaStreamTrack',
  'Document',
  'Window',
]);

function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

interface ImportUse {
  readonly specifier: string;
  readonly typeOnly: boolean;
  readonly dynamic: boolean;
}

function importsOf(source: ts.SourceFile): ImportUse[] {
  const uses: ImportUse[] = [];
  walk(source, (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      const specifier = ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : '<dynamic>';
      const typeOnly = ts.isImportDeclaration(node)
        ? node.importClause?.isTypeOnly === true ||
          (node.importClause !== undefined &&
            node.importClause.name === undefined &&
            node.importClause.namedBindings !== undefined &&
            ts.isNamedImports(node.importClause.namedBindings) &&
            node.importClause.namedBindings.elements.length > 0 &&
            node.importClause.namedBindings.elements.every((element) => element.isTypeOnly))
        : node.isTypeOnly;
      uses.push({ specifier, typeOnly, dynamic: false });
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments;
      const specifier = argument !== undefined && ts.isStringLiteralLike(argument) ? argument.text : '<dynamic>';
      uses.push({ specifier, typeOnly: false, dynamic: true });
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require') {
      uses.push({ specifier: '<require>', typeOnly: false, dynamic: true });
    } else if (ts.isImportTypeNode(node)) {
      const { argument } = node;
      const specifier =
        ts.isLiteralTypeNode(argument) && ts.isStringLiteral(argument.literal) ? argument.literal.text : '<dynamic>';
      uses.push({ specifier, typeOnly: true, dynamic: false });
    }
  });
  return uses;
}

/** Uses of banned identifiers, ignoring property names such as `state.window` and object keys. */
function bannedUses(source: ts.SourceFile): string[] {
  const uses: string[] = [];
  walk(source, (node) => {
    if (ts.isIdentifier(node) && BANNED.has(node.text)) {
      const { parent } = node;
      const isPropertyName =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isQualifiedName(parent) && parent.right === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        (ts.isPropertySignature(parent) && parent.name === node) ||
        (ts.isMethodSignature(parent) && parent.name === node);
      if (!isPropertyName) uses.push(node.text);
    }
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Math' && node.name.text === 'random') {
      uses.push('Math.random');
    }
  });
  return uses;
}

/** console.* and fetch references (Req 9.6, 11.7). */
function loggingOrNetwork(source: ts.SourceFile): string[] {
  const uses: string[] = [];
  walk(source, (node) => {
    if (ts.isIdentifier(node) && (node.text === 'console' || node.text === 'fetch')) {
      const { parent } = node;
      const isPropertyName = ts.isPropertyAccessExpression(parent) && parent.name === node;
      if (!isPropertyName) uses.push(node.text);
    }
    if (ts.isPropertyAccessExpression(node) && (node.name.text === 'fetch' || node.name.text === 'sendBeacon')) {
      uses.push(`.${node.name.text}`);
    }
  });
  return uses;
}

describe('input layer purity', () => {
  it('finds every module', () => {
    expect(moduleFiles.map(rel)).toEqual(
      expect.arrayContaining([...PURE, ...ADAPTERS, 'blink/source.ts', 'index.ts', 'keyboard.ts', 'pointer.ts', 'switch.ts']),
    );
  });

  it.each(PURE)('%s imports only the input types, its pure neighbours and the morse Result type', (name) => {
    for (const use of importsOf(parse(join(folder, name)))) {
      const allowed =
        (use.specifier === '@/lib/morse' && use.typeOnly) ||
        (use.specifier.startsWith('.') && !use.dynamic && !/(^|\/)browser$/.test(use.specifier));
      expect(allowed, `${name} imports ${use.specifier}`).toBe(true);
    }
  });

  it.each(moduleFiles.filter((path) => !ADAPTERS.includes(rel(path)) && rel(path) !== 'test-support.ts').map(rel))(
    '%s reads no clock, timer, random source or browser global',
    (name) => {
      expect(bannedUses(parse(join(folder, name)))).toStrictEqual([]);
    },
  );

  it.each(moduleFiles.filter((path) => !ADAPTERS.includes(rel(path))).map(rel))(
    '%s imports no browser adapter, React, Next.js, components or hooks',
    (name) => {
      for (const use of importsOf(parse(join(folder, name)))) {
        const forbidden =
          /(^|\/)browser$/.test(use.specifier) ||
          /^(react|next)(\/|$)/.test(use.specifier) ||
          use.specifier.startsWith('@/components') ||
          use.specifier.startsWith('@/hooks');
        expect(forbidden, `${name} imports ${use.specifier}`).toBe(false);
      }
    },
  );

  it.each([...moduleFiles.map(rel), '../../hooks/useInputSources.ts'])('%s neither logs nor calls fetch', (name) => {
    expect(loggingOrNetwork(parse(join(folder, name)))).toStrictEqual([]);
  });

  it('loads @mediapipe/tasks-vision at runtime only from blink/browser.ts, through import()', () => {
    for (const path of [...moduleFiles, hookFile]) {
      for (const use of importsOf(parse(path))) {
        if (use.specifier !== '@mediapipe/tasks-vision') continue;
        if (rel(path) === 'blink/browser.ts') {
          expect(use.typeOnly || use.dynamic, 'blink/browser.ts imports MediaPipe statically').toBe(true);
        } else {
          expect(use.typeOnly, `${rel(path)} imports MediaPipe at runtime`).toBe(true);
        }
      }
    }
    const runtime = importsOf(parse(join(folder, 'blink/browser.ts'))).filter(
      (use) => use.specifier === '@mediapipe/tasks-vision' && use.dynamic,
    );
    expect(runtime).toHaveLength(1);
  });

  it('keeps the browser adapters and test helpers out of the barrel', () => {
    const specifiers = importsOf(parse(join(folder, 'index.ts'))).map((use) => use.specifier);
    expect(specifiers).not.toContain('./browser');
    expect(specifiers).not.toContain('./blink/browser');
    expect(specifiers).not.toContain('./test-support');
  });

  it('detects the patterns it bans', () => {
    const sample = ts.createSourceFile(
      'sample.ts',
      "import x from 'react'; import type { Y } from '@mediapipe/tasks-vision'; const a = Date.now(); const b = Math.random(); " +
        "const c = globalThis.setTimeout; const d = state.window; console.log(a); void import('@mediapipe/tasks-vision'); let e: HTMLElement;",
      ts.ScriptTarget.Latest,
      true,
    );
    expect(importsOf(sample)).toStrictEqual([
      { specifier: 'react', typeOnly: false, dynamic: false },
      { specifier: '@mediapipe/tasks-vision', typeOnly: true, dynamic: false },
      { specifier: '@mediapipe/tasks-vision', typeOnly: false, dynamic: true },
    ]);
    expect(bannedUses(sample)).toStrictEqual(['Date', 'Math.random', 'globalThis', 'HTMLElement']);
    expect(loggingOrNetwork(sample)).toStrictEqual(['console']);
  });
});
