/**
 * The design-token contrast check (conversation-ui tasks 14.2 and 17.1): parses the @theme blocks
 * of globals.css, computes WCAG relative luminance and contrast, and asserts every row of the
 * design's contrast table (design.md "Contrast pairs"), the page background luminance (at most
 * 0.05), the Partner_Display text luminance (at least 0.85), the Suggestion_Card text floors, the
 * Stream_Unit budget and the Letter_Trail's clip fade. Requirements 10.5, 10.6, 11.8, 13.8, 14.4,
 * 14.8, 22.1 to 22.3, 25.1, 25.2, 25.6, 25.7, 26.2 to 26.5, 27.5 and 27.6.
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
  { use: 'Press_Indicator idle ring (2 px)', fg: 'border', on: [['surface', 4.6]], needed: 3 },
  { use: 'Press_Indicator pressed ring and centre disc', fg: 'accent', on: [['surface', 9.31]], needed: 3 },
  { use: 'Keying_Surface Armed_Edge (2 px, on focus)', fg: 'text', on: [['bg', 18.13], ['surface', 16.27]], needed: 3 },
  { use: 'Armed_Edge against the unfocused boundary', fg: 'text', on: [['border', 3.53]], needed: 3 },
  {
    use: 'Focus ring (offset 4 px, sits on page or panel)',
    fg: 'focus',
    on: [['bg', 13.49], ['surface', 12.11], ['raised', 10.29]],
    needed: 3,
  },
  { use: 'Suggestion_Card text', fg: 'text', on: [['raised', 13.82], ['selected', 11.47]], needed: 7 },
  {
    use: 'Highlight ring, accent Ordinal disc and "Will be spoken"',
    fg: 'accent',
    on: [['selected', 6.56], ['bg', 10.37]],
    needed: 4.5,
  },
  { use: 'Ordinal number on the accent disc', fg: 'on-accent', on: [['accent', 10.37]], needed: 4.5 },
  { use: 'Ordinal number on the other cards', fg: 'text', on: [['raised', 13.82]], needed: 4.5 },
  { use: 'Symbol shapes', fg: 'text', on: [['surface', 16.27]], needed: 3 },
  {
    use: 'Newest symbol and accent marks (typed-text mark, logo dot)',
    fg: 'accent',
    on: [['surface', 9.31], ['bg', 10.37]],
    needed: 3,
  },
  { use: 'Switch knob on the accent track', fg: 'on-accent', on: [['accent', 10.37]], needed: 3 },
  { use: 'Destructive button text ("Clear history" confirm)', fg: 'error', on: [['raised', 7.25]], needed: 4.5 },
];

/** onboarding-and-safety design.md "Contrast pairs" (task 16.2): the Alarm_Card, legend, sheet and setup. */
const SAFETY_CONTRAST_TABLE: readonly Row[] = [
  { use: '"I need help", sound note and description on the alarm', fg: 'text', on: [['alarm', 12.97]], needed: 7 },
  { use: 'Dismiss button boundary (text-coloured fill) on the alarm', fg: 'text', on: [['alarm', 12.97]], needed: 3 },
  { use: 'Dismiss label on its fill', fg: 'on-accent', on: [['text', 18.13]], needed: 4.5 },
  { use: 'Focus ring on the alarm card', fg: 'focus', on: [['alarm', 9.65]], needed: 3 },
  { use: 'Glyphs (legend, sheet, practice)', fg: 'text', on: [['surface', 16.27], ['bg', 18.13]], needed: 3 },
  { use: 'Legend, sheet and onboarding body text', fg: 'text', on: [['surface', 16.27], ['bg', 18.13]], needed: 4.5 },
  { use: 'Muted hints (count, held indicator)', fg: 'muted', on: [['surface', 8.07]], needed: 4.5 },
  { use: 'Control boundaries on panels', fg: 'border', on: [['surface', 4.6]], needed: 3 },
  { use: 'Focus ring on panels', fg: 'focus', on: [['surface', 12.11]], needed: 3 },
];

