// Background seek bar: shows the song position and lets you drag to set the
// start point (when stopped) or live-seek (while playing). Reads/writes through
// the AudioEngine; the export uses the offset captured at Play (start-point only).
export class SeekBar {
  constructor(audio) {
    this.audio = audio;
    this.el = document.getElementById('seek-bar');
    this.fill = document.getElementById('seek-fill');
    this.handle = document.getElementById('seek-handle');
    this._dragging = false;
  }

  init() {
    if (!this.el) return;
    const onMove = (e) => { if (this._dragging) this._apply(e); };
    const onUp = () => {
      this._dragging = false;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    this.el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._dragging = true;
      this._apply(e);
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
    this._tick();
  }

  _apply(e) {
    const rect = this.el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const sec = frac * this.audio.getSongDuration();
    if (this.audio.playing) this.audio.seekBackground(sec);
    else this.audio.setBackgroundStartOffset(sec);
    this._render(frac);
  }

  _tick() {
    const dur = this.audio.getSongDuration();
    if (dur && !this._dragging) this._render(this.audio.getSongPosition() / dur);
    requestAnimationFrame(() => this._tick());
  }

  _render(frac) {
    const pct = (Math.max(0, Math.min(1, frac)) * 100).toFixed(2) + '%';
    if (this.fill) this.fill.style.width = pct;
    if (this.handle) this.handle.style.left = pct;
  }
}
