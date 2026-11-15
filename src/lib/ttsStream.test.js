import { describe, it, expect, vi, afterEach } from 'vitest';
import { readAudioEvents } from './ttsStream.js';

const start = { type: 'start', generation_id: 'one', sample_rate: 24000, channels: 1, format: 's16le' };
const chunk = { type: 'audio', sequence: 0, sample_offset: 0, pcm: 'AAD/fwCA' };
const textReady = { type: 'text_ready', generation_id: 'one', text: 'Explanation before speech.' };
function response(events, fragmented = false) {
  const bytes = new TextEncoder().encode(events.map((e) => JSON.stringify(e) + '\n').join(''));
  let pos = 0;
  return { ok: true, body: new ReadableStream({ pull(controller) {
    if (pos === bytes.length) { controller.close(); return; }
    const end = fragmented ? Math.min(pos + 7, bytes.length) : bytes.length;
    controller.enqueue(bytes.slice(pos, end)); pos = end;
  } }) };
}

afterEach(() => vi.unstubAllGlobals());

describe('speech stream protocol', () => {
  it('delivers early text across split packets before start and PCM', async () => {
    const events = [];
    await readAudioEvents(response([textReady, { type: 'keepalive' }, start, chunk, { type: 'complete' }], true),
      (event) => events.push(event));
    expect(events.map((event) => event.type)).toEqual(['text_ready', 'start', 'audio', 'complete']);
    expect(events[0]).toEqual(textReady);
    expect(events[0].samples).toBeUndefined();
  });
  it.each([
    { text: null }, { text: 123 }, { text: '  ' }, { text: undefined },
    { generation_id: null }, { generation_id: 1 }, { generation_id: ' ' }, { generation_id: undefined },
  ])('rejects malformed early text: %j', async (invalid) => {
    const onEvent = vi.fn();
    await expect(readAudioEvents(response([{ ...textReady, ...invalid }]), onEvent))
      .rejects.toThrow('text event');
    expect(onEvent).not.toHaveBeenCalled();
  });
  it('rejects duplicate, late, or different-generation early text', async () => {
    for (const events of [[textReady, textReady], [start, textReady],
      [textReady, { ...start, generation_id: 'two' }]]) {
      await expect(readAudioEvents(response(events), () => {})).rejects.toThrow();
    }
  });
  it('does not let early text replace start metadata or terminal completion', async () => {
    await expect(readAudioEvents(response([textReady, chunk]), () => {})).rejects.toThrow('out of order');
    await expect(readAudioEvents(response([textReady]), () => {})).rejects.toThrow('before completion');
  });
  it('reassembles split records and decodes signed little-endian PCM', async () => {
    const events = [];
    await readAudioEvents(response([start, chunk, { type: 'complete' }], true), (event) => events.push(event));
    expect(events.map((e) => e.type)).toEqual(['start', 'audio', 'complete']);
    expect([...events[1].samples]).toEqual([0, 32767 / 32768, -1]);
  });
  it('does not accept an abruptly closed stream as success', async () => {
    await expect(readAudioEvents(response([start, chunk]), () => {})).rejects.toThrow('before completion');
  });
  it('rejects missing/reordered audio and mismatched offsets', async () => {
    for (const event of [{ ...chunk, sequence: 1 }, { ...chunk, sample_offset: 12 }]) {
      await expect(readAudioEvents(response([start, event]), () => {})).rejects.toThrow('out of order');
    }
  });
  it('requires valid format metadata before audio', async () => {
    await expect(readAudioEvents(response([chunk]), () => {})).rejects.toThrow('out of order');
    await expect(readAudioEvents(response([{ ...start, sample_rate: 16000 }]), () => {})).rejects.toThrow('format');
  });
  it('passes terminal errors with stable codes', async () => {
    await expect(readAudioEvents(response([start, { type: 'error', code: 'tts_stream_interrupted' }]), () => {}))
      .rejects.toMatchObject({ code: 'tts_stream_interrupted' });
  });
  it('supports completed cache hits without pretending PCM was streamed', async () => {
    const events = [];
    await readAudioEvents(response([{ type: 'complete', cached: true }]), (e) => events.push(e));
    expect(events).toEqual([{ type: 'complete', cached: true }]);
  });
  it('cancels its reader when the consumer rejects a chunk', async () => {
    await expect(readAudioEvents(response([start, chunk]), () => { throw new Error('player closed'); }))
      .rejects.toThrow('player closed');
  });
});

describe('real worklet algorithm', () => {
  it('resamples, pauses, and emits ended only after completion and draining', async () => {
    let Processor;
    const messages = [];
    vi.stubGlobal('AudioWorkletProcessor', class { constructor() { this.port = { postMessage: (m) => messages.push(m) }; } });
    vi.stubGlobal('sampleRate', 48000);
    vi.stubGlobal('registerProcessor', (_name, processor) => { Processor = processor; });
    await import('./ttsWorklet.js');
    const processor = new Processor();
    const send = (data) => processor.port.onmessage({ data });
    const render = () => { const out = new Float32Array(128); processor.process([], [[out]]); return out; };
    send({ type: 'audio', samples: new Float32Array(2400).fill(.5) });
    render(); expect(processor.position).toBe(0);
    send({ type: 'play' });
    expect(render()[0]).toBe(.5);
    expect(processor.position).toBe(64);
    send({ type: 'pause' }); render(); expect(processor.position).toBe(64);
    send({ type: 'play' });
    for (let i = 0; i < 50; i++) render();
    expect(processor.buffered).toBe(0);
    expect(messages.some((m) => m.ended)).toBe(false);
    send({ type: 'complete' }); render();
    expect(messages.filter((m) => m.ended)).toHaveLength(1);
    render(); expect(messages.filter((m) => m.ended)).toHaveLength(1);
  });
});