describe('design tokens in globals.css', () => {
  it('defines every design token in @theme', () => {
    for (const name of [
      '--color-bg',
      '--color-surface',
      '--color-raised',
      '--color-partner',
      '--color-selected',
      '--color-text',
      '--color-muted',
      '--color-border',
      '--color-accent',
      '--color-on-accent',
      '--color-focus',
      '--color-error',
      '--color-alarm',
      '--font-sans',
      '--text-base',
      '--text-display',
      '--text-last',
      '--text-suggestion',
      '--size-target',
      '--ring-width',
      '--ring-offset',
      '--outline-highlight',
      '--duration-fade',
      '--sym-u-max',
      '--sym-press-min',
    ]) {
      expect(theme, name).toMatch(new RegExp(`${name}\\s*:`));
    }
  });

  it('keeps the sizes the requirements set as minimums', () => {
    expect(theme).toMatch(/--text-base:\s*1\.125rem;/); // 18 px body text (Req 22.5)
    expect(theme).toMatch(/--size-target:\s*2\.75rem;/); // 44 px targets (Req 22.6)
    expect(theme).toMatch(/--ring-width:\s*3px;/); // at least 2 px (Req 22.6)
    expect(theme).toMatch(/--outline-highlight:\s*3px;/); // at least 3 px (Req 13.2, 27.5)
    // Partner_Display floors: 32 px and 24 px below 768 px; 48 px and 32 px from 768 px (Req 14.2, 14.3).
    expect(theme).toMatch(/--text-display:\s*clamp\(2rem,/);
    expect(theme).toMatch(/--text-last:\s*clamp\(1\.5rem,/);
    expect(css).toMatch(/@media \(min-width: 48rem\)\s*\{\s*:root\s*\{[^}]*--text-display:\s*clamp\(3rem,[^}]*--text-last:\s*clamp\(2rem,/);
  });

  it('sets the Suggestion_Card text floors: 1.25rem, and 1.5rem from 768 px (Req 27.6)', () => {
    expect(theme).toMatch(/--text-suggestion:\s*clamp\(1\.25rem,\s*0\.75rem \+ 1\.5vw,\s*2rem\);/);
    expect(theme).toMatch(/--text-suggestion--line-height:\s*1\.25;/);
    expect(css).toMatch(/@media \(min-width: 48rem\)\s*\{\s*:root\s*\{[^}]*--text-suggestion:\s*clamp\(1\.5rem,\s*0\.75rem \+ 1\.5vw,\s*2rem\);/);
  });

  it('sizes the Stream_Unit with a 28-unit base and a span that reserves the Press_Indicator (Req 25.3, 26.2, 26.3)', () => {
    expect(theme).toMatch(/--sym-u-max:\s*1\.5rem;/);
    expect(theme).toMatch(/--sym-press-min:\s*1rem;/);
    const morseScale = css.match(/@utility morse-scale\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(morseScale).toMatch(/container-type:\s*inline-size;/);
    expect(morseScale).toMatch(/--sym-u-base:\s*min\(var\(--sym-u-max\),\s*calc\(100cqi \/ 28\)\);/);
    expect(morseScale).toMatch(
      /--sym-u:\s*min\(var\(--sym-u-base\),\s*calc\(\(100cqi - var\(--sym-press-min\)\) \/ var\(--stream-span, 2\)\)\);/,
    );
  });

  it('has no pressed border or pressed fill token, because a press changes only the Press_Indicator (Req 10.5, 25.5)', () => {
    expect(css).not.toMatch(/--border-pressed/);
  });

  it('fades the Letter_Trail out across the Composer_Panel padding, and changes nothing without it (Req 26.5)', () => {
    const bleed = css.match(/@utility trail-bleed\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(bleed).toMatch(/margin-left:\s*calc\(var\(--stage-pad, 0px\) \* -1\);/);
    expect(bleed).toMatch(/padding-left:\s*var\(--stage-pad, 0px\);/);
    expect(bleed).toMatch(/mask-image:\s*linear-gradient\(to right, transparent, black var\(--stage-pad, 0px\)\);/);
  });

  it('has a dark page and near-white partner text (Req 22.1)', () => {
    expect(luminance(hex('bg'))).toBeLessThanOrEqual(0.05);
    expect(luminance(hex('text'))).toBeGreaterThanOrEqual(0.85);
  });

  it('has a Selected_Fill that reads lighter than the card fill (Req 27.5)', () => {
    expect(luminance(hex('selected'))).toBeCloseTo(0.0353, 4);
    expect(luminance(hex('selected'))).toBeGreaterThan(luminance(hex('raised')));
  });

  it('has a dark alarm background (onboarding-and-safety Req 1.7)', () => {
    expect(luminance(hex('alarm'))).toBeCloseTo(0.0254, 4);
  });

  for (const row of [...CONTRAST_TABLE, ...SAFETY_CONTRAST_TABLE]) {
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
