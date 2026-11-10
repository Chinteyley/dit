/**
 * Copies and verifies the self-hosted MediaPipe assets used by blink input (input-sources design,
 * "Self-hosted MediaPipe assets").
 *
 *   bun scripts/mediapipe-assets.ts                 # postinstall: copy WebAssembly, verify the model
 *   bun run assets:mediapipe -- --fetch-model       # maintainers: download the model when it is missing
 *
 * 1. Copies vision_wasm_internal.js and vision_wasm_internal.wasm from
 *    node_modules/@mediapipe/tasks-vision/wasm/ into public/mediapipe/1.2.2/wasm/ (gitignored).
 *    The vision_wasm_module_internal.* pair is only used by forVisionTasks(base, true) and is not copied.
 * 2. Verifies public/mediapipe/1.2.2/face_landmarker.task (committed) against the pinned SHA-256.
 * 3. Fails with a clear message when the installed package is not 1.2.2 or the hash does not match,
 *    so an upgrade has to change the version, the public path and the hash together.
 *
 * Next.js note: next.config.ts does not exist yet. The spec that adds Next.js must serve
 * `Cache-Control: public, max-age=31536000, immutable` for `/mediapipe/:path*` (the version is in
 * the path, so the files never change under one URL).
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MEDIAPIPE_VERSION = '1.2.2';
export const WASM_FILES = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm'] as const;
export const MODEL_FILE = 'face_landmarker.task';
export const MODEL_SHA256 = '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff';
export const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

export interface AssetOptions {
  /** Repository root that holds node_modules/ and public/. */
  readonly root: string;
  /** Download the model from MODEL_URL when it is missing. */
  readonly fetchModel?: boolean;
  /** Fetches the model bytes. Injected so tests never touch the network. */
  readonly download?: (url: string) => Promise<Uint8Array>;
}

export interface AssetReport {
  readonly copied: readonly string[];
  readonly model: 'verified' | 'downloaded';
}

/** Same shape as the app's Result union; kept local so the install script depends on nothing in src/. */
export type Outcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

export type AssetResult = Outcome<AssetReport>;

/** public/mediapipe/<version>/, relative to the repository root. */
export function publicAssetDir(root: string): string {
  return join(root, 'public', 'mediapipe', MEDIAPIPE_VERSION);
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function installedVersion(packageDir: string): string | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
    if (typeof parsed === 'object' && parsed !== null && 'version' in parsed) {
      const { version } = parsed;
      return typeof version === 'string' ? version : null;
    }
    return null;
  } catch {
    return null;
  }
}

function copyWasm(packageDir: string, targetDir: string): Outcome<readonly string[]> {
  mkdirSync(targetDir, { recursive: true });
  const copied: string[] = [];
  for (const name of WASM_FILES) {
    const source = join(packageDir, 'wasm', name);
    if (!existsSync(source)) {
      return { ok: false, error: `@mediapipe/tasks-vision is missing wasm/${name}; reinstall dependencies.` };
    }
    const target = join(targetDir, name);
    copyFileSync(source, target);
    copied.push(target);
  }
  return { ok: true, value: copied };
}

async function ensureModel(modelPath: string, options: AssetOptions): Promise<Outcome<AssetReport['model']>> {
  if (existsSync(modelPath)) {
    const actual = sha256(readFileSync(modelPath));
    if (actual !== MODEL_SHA256) {
      return {
        ok: false,
        error:
          `${MODEL_FILE} does not match the pinned SHA-256 (expected ${MODEL_SHA256}, found ${actual}). ` +
          'Delete it and run `bun run assets:mediapipe -- --fetch-model`.',
      };
    }
    return { ok: true, value: 'verified' };
  }
  if (options.fetchModel !== true) {
    return {
      ok: false,
      error: `${MODEL_FILE} is missing from public/mediapipe/${MEDIAPIPE_VERSION}/. Run \`bun run assets:mediapipe -- --fetch-model\`.`,
    };
  }
  let bytes: Uint8Array;
  try {
    bytes = await (options.download ?? fetchBytes)(MODEL_URL);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Downloading ${MODEL_URL} failed: ${reason}` };
  }
  const actual = sha256(bytes);
  if (actual !== MODEL_SHA256) {
    return {
      ok: false,
      error: `The downloaded ${MODEL_FILE} does not match the pinned SHA-256 (expected ${MODEL_SHA256}, found ${actual}).`,
    };
  }
  // Verified in memory first, so a bad download never lands in public/.
  writeFileSync(modelPath, bytes);
  return { ok: true, value: 'downloaded' };
}

/** Checks the installed version, copies the WebAssembly pair and verifies (or fetches) the model. */
export async function prepareMediapipeAssets(options: AssetOptions): Promise<AssetResult> {
  const packageDir = join(options.root, 'node_modules', '@mediapipe', 'tasks-vision');
  const version = installedVersion(packageDir);
  if (version === null) {
    return { ok: false, error: '@mediapipe/tasks-vision is not installed; run `bun install`.' };
  }
  if (version !== MEDIAPIPE_VERSION) {
    return {
      ok: false,
      error:
        `@mediapipe/tasks-vision ${version} is installed, but Dit pins ${MEDIAPIPE_VERSION}. ` +
        'Update the version, the public/mediapipe/<version>/ path and the model hash in scripts/mediapipe-assets.ts together.',
    };
  }

  const assetDir = publicAssetDir(options.root);
  const copied = copyWasm(packageDir, join(assetDir, 'wasm'));
  if (!copied.ok) {
    return copied;
  }

  const model = await ensureModel(join(assetDir, MODEL_FILE), options);
  if (!model.ok) {
    return model;
  }
  return { ok: true, value: { copied: copied.value, model: model.value } };
}

if (import.meta.main) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const result = await prepareMediapipeAssets({ root, fetchModel: process.argv.includes('--fetch-model') });
  if (result.ok) {
    console.log(
      `mediapipe-assets: copied ${result.value.copied.length} WebAssembly files and ${result.value.model} ${MODEL_FILE} (${MEDIAPIPE_VERSION}).`,
    );
  } else {
    console.error(`mediapipe-assets: ${result.error}`);
    process.exit(1);
  }
}
