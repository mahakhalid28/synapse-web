// Turns a recorded clip (the browser's webm/opus, at whatever rate the microphone runs) into the 16 kHz mono
// 16-bit WAV the speech-recognition service takes. WAV means the server needs no audio decoder at all.
//
// Everything except decodeAudio is plain arithmetic, so it is tested without a browser audio stack.

export const TARGET_SAMPLE_RATE = 16_000;

/** Average all channels into one. */
export function mixToMono(channels) {
  if (!channels.length) return new Float32Array(0);
  if (channels.length === 1) return Float32Array.from(channels[0]);
  const length = channels[0].length;
  const mono = new Float32Array(length);
  for (const channel of channels) {
    for (let i = 0; i < length; i++) mono[i] += channel[i];
  }
  for (let i = 0; i < length; i++) mono[i] /= channels.length;
  return mono;
}

/**
 * Change the sample rate. Going down averages the source samples that fall in each output sample (a simple
 * low-pass, so high frequencies do not fold back as noise); going up interpolates between neighbours.
 */
export function resample(samples, fromRate, toRate) {
  if (!(fromRate > 0) || !(toRate > 0)) throw new Error("sample rates must be positive");
  if (fromRate === toRate || samples.length === 0) return Float32Array.from(samples);
  const ratio = fromRate / toRate;
  const outLength = Math.max(1, Math.floor(samples.length / ratio));
  const out = new Float32Array(outLength);
  if (ratio > 1) {
    for (let i = 0; i < outLength; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.min(samples.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
      let sum = 0;
      for (let j = start; j < end; j++) sum += samples[j];
      out[i] = sum / (end - start);
    }
  } else {
    for (let i = 0; i < outLength; i++) {
      const position = i * ratio;
      const index = Math.floor(position);
      const next = Math.min(samples.length - 1, index + 1);
      const fraction = position - index;
      out[i] = samples[index] * (1 - fraction) + samples[next] * fraction;
    }
  }
  return out;
}

/** 44-byte RIFF header plus 16-bit little-endian PCM, mono. */
export function encodeWavBytes(samples, sampleRate = TARGET_SAMPLE_RATE) {
  const dataBytes = samples.length * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const text = (offset, value) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  text(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return bytes;
}

async function defaultDecodeAudio(arrayBuffer) {
  const Ctx = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
  if (!Ctx) throw new Error("This computer can't decode audio in Synapse.");
  const ctx = new Ctx();
  try {
    return await ctx.decodeAudioData(arrayBuffer);
  } finally {
    try { await ctx.close(); } catch { /* already closed */ }
  }
}

/**
 * Convert a recorded Blob to 16 kHz mono WAV.
 * Resolves to { blob, samples, sampleRate, durationMs }.
 * `decodeAudio` is a test seam; the default uses the browser's decoder.
 */
export async function toWav16k(blob, { decodeAudio = defaultDecodeAudio } = {}) {
  const decoded = await decodeAudio(await blob.arrayBuffer());
  const channels = [];
  for (let i = 0; i < decoded.numberOfChannels; i++) channels.push(decoded.getChannelData(i));
  const samples = resample(mixToMono(channels), decoded.sampleRate, TARGET_SAMPLE_RATE);
  return {
    blob: new Blob([encodeWavBytes(samples, TARGET_SAMPLE_RATE)], { type: "audio/wav" }),
    samples,
    sampleRate: TARGET_SAMPLE_RATE,
    durationMs: Math.round((samples.length / TARGET_SAMPLE_RATE) * 1000),
  };
}
