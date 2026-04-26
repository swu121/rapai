class RapProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = [];
    this._chunkSamples = 1600; // 100ms @ 16kHz
  }

  process(inputs) {
    const ch = inputs[0][0];
    if (!ch) return true;

    for (let i = 0; i < ch.length; i++) this._buf.push(ch[i]);

    while (this._buf.length >= this._chunkSamples) {
      const chunk = new Float32Array(this._buf.splice(0, this._chunkSamples));
      this.port.postMessage(chunk, [chunk.buffer]);
    }
    return true;
  }
}

registerProcessor('rap-processor', RapProcessor);
