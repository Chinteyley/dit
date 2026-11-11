import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import * as barrel from './index';
import * as support from './test-support';

const folder = dirname(fileURLToPath(import.meta.url));
const moduleFiles = readdirSync(folder).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));
/** Engine code: everything except the tests and their fast-check helpers. */
const engineFiles = moduleFiles.filter((name) => name !== 'test-support.ts');

/** Clock, randomness, storage, DOM and browser globals (Req 15.2). globalThis would bypass the list. */
const BANNED_GLOBALS = new Set([
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
]);

function parse(name: string): ts.SourceFile {
  return ts.createSourceFile(name, readFileSync(join(folder, name), 'utf8'), ts.ScriptTarget.Latest, true);
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

/** Every module specifier: static imports and re-exports, import() calls, import types and require(). */
function moduleSpecifiers(source: ts.SourceFile): string[] {
  const specifiers: string[] = [];
  walk(source, (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      specifiers.push(ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : '<dynamic>');
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      const [argument] = node.arguments;
      specifiers.push(argument !== undefined && ts.isStringLiteralLike(argument) ? argument.text : '<dynamic>');
    } else if (ts.isImportTypeNode(node)) {
      const { argument } = node;
      specifiers.push(
        ts.isLiteralTypeNode(argument) && ts.isStringLiteral(argument.literal) ? argument.literal.text : '<dynamic>',
      );
    }
  });
  return specifiers;
}

/** Uses of banned globals, ignoring property names such as `state.window`. */
function bannedUses(source: ts.SourceFile): string[] {
  const uses: string[] = [];
  walk(source, (node) => {
    if (ts.isIdentifier(node) && BANNED_GLOBALS.has(node.text)) {
      const { parent } = node;
      const isPropertyName =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isQualifiedName(parent) && parent.right === node);
      if (!isPropertyName) uses.push(node.text);
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'Math' &&
      node.name.text === 'random'
    ) {
      uses.push('Math.random');
    }
    if (
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'Math' &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === 'random'
    ) {
      uses.push('Math.random');
    }
  });
  return uses;
}

describe('module boundaries', () => {
  it('finds the engine modules', () => {
    expect(engineFiles).toEqual(
      expect.arrayContaining([
        'adapt.ts',
        'calibrate.ts',
        'codes.ts',
        'decoder.ts',
        'encode.ts',
        'index.ts',
        'result.ts',
        'timing.ts',
        'types.ts',
      ]),
    );
  });

  it.each(engineFiles)('%s imports only modules inside src/lib/morse', (name) => {
    for (const specifier of moduleSpecifiers(parse(name))) {
      expect(specifier.startsWith('./'), `${name} imports ${specifier}`).toBe(true);
      expect(dirname(resolve(folder, specifier)), `${name} imports ${specifier}`).toBe(folder);
    }
  });

  it.each(moduleFiles)('%s reads no clock, random source, storage or browser global', (name) => {
    expect(bannedUses(parse(name))).toStrictEqual([]);
  });

  it('keeps step, deadlineOf and the test helpers out of the public barrel', () => {
    const index = parse('index.ts');
    expect(moduleSpecifiers(index)).not.toContain('./test-support');
    const exported: string[] = [];
    walk(index, (node) => {
      if (ts.isExportSpecifier(node)) exported.push(node.name.text);
    });
    expect(exported).not.toContain('step');
    expect(exported).not.toContain('deadlineOf');

    const publicNames = Object.keys(barrel);
    expect(publicNames).not.toContain('step');
    expect(publicNames).not.toContain('deadlineOf');
    expect(publicNames.filter((name) => Object.keys(support).includes(name))).toStrictEqual([]);
  });

  it('detects the patterns it bans', () => {
    const sample = ts.createSourceFile(
      'sample.ts',
      "import x from 'react'; const a = Date.now(); const b = Math.random(); const c = globalThis.setTimeout; const d = state.window;",
      ts.ScriptTarget.Latest,
      true,
    );
    expect(moduleSpecifiers(sample)).toStrictEqual(['react']);
    expect(bannedUses(sample)).toStrictEqual(['Date', 'Math.random', 'globalThis']);
  });
});
