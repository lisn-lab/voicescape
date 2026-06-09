// Input handler — keyboard and touch events

const CODE_TO_KEY = {
  'Digit1': '1', 'Digit2': '2', 'Digit3': '3', 'Digit4': '4', 'Digit5': '5',
  'Digit6': '6', 'Digit7': '7', 'Digit8': '8', 'Digit9': '9', 'Digit0': '0',
  'KeyQ': 'q', 'KeyW': 'w', 'KeyE': 'e', 'KeyR': 'r', 'KeyT': 't',
  'KeyY': 'y', 'KeyU': 'u', 'KeyI': 'i', 'KeyO': 'o', 'KeyP': 'p',
  'KeyA': 'a', 'KeyS': 's', 'KeyD': 'd', 'KeyF': 'f', 'KeyG': 'g',
  'KeyH': 'h', 'KeyJ': 'j', 'KeyK': 'k', 'KeyL': 'l', 'Semicolon': ';',
  'KeyZ': 'z', 'KeyX': 'x', 'KeyC': 'c', 'KeyV': 'v', 'KeyB': 'b',
  'KeyN': 'n', 'KeyM': 'm', 'Comma': ',', 'Period': '.', 'Slash': '/'
};

export class InputHandler {
  constructor() {
    this.mode = 'keyboard';
    this.keymap = new Map();
    this.onPadTrigger = null;
    this.onPadModeToggle = null;
    this._pressedKeys = new Set();
    this._boundKeydown = this._onKeydown.bind(this);
    this._boundKeyup = this._onKeyup.bind(this);
  }

  init(clips) {
    for (const clip of clips) {
      this.keymap.set(clip.key.toLowerCase(), clip.id);
    }

    this.mode = this._detectMode();
    console.log(`InputHandler mode: ${this.mode}`);

    if (this.mode === 'keyboard') {
      this._bindKeyboard();
    }
  }

  _detectMode() {
    const isTouchPrimary = navigator.maxTouchPoints > 0 && window.innerWidth < 1024;
    if (isTouchPrimary) return 'touch';
    if ('ontouchstart' in window && window.innerWidth < 1024) return 'touch';
    return 'keyboard';
  }

  switchMode(mode) {
    if (mode === this.mode) return;
    if (this.mode === 'keyboard') this._unbindKeyboard();
    this.mode = mode;
    if (mode === 'keyboard') this._bindKeyboard();
    console.log(`InputHandler switched to: ${this.mode}`);
  }

  _bindKeyboard() {
    document.addEventListener('keydown', this._boundKeydown);
    document.addEventListener('keyup', this._boundKeyup);
  }

  _unbindKeyboard() {
    document.removeEventListener('keydown', this._boundKeydown);
    document.removeEventListener('keyup', this._boundKeyup);
  }

  _onKeydown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.repeat) return;

    // Alt/Option + key = cycle pad mode. Require Alt held alone (no Cmd /
     // Ctrl / Shift) so we don't trip system or browser shortcuts.
    if (e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      // Use e.code to get the unmodified key — Option+W on Mac otherwise
      // produces "∑", which wouldn't match our keymap.
      const key = CODE_TO_KEY[e.code];
      if (!key) return;
      const clipId = this.keymap.get(key);
      if (clipId && this.onPadModeToggle) {
        e.preventDefault();
        this.onPadModeToggle(clipId);
      }
      return;
    }

    const key = e.key.toLowerCase();
    const clipId = this.keymap.get(key);
    if (clipId && !this._pressedKeys.has(key)) {
      this._pressedKeys.add(key);
      if (this.onPadTrigger) this.onPadTrigger(clipId);
    }
  }

  _onKeyup(e) {
    const key = e.key.toLowerCase();
    this._pressedKeys.delete(key);
  }

  handleTouchTrigger(clipId) {
    if (this.onPadTrigger) this.onPadTrigger(clipId);
  }

  addKey(key, clipId) {
    this.keymap.set(key.toLowerCase(), clipId);
  }

  getAssignedKeys() {
    return new Set(this.keymap.keys());
  }

  getNextAvailableKey() {
    const allKeys = [
      '1','2','3','4','5','6','7','8','9','0',
      'q','w','e','r','t','y','u','i','o','p',
      'a','s','d','f','g','h','j','k','l',';',
      'z','x','c','v','b','n','m',',','.','/'
    ];
    const assigned = this.getAssignedKeys();
    return allKeys.find(k => !assigned.has(k)) || null;
  }

  swapKeys(keyA, keyB) {
    const clipA = this.keymap.get(keyA);
    const clipB = this.keymap.get(keyB);
    if (clipA) this.keymap.set(keyB, clipA);
    else this.keymap.delete(keyB);
    if (clipB) this.keymap.set(keyA, clipB);
    else this.keymap.delete(keyA);
  }

  removeKey(key) {
    this.keymap.delete(key);
    this._pressedKeys.delete(key);
  }
}
