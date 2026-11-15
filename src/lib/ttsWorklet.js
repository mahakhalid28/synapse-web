/* global AudioWorkletProcessor, registerProcessor, sampleRate */
class SpeechProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring = new Float32Array(192000);
    this.read = 0; this.write = 0; this.buffered = 0;
    this.fraction = 0; this.position = 0; this.rate = 1;
    this.playing = false; this.complete = false; this.ended = false; this.ticks = 0;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'play') this.playing = true;
      if (data.type === 'pause') this.playing = false;
      if (data.type === 'rate') this.rate = data.value;
      if (data.type === 'complete') this.complete = true;
      if (data.type === 'audio') {
        for (const value of data.samples) {
          this.ring[this.write] = value;
          this.write = (this.write + 1) % this.ring.length;
        }
        this.buffered += data.samples.length;
      }
    };
  }
  process(_inputs, outputs) {
    const output = outputs[0][0];
    if (this.playing) {
      const step = 24000 / sampleRate * this.rate;
      for (let i = 0; i < output.length && this.buffered > 0; i++) {
        const a = this.ring[this.read];
        const b = this.buffered > 1 ? this.ring[(this.read + 1) % this.ring.length] : a;
        output[i] = a + (b - a) * this.fraction;
        this.fraction += step;
        const consumed = Math.min(Math.floor(this.fraction), this.buffered);
        this.read = (this.read + consumed) % this.ring.length;
        this.buffered -= consumed;
        this.position += consumed;
        this.fraction -= consumed;
        if (!this.buffered) this.fraction = 0;
      }
    }
    const ended = this.complete && this.buffered === 0 && !this.ended;
    if (ended) { this.ended = true; this.playing = false; }
    if (++this.ticks % 20 === 0 || ended) {
      this.port.postMessage({ buffered: this.buffered, position: this.position, ended });
    }
    return true;
  }
}
registerProcessor('synapse-tts', SpeechProcessor);
