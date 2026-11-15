import { apiUrl } from './apiConfig.js';
import { captureAccount, assertAccount, ACCOUNT_CHANGED } from './accountSession.js';

// NDJSON records can cross arbitrary HTTP packet boundaries.
export async function readAudioEvents(response, onEvent, signal) {
  if (!response.ok) throw new Error(`Speech request failed (${response.status}).`);
  if (!response.body?.getReader) throw new Error('Audio streaming is unavailable.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let complete = false;
  let sequence = 0;
  let offset = 0;
  let started = false;
  let textReady = null;
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      let newline;
      while ((newline = pending.indexOf('\n')) !== -1) {
        if (newline > 262144) throw new Error('Invalid audio stream record.');
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.type === 'keepalive') continue;
        if (event.type === 'error') {
          const error = new Error('Speech was interrupted. Retry the explanation or continue the lecture.');
          error.code = event.code;
          throw error;
        }
        if (event.type === 'text_ready') {
          if (started || textReady || typeof event.text !== 'string' || !event.text.trim() ||
              typeof event.generation_id !== 'string' || !event.generation_id.trim()) {
            throw new Error('Invalid explanation text event.');
          }
          textReady = event;
        } else if (event.type === 'start') {
          if (textReady && event.generation_id !== textReady.generation_id) {
            throw new Error('Explanation stream generation changed.');
          }
          if (started || event.sample_rate !== 24000 || event.channels !== 1 || event.format !== 's16le') {
            throw new Error('Unsupported speech format.');
          }
          started = true;
        } else if (event.type === 'audio') {
          if (!started || event.sequence !== sequence++ || event.sample_offset !== offset) {
            throw new Error('Audio stream arrived out of order.');
          }
          const bytes = atob(event.pcm);
          if (!bytes.length || bytes.length % 2 || bytes.length > 12000) throw new Error('Invalid audio chunk.');
          const data = new Uint8Array(bytes.length);
          for (let i = 0; i < bytes.length; i++) data[i] = bytes.charCodeAt(i);
          const view = new DataView(data.buffer);
          event.samples = new Float32Array(bytes.length / 2);
          for (let i = 0; i < event.samples.length; i++) event.samples[i] = view.getInt16(i * 2, true) / 32768;
          offset += event.samples.length;
        } else if (event.type === 'complete') complete = true;
        else throw new Error('Invalid audio stream event.');
        await onEvent(event);
        if (complete) return;
      }
      if (pending.length > 262144) throw new Error('Invalid audio stream record.');
      if (done) break;
    }
    if (!complete) throw new Error('Audio stream ended before completion.');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function supportsAudioStreaming() {
  return Boolean(globalThis.AudioContext && globalThis.AudioWorkletNode && globalThis.ReadableStream);
}

// An Audio-like facade keeps existing lecture/voice arbitration in one place.
export async function createStreamAudio() {
  const context = new AudioContext();
  try {
    await context.audioWorklet.addModule(new URL('./ttsWorklet.js', import.meta.url));
  } catch (error) { await context.close(); throw error; }
  const node = new AudioWorkletNode(context, 'synapse-tts');
  node.connect(context.destination);
  const audio = new EventTarget();
  let paused = true;
  let disposed = false;
  let position = 0;
  let duration = Infinity;
  let rate = 1;
  let buffered = 0;
  let received = 0;
  let completed = false;
  const waiting = new Set();
  const notify = () => { for (const wake of waiting) wake(); waiting.clear(); };
  const emit = (type) => { audio.dispatchEvent(new Event(type)); audio[`on${type}`]?.(); };
  node.port.onmessage = ({ data }) => {
    buffered = received - data.position;
    position = data.position / 24000;
    notify();
    if (data.ended) { paused = true; emit('ended'); }
    else emit('timeupdate');
  };
  Object.defineProperties(audio, {
    paused: { get: () => paused },
    currentTime: { get: () => position, set: (value) => {
      if (value !== position) throw new Error('Seeking is available after saved audio is loaded.');
    } },
    duration: { get: () => duration },
    playbackRate: { get: () => rate, set: (value) => {
      if (!Number.isFinite(value) || value < 0.25 || value > 4) return;
      rate = value; node.port.postMessage({ type: 'rate', value });
    } },
    streaming: { value: true },
    completed: { get: () => completed },
  });
  audio.play = async () => {
    if (disposed) throw new Error('Audio player is closed.');
    await context.resume();
    paused = false;
    node.port.postMessage({ type: 'play' });
  };
  audio.pause = () => { paused = true; node.port.postMessage({ type: 'pause' }); };
  audio.push = async (samples) => {
    // At most eight seconds in the worklet. HTTP backpressure stops reading
    // while paused; generation keeps writing to its bounded disk spool.
    while (!disposed && buffered + samples.length > 192000) {
      await new Promise((resolve) => waiting.add(resolve));
    }
    if (disposed) throw new DOMException('Cancelled', 'AbortError');
    buffered += samples.length;
    received += samples.length;
    node.port.postMessage({ type: 'audio', samples }, [samples.buffer]);
  };
  audio.finish = () => {
    completed = true; duration = received / 24000;
    emit('loadedmetadata');
    node.port.postMessage({ type: 'complete' });
  };
  audio.dispose = () => {
    if (disposed) return;
    disposed = true; paused = true; notify(); node.disconnect(); node.port.close();
    context.close().catch(() => {});
  };
  return audio;
}

export async function streamSpeech(path, body, { signal, onEvent }) {
  const account = captureAccount();
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  globalThis.addEventListener?.(ACCOUNT_CHANGED, abort);
  if (signal?.aborted) abort();
  try {
    const response = await fetch(apiUrl(path), {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(account.token ? { Authorization: `Bearer ${account.token}` } : {}) },
      body: JSON.stringify(body),
    });
    await readAudioEvents(response, async (event) => {
      assertAccount(account);
      await onEvent(event);
    }, controller.signal);
  } finally {
    signal?.removeEventListener('abort', abort);
    globalThis.removeEventListener?.(ACCOUNT_CHANGED, abort);
  }
}
