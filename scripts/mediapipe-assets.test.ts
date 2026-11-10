import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MEDIAPIPE_VERSION,
  MODEL_FILE,
  MODEL_SHA256,
  MODEL_URL,
  WASM_FILES,
  prepareMediapipeAssets,
  publicAssetDir,
  sha256,
} from './mediapipe-assets';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
/** The committed model; the only way to get bytes with the pinned hash without a network. */
const realModelPath = join(repoRoot, 'public', 'mediapipe', MEDIAPIPE_VERSION, MODEL_FILE);

let root = '';

/** A fake install: node_modules/@mediapipe/tasks-vision with the given version and wasm files. */
function fakePackage(version: string, files: readonly string[] = [
  ...WASM_FILES,
  'vision_wasm_module_internal.js',
  'vision_wasm_module_internal.wasm',
]): void {
  const packageDir = join(root, 'node_modules', '@mediapipe', 'tasks-vision');
  mkdirSync(join(packageDir, 'wasm'), { recursive: true });
  writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name: '@mediapipe/tasks-vision', version }));
  for (const name of files) {
    writeFileSync(join(packageDir, 'wasm', name), `contents of ${name}`);
  }
}

function writeModel(bytes: Uint8Array | string): void {
  mkdirSync(publicAssetDir(root), { recursive: true });
  writeFileSync(join(publicAssetDir(root), MODEL_FILE), bytes);
}

beforeEach(() => {
  // Scratch space lives in the gitignored .tmp/ inside the repository, never in the OS temp dir.
  mkdirSync(join(repoRoot, '.tmp'), { recursive: true });
  root = mkdtempSync(join(repoRoot, '.tmp', 'mediapipe-assets-'));
  vi.stubGlobal('fetch', () => {
    throw new Error('network access is disabled in tests');
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(root, { recursive: true, force: true });
});

describe('prepareMediapipeAssets', () => {
  it('fails clearly when the installed version is not the pinned one, and copies nothing', async () => {
    fakePackage('1.2.1');
    writeModel(readFileSync(realModelPath));

    const result = await prepareMediapipeAssets({ root });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('1.2.1');
    expect(result.error).toContain(MEDIAPIPE_VERSION);
    expect(existsSync(join(publicAssetDir(root), 'wasm'))).toBe(false);
  });

  it('fails when the package is not installed', async () => {
    const result = await prepareMediapipeAssets({ root });
    expect(result).toStrictEqual({ ok: false, error: expect.stringContaining('not installed') });
  });

  it('fails when the model does not match the pinned SHA-256', async () => {
    fakePackage(MEDIAPIPE_VERSION);
    writeModel('not the model');

    const result = await prepareMediapipeAssets({ root });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('SHA-256');
    expect(result.error).toContain(MODEL_SHA256);
  });

  it('copies only the two WebAssembly files into public/mediapipe/1.2.2/wasm/', async () => {
    fakePackage(MEDIAPIPE_VERSION);
    writeModel(readFileSync(realModelPath));

    const result = await prepareMediapipeAssets({ root });

    const wasmDir = join(root, 'public', 'mediapipe', '1.2.2', 'wasm');
    expect(result).toStrictEqual({
      ok: true,
      value: { copied: WASM_FILES.map((name) => join(wasmDir, name)), model: 'verified' },
    });
    expect(readdirSync(wasmDir).sort()).toStrictEqual([...WASM_FILES].sort());
    for (const name of WASM_FILES) {
      expect(readFileSync(join(wasmDir, name), 'utf8')).toBe(`contents of ${name}`);
    }
  });

  it('fails when a WebAssembly file is missing from the package', async () => {
    fakePackage(MEDIAPIPE_VERSION, ['vision_wasm_internal.js']);
    writeModel(readFileSync(realModelPath));

    const result = await prepareMediapipeAssets({ root });
    expect(result).toStrictEqual({ ok: false, error: expect.stringContaining('vision_wasm_internal.wasm') });
  });

  it('asks for --fetch-model when the model is missing', async () => {
    fakePackage(MEDIAPIPE_VERSION);
    const download = vi.fn(async () => new Uint8Array());

    const result = await prepareMediapipeAssets({ root, download });

    expect(result).toStrictEqual({ ok: false, error: expect.stringContaining('--fetch-model') });
    expect(download).not.toHaveBeenCalled();
  });

  it('downloads a missing model from the pinned URL, verifies it and writes it', async () => {
    fakePackage(MEDIAPIPE_VERSION);
    const bytes = new Uint8Array(readFileSync(realModelPath));
    const download = vi.fn(async () => bytes);

    const result = await prepareMediapipeAssets({ root, fetchModel: true, download });

    expect(download).toHaveBeenCalledExactlyOnceWith(MODEL_URL);
    expect(result.ok && result.value.model).toBe('downloaded');
    expect(sha256(readFileSync(join(publicAssetDir(root), MODEL_FILE)))).toBe(MODEL_SHA256);
  });

  it('rejects a downloaded model with the wrong hash without writing it', async () => {
    fakePackage(MEDIAPIPE_VERSION);
    const download = vi.fn(async () => new TextEncoder().encode('tampered'));

    const result = await prepareMediapipeAssets({ root, fetchModel: true, download });

    expect(result).toStrictEqual({ ok: false, error: expect.stringContaining('SHA-256') });
    expect(existsSync(join(publicAssetDir(root), MODEL_FILE))).toBe(false);
  });

  it('reports a failed download', async () => {
    fakePackage(MEDIAPIPE_VERSION);
    const download = vi.fn(async (): Promise<Uint8Array> => {
      throw new Error('HTTP 503');
    });

    const result = await prepareMediapipeAssets({ root, fetchModel: true, download });

    expect(result).toStrictEqual({ ok: false, error: expect.stringContaining('HTTP 503') });
  });

  it('pins the committed model', () => {
    const bytes = readFileSync(realModelPath);
    expect(bytes.byteLength).toBe(3_758_596);
    expect(sha256(bytes)).toBe(MODEL_SHA256);
  });
});
