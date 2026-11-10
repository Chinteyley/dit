/**
 * The design-token contrast check (conversation-ui task 14.2): parses the @theme blocks of
 * globals.css, computes WCAG relative luminance and contrast, and asserts every row of the design's
 * contrast table (design.md "Contrast pairs"), the page background luminance (at most 0.05) and the
 * Partner_Display text luminance (at least 0.85). Requirements 10.5, 10.6, 11.8, 13.8, 14.4, 14.8,
 * 22.1 to 22.3.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(fileURLToPath(new URL('./globals.css', import.meta.url)), 'utf8');

/** The bodies of every `@theme { … }` block (any options), with nested braces matched. */
function themeBlocks(source: string): string[] {
  const blocks: string[] = [];
  const opener = /@theme\b[^{]*\{/g;
  for (let match = opener.exec(source); match !== null; match = opener.exec(source)) {
    let depth = 1;
    let at = opener.lastIndex;
    while (at < source.length && depth > 0) {
      const ch = source[at];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      at += 1;
    }
    blocks.push(source.slice(opener.lastIndex, at - 1));
  }
  return blocks;
}

const theme = themeBlocks(css).join('\n');

function colorTokens(): ReadonlyMap<string, string> {
  const colors = new Map<string, string>();
  for (const match of theme.matchAll(/--color-([a-z-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) colors.set(name, value);
  }
  return colors;
}

const colors = colorTokens();

function hex(name: string): string {
  const value = colors.get(name);
  if (value === undefined) throw new Error(`--color-${name} is not defined in @theme`);
  return value;
}

/** WCAG 2.2 relative luminance of an sRGB colour. */
function luminance(color: string): number {
  const channel = (offset: number): number => {
    const c = Number.parseInt(color.slice(offset, offset + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(hex(a)), luminance(hex(b))].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

interface Row {
  readonly use: string;
  readonly fg: string;
  /** Each background with the ratio the design table states for it. */
  readonly on: readonly (readonly [bg: string, ratio: number])[];
  readonly needed: number;
}

/** design.md "Contrast pairs (WCAG ratio, computed)", row by row. */
const CONTRAST_TABLE: readonly Row[] = [
  { use: 'Partner_Display text', fg: 'text', on: [['bg', 18.13]], needed: 7 },
  { use: 'Body text on panels', fg: 'text', on: [['surface', 16.27]], needed: 4.5 },
  { use: 'Button and speaker-bubble text', fg: 'text', on: [['raised', 13.82]], needed: 4.5 },
  { use: 'Partner-bubble text', fg: 'text', on: [['partner', 14.56]], needed: 4.5 },
  { use: 'Muted text (labels, placeholders, hint, source label)', fg: 'muted', on: [['bg', 8.99]], needed: 4.5 },
  { use: 'Muted text on panels', fg: 'muted', on: [['surface', 8.07]], needed: 4.5 },
  { use: 'Muted text on buttons / bubbles', fg: 'muted', on: [['raised', 6.85], ['partner', 7.22]], needed: 4.5 },
  { use: 'Error text', fg: 'error', on: [['surface', 8.54], ['bg', 9.52]], needed: 4.5 },
  {
    use: 'Control and Keying_Surface boundary',
    fg: 'border',
    on: [['bg', 5.13], ['surface', 4.6], ['raised', 3.91]],
    needed: 3,
  },
  { use: 'Keying pressed fill vs idle fill', fg: 'accent', on: [['raised', 7.91]], needed: 3 },
  { use: 'Keying pressed border (4 px)', fg: 'text', on: [['bg', 18.13]], needed: 3 },
  { use: 'Keying label on pressed fill', fg: 'on-accent', on: [['accent', 10.37]], needed: 4.5 },
  {
    use: 'Focus ring (offset 4 px, sits on page or panel)',
    fg: 'focus',
    on: [['bg', 13.49], ['surface', 12.11], ['raised', 10.29]],
    needed: 3,
  },
  { use: 'Suggestion highlight outline', fg: 'accent', on: [['surface', 9.31], ['raised', 7.91]], needed: 3 },
  { use: 'Symbol shapes', fg: 'text', on: [['surface', 16.27]], needed: 3 },
  { use: 'Accent text ("Will be spoken") and the newest symbol', fg: 'accent', on: [['bg', 10.37], ['surface', 9.31]], needed: 4.5 },
  { use: 'Switch knob on the accent track', fg: 'on-accent', on: [['accent', 10.37]], needed: 3 },
  { use: 'Destructive button text', fg: 'error', on: [['raised', 7.25]], needed: 4.5 },
];

describe('design tokens in globals.css', () => {
  it('defines every design token in @theme', () => {
    for (const name of [
      '--color-bg',
      '--color-surface',
      '--color-raised',
      '--color-partner',
      '--color-text',
      '--color-muted',
      '--color-border',
      '--color-accent',
      '--color-on-accent',
      '--color-focus',
      '--color-error',
      '--font-sans',
      '--text-base',
      '--text-display',
      '--text-last',
      '--size-target',
      '--border-pressed',
      '--ring-width',
      '--ring-offset',
      '--outline-highlight',
      '--duration-fade',
    ]) {
      expect(theme, name).toMatch(new RegExp(`${name}\\s*:`));
    }
  });

  it('keeps the sizes the requirements set as minimums', () => {
    expect(theme).toMatch(/--text-base:\s*1\.125rem;/); // 18 px body text (Req 22.5)
    expect(theme).toMatch(/--size-target:\s*2\.75rem;/); // 44 px targets (Req 22.6)
    expect(theme).toMatch(/--border-pressed:\s*4px;/); // at least 3 px (Req 10.5)
    expect(theme).toMatch(/--ring-width:\s*3px;/); // at least 2 px (Req 10.6, 22.6)
    expect(theme).toMatch(/--outline-highlight:\s*3px;/); // at least 3 px (Req 13.2)
    // Partner_Display floors: 32 px and 24 px below 768 px; 48 px and 32 px from 768 px (Req 14.2, 14.3).
    expect(theme).toMatch(/--text-display:\s*clamp\(2rem,/);
    expect(theme).toMatch(/--text-last:\s*clamp\(1\.5rem,/);
    expect(css).toMatch(/@media \(min-width: 48rem\)\s*\{\s*:root\s*\{[^}]*--text-display:\s*clamp\(3rem,[^}]*--text-last:\s*clamp\(2rem,/);
  });

  it('has a dark page and near-white partner text (Req 22.1)', () => {
    expect(luminance(hex('bg'))).toBeLessThanOrEqual(0.05);
    expect(luminance(hex('text'))).toBeGreaterThanOrEqual(0.85);
  });

  for (const row of CONTRAST_TABLE) {
    it(`meets the contrast table: ${row.use}`, () => {
      for (const [bg, ratio] of row.on) {
        const actual = contrast(row.fg, bg);
        expect(actual, `${row.fg} on ${bg}`).toBeGreaterThanOrEqual(row.needed);
        // The table states the computed ratio to 2 decimals.
        expect(Math.abs(actual - ratio), `${row.fg} on ${bg} is ${actual.toFixed(3)}`).toBeLessThanOrEqual(0.006);
      }
    });
  }

  it('turns off animation and movement under reduced motion (Req 22.10, 22.11)', () => {
    const block = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(block).toMatch(/animation:\s*none\s*!important/);
    expect(block).toMatch(/transition-property:\s*opacity\s*!important/);
    expect(block).toMatch(/transition-duration:\s*0s\s*!important/);
    // The only keyframes settle or fade in once; none repeat, so nothing can flash.
    expect(css).not.toMatch(/infinite/);
  });
});
