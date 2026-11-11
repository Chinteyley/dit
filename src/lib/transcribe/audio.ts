/** PCM WAV keeps short clips portable and lets the server bound duration before billing. */
export const PCM_RATE = 16_000;
export const MAX_AUDIO_MS = 30_000;

export function encodeSpeechWav(channels: readonly Float32Array[], sampleRate: number): Uint8Array<ArrayBuffer> {
  const length = channels[0]?.length ?? 0;
  const count = Math.floor(length * PCM_RATE / sampleRate);
  const bytes = new Uint8Array(44 + count * 2);
  const view = new DataView(bytes.buffer);
  const tag = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i);
  };
  tag(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); tag(8, 'WAVE');
  tag(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, PCM_RATE, true);
  view.setUint32(28, PCM_RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  tag(36, 'data'); view.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i++) {
    // Average each input interval and all channels rather than aliasing by dropping samples.
    const first = Math.floor(i * sampleRate / PCM_RATE);
    const end = Math.min(length, Math.max(first + 1, Math.floor((i + 1) * sampleRate / PCM_RATE)));
    let sum = 0;
    for (const channel of channels) for (let j = first; j < end; j++) sum += channel[j] ?? 0;
    const value = Math.max(-1, Math.min(1, sum / ((end - first) * channels.length)));
    view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}

/** Only uncompressed PCM16 is accepted; sample counts, not a claimed duration, bound work. */
export function wavDurationMs(bytes: Uint8Array): number | null {
  if (bytes.length < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || view.getUint32(4, true) + 8 !== bytes.length) return null;
  let byteRate = 0;
  let align = 0;
  let dataBytes = 0;
  let hasFormat = false;
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) return null;
    const type = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + size;
    if (end > bytes.length) return null;
    if (type === 'fmt ') {
      if (hasFormat || size < 16 || view.getUint16(start, true) !== 1) return null;
      const channels = view.getUint16(start + 2, true);
      const rate = view.getUint32(start + 4, true);
      byteRate = view.getUint32(start + 8, true);
      align = view.getUint16(start + 12, true);
      if (channels < 1 || channels > 2 || rate < 8000 || rate > 96000
        || view.getUint16(start + 14, true) !== 16 || align !== channels * 2 || byteRate !== rate * align) return null;
      hasFormat = true;
    } else if (type === 'data') {
      if (!hasFormat || size % align !== 0) return null;
      dataBytes += size;
    }
    offset = end + (size % 2);
    if (offset > bytes.length) return null;
  }
  return !hasFormat || dataBytes === 0 ? null : dataBytes / byteRate * 1000;
}
