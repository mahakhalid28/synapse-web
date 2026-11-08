import { describe, it, expect } from "vitest";
import { TARGET_SAMPLE_RATE, encodeWavBytes, mixToMono, resample, toWav16k } from "./wav";

const ascii = (bytes, from, to) => String.fromCharCode(...bytes.slice(from, to));
const view = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

describe("mixToMono", () => {
  it("averages the channels", () => {
    const mono = mixToMono([Float32Array.of(1, 0, -1), Float32Array.of(0, 1, -1)]);
    expect(Array.from(mono)).toEqual([0.5, 0.5, -1]);
  });

  it("copies a single channel", () => {
    const source = Float32Array.of(0.1, 0.2);
    const mono = mixToMono([source]);
    expect(Array.from(mono)).toEqual(Array.from(source));
    expect(mono).not.toBe(source);
  });

  it("handles no channels", () => {
    expect(mixToMono([])).toHaveLength(0);
  });
});

describe("resample", () => {
  it("returns a copy when the rate is unchanged", () => {
    const source = Float32Array.of(0.1, 0.2, 0.3);
    const out = resample(source, 16000, 16000);
    expect(Array.from(out)).toEqual(Array.from(source));
    expect(out).not.toBe(source);
  });

  it("downsamples 48 kHz to 16 kHz to a third of the length", () => {
    const out = resample(new Float32Array(48000).fill(0.5), 48000, 16000);
    expect(out).toHaveLength(16000);
    expect(out[0]).toBeCloseTo(0.5);
    expect(out[15999]).toBeCloseTo(0.5);
  });

  it("averages source samples when downsampling (a simple low-pass)", () => {
    const out = resample(Float32Array.of(1, -1, 1, -1, 1, -1), 48000, 16000);
    expect(Array.from(out)).toEqual([expect.closeTo(1 / 3, 5), expect.closeTo(-1 / 3, 5)]);
  });

  it("upsamples by interpolating", () => {
    const out = resample(Float32Array.of(0, 1), 8000, 16000);
    expect(out).toHaveLength(4);
    expect(out[0]).toBeCloseTo(0);
    expect(out[1]).toBeCloseTo(0.5);
    expect(out[2]).toBeCloseTo(1);
  });

  it("handles empty input and rejects bad rates", () => {
    expect(resample(new Float32Array(0), 48000, 16000)).toHaveLength(0);
    expect(() => resample(Float32Array.of(1), 0, 16000)).toThrow();
    expect(() => resample(Float32Array.of(1), 48000, -1)).toThrow();
  });
});

describe("encodeWavBytes", () => {
  it("writes a valid 16 kHz mono 16-bit PCM header", () => {
    const bytes = encodeWavBytes(Float32Array.of(0, 0.5, -0.5, 1), TARGET_SAMPLE_RATE);
    const v = view(bytes);
    expect(ascii(bytes, 0, 4)).toBe("RIFF");
    expect(ascii(bytes, 8, 12)).toBe("WAVE");
    expect(ascii(bytes, 12, 16)).toBe("fmt ");
    expect(ascii(bytes, 36, 40)).toBe("data");
    expect(v.getUint32(4, true)).toBe(bytes.length - 8);
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint32(28, true)).toBe(32000); // byte rate
    expect(v.getUint16(32, true)).toBe(2); // block align
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(8);
    expect(bytes).toHaveLength(44 + 8);
  });

  it("converts samples to signed 16-bit and clamps out-of-range values", () => {
    const v = view(encodeWavBytes(Float32Array.of(0, 1, -1, 0.5, 2, -2)));
    const sample = (i) => v.getInt16(44 + i * 2, true);
    expect(sample(0)).toBe(0);
    expect(sample(1)).toBe(32767);
    expect(sample(2)).toBe(-32768);
    expect(sample(3)).toBe(Math.trunc(0.5 * 32767));
    expect(sample(4)).toBe(32767);
    expect(sample(5)).toBe(-32768);
  });

  it("encodes silence of zero length as a bare header", () => {
    expect(encodeWavBytes(new Float32Array(0))).toHaveLength(44);
  });
});

describe("toWav16k", () => {
  const fakeDecoded = (rate, channels) => ({
    sampleRate: rate,
    numberOfChannels: channels.length,
    getChannelData: (i) => channels[i],
  });
  const clip = (size = 4) => ({ arrayBuffer: async () => new ArrayBuffer(size) });

  it("converts a 48 kHz stereo clip to 16 kHz mono WAV", async () => {
    const left = new Float32Array(48000).fill(0.4);
    const right = new Float32Array(48000).fill(0.2);
    const out = await toWav16k(clip(), { decodeAudio: async () => fakeDecoded(48000, [left, right]) });
    expect(out.sampleRate).toBe(16000);
    expect(out.samples).toHaveLength(16000);
    expect(out.samples[100]).toBeCloseTo(0.3, 5);
    expect(out.durationMs).toBe(1000);
    expect(out.blob.type).toBe("audio/wav");
    expect(out.blob.size).toBe(44 + 16000 * 2);
  });

  it("passes the clip's bytes to the decoder", async () => {
    let received = null;
    await toWav16k(clip(12), {
      decodeAudio: async (buffer) => {
        received = buffer;
        return fakeDecoded(16000, [new Float32Array(160)]);
      },
    });
    expect(received.byteLength).toBe(12);
  });

  it("propagates a decoder failure", async () => {
    await expect(toWav16k(clip(), { decodeAudio: async () => { throw new Error("bad audio"); } })).rejects.toThrow("bad audio");
  });
});
