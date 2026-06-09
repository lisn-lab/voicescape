// Live audio visualizer — FFT frequency bar spectrogram

export class Visualizer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.analyser = null;
    this._animFrame = null;
    this._draw = this._draw.bind(this);
  }

  init(analyser) {
    this.analyser = analyser;
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * window.devicePixelRatio;
    this.canvas.height = rect.height * window.devicePixelRatio;
    this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  }

  start() {
    if (this._animFrame) return;
    this._draw();
  }

  stop() {
    if (this._animFrame) {
      cancelAnimationFrame(this._animFrame);
      this._animFrame = null;
    }
    // Clear canvas
    const rect = this.canvas.getBoundingClientRect();
    this.ctx.clearRect(0, 0, rect.width, rect.height);
  }

  _draw() {
    this._animFrame = requestAnimationFrame(this._draw);

    if (!this.analyser) return;

    const values = this.analyser.getValue(); // Float32Array of dB values (-100 to 0)
    const rect = this.canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    this.ctx.clearRect(0, 0, width, height);

    const barCount = values.length;
    const barWidth = width / barCount;
    const minDb = -100;
    const maxDb = -10;

    for (let i = 0; i < barCount; i++) {
      // Normalize dB to 0-1 range
      const db = Math.max(minDb, Math.min(maxDb, values[i]));
      const normalized = (db - minDb) / (maxDb - minDb);
      const barHeight = normalized * height;

      // Colour gradient: blue at low freq -> amber at mid -> red at high
      const ratio = i / barCount;
      const r = Math.round(ratio < 0.5 ? 6 + ratio * 2 * 233 : 239);
      const g = Math.round(ratio < 0.5 ? 182 - ratio * 2 * 24 : 158 * (1 - (ratio - 0.5) * 2));
      const b = Math.round(ratio < 0.5 ? 212 * (1 - ratio * 2) : 20);

      this.ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      this.ctx.fillRect(
        i * barWidth,
        height - barHeight,
        barWidth - 1,
        barHeight
      );
    }
  }
}
