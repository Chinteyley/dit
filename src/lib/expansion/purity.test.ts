/**
 * Static checks for the review checklists of tasks 5.2, 14.3 and 17.1 (Requirements 5.7, 13.10,
 * 14.6 and 15.8): expansion lib code reads no environment, clock, randomness, storage, DOM or
 * global fetch/timers; the data files import nothing; the client never imports on-device.ts; and
 * the barrel exposes no server-only module.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const folder = dirname(fileURLToPath(import.meta.url));

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

const rel = (path: string): string => relative(folder, path).split('\\').join('/');
const moduleFiles = listFiles(folder)
  .filter((path) => path.endsWith('.ts') && !/\.test\.ts$/.test(path))
  .filter((path) => !rel(path).startsWith('test-support/'));

const BANNED = new Set([
  'process',
  'Date',
  'performance',
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'requestAnimationFrame',
  'queueMicrotask',
  'fetch',
  'XMLHttpRequest',
  'navigator',
  'window',
  'document',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'globalThis',
  'self',
  'console',
  'crypto',
]);

function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function inTypePosition(node: ts.Node): boolean {
  for (let current = node.parent; current !== undefined; current = current.parent) {
    if (ts.isTypeNode(current)) return true;
  }
  return false;
}

/** True when the identifier is a property or declaration name rather than a reference. */
function isName(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    ((ts.isPropertyAssignment(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isPropertyDeclaration(parent)) &&
      parent.name === node)
  );
}

function bannedUses(source: ts.SourceFile): string[] {
  const found: string[] = [];
  walk(source, (node) => {
    if (ts.isIdentifier(node) && BANNED.has(node.text) && !isName(node) && !inTypePosition(node)) found.push(node.text);
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Math' && node.name.text === 'random') {
      found.push('Math.random');
    }
  });
  return found;
}

function importsOf(source: ts.SourceFile): string[] {
  const specifiers: string[] = [];
  walk(source, (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined) {
      specifiers.push(ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : '<dynamic>');
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) specifiers.push('import()');
  });
  return specifiers;
}

describe('expansion purity', () => {
  it('checks every lib module', () => {
    expect(moduleFiles.map(rel).sort()).toContain('client.ts');
    expect(moduleFiles.length).toBeGreaterThanOrEqual(15);
  });

  it.each(moduleFiles.map(rel))('%s uses no environment, clock, randomness, storage, DOM or global network', (name) => {
    expect(bannedUses(parse(join(folder, name)))).toStrictEqual([]);
  });

  it.each(moduleFiles.map(rel))('%s imports only expansion modules and zod', (name) => {
    for (const specifier of importsOf(parse(join(folder, name)))) {
      expect(specifier === 'zod' || specifier.startsWith('./'), `${name} imports ${specifier}`).toBe(true);
    }
  });

  it('keeps the data files free of imports and dynamic loading', () => {
    for (const name of ['word-freq.ts', 'phrase-bank.ts']) expect(importsOf(parse(join(folder, name)))).toStrictEqual([]);
  });

  it('keeps the client independent of the on-device expander', () => {
    expect(importsOf(parse(join(folder, 'client.ts')))).not.toContain('./on-device');
  });

  it('exports no server-only or test-only module from the barrel', () => {
    const reexports = importsOf(parse(join(folder, 'index.ts')));
    for (const banned of ['./handler', './provider', './prompt', './filter', './rate-limit']) expect(reexports).not.toContain(banned);
    expect(reexports.some((specifier) => specifier.includes('test-support'))).toBe(false);
  });
});
