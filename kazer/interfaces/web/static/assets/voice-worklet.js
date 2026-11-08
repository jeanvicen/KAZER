// AudioWorklet do modo voz (motor "gateway"): microfone → PCM16 mono 16 kHz em
// quadros de 20 ms (640 bytes). Roda fora da thread da página; não grava nada,
// só repassa cada quadro para o WebSocket enquanto o modo voz está aberto.

class KazerPcm16 extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.target = options?.processorOptions?.targetRate || 16000;
    this.ratio = sampleRate / this.target;
    this.frame = new Int16Array(this.target / 50); // 20 ms
    this.filled = 0;
    this.position = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    // Reamostragem simples por média do intervalo (passa-baixa grosseiro).
    while (this.position < input.length) {
      const start = Math.floor(this.position);
      const end = Math.min(input.length, Math.floor(this.position + this.ratio) || start + 1);
      let sum = 0;
      for (let i = start; i < end; i += 1) sum += input[i];
      const value = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)));
      this.frame[this.filled] = value < 0 ? value * 0x8000 : value * 0x7fff;
      this.filled += 1;
      if (this.filled === this.frame.length) {
        this.port.postMessage(this.frame.buffer.slice(0));
        this.filled = 0;
      }
      this.position += this.ratio;
    }
    this.position -= input.length;
    return true;
  }
}

registerProcessor("kazer-pcm16", KazerPcm16);
