// UI renderer — keyboard view, mobile grid, pad state display

const KEYBOARD_ROWS = [
  ['1','2','3','4','5','6','7','8','9','0'],
  ['q','w','e','r','t','y','u','i','o','p'],
  ['a','s','d','f','g','h','j','k','l',';'],
  ['z','x','c','v','b','n','m',',','.','/' ]
];

export class UIRenderer {
  constructor(container) {
    this.container = container;
    this.pads = new Map();
    this.keyToPad = new Map();
    this.mode = 'keyboard';
    this.onTouchTrigger = null;
    this.onModeToggle = null;   // callback: (clipId) => {}
    this.onPadSwap = null;      // callback: (fromKey, toKey) => {}
    this.onPadDelete = null;    // callback: (clipId) => {}  — voice clips only
    this.onPadRename = null;    // callback: (clipId, newLabel) => {}  — voice clips only
    this._dragState = null;
    this._activeRename = null;  // { finish } for an open inline rename editor, if any
  }

  render(clips, mode) {
    this.mode = mode;
    this.container.innerHTML = '';
    this.pads.clear();
    this.keyToPad.clear();

    const keyToClip = new Map();
    for (const clip of clips) {
      keyToClip.set(clip.key.toLowerCase(), clip);
    }

    if (mode === 'keyboard') {
      this._renderKeyboard(keyToClip);
    } else {
      this._renderMobileGrid(clips);
    }
  }

  _renderKeyboard(keyToClip) {
    for (const row of KEYBOARD_ROWS) {
      const rowEl = document.createElement('div');
      rowEl.className = 'keyboard-row';

      for (const key of row) {
        const clip = keyToClip.get(key);
        const pad = this._createPad(key, clip);
        rowEl.appendChild(pad);
      }

      this.container.appendChild(rowEl);
    }
  }

  _renderMobileGrid(clips) {
    const grid = document.createElement('div');
    grid.className = 'mobile-grid';

    for (const clip of clips) {
      const pad = this._createPad(clip.key, clip);
      pad.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (this.onTouchTrigger) this.onTouchTrigger(clip.id);
      });
      grid.appendChild(pad);
    }

    this.container.appendChild(grid);
  }

  _createPad(key, clip) {
    const pad = document.createElement('div');
    pad.className = 'pad';

    if (clip) {
      pad.dataset.clipId = clip.id;
      pad.dataset.type = clip.userRecorded ? 'user' : clip.type;
      pad.dataset.repeat = String(clip.repeat || 1);

      const keyLabel = document.createElement('span');
      keyLabel.className = 'key-letter';
      keyLabel.textContent = key.toUpperCase();
      pad.appendChild(keyLabel);

      const clipLabel = document.createElement('span');
      clipLabel.className = 'clip-label';
      clipLabel.textContent = clip.label;
      pad.appendChild(clipLabel);

      this._renderDots(pad);
      if (clip.userRecorded) { this._addRenameButton(pad, clip.id); this._addDeleteButton(pad, clip.id); }

      this.pads.set(clip.id, pad);
    } else {
      pad.classList.add('empty');

      const keyLabel = document.createElement('span');
      keyLabel.className = 'key-letter';
      keyLabel.textContent = key.toUpperCase();
      pad.appendChild(keyLabel);
    }

    this.keyToPad.set(key, pad);
    // Attach interactions
    if (clip) {
      this._attachModeToggle(pad, clip.id);
    }
    this._attachDrag(pad, key);
    return pad;
  }

  setPadState(clipId, state) {
    const pad = this.pads.get(clipId);
    if (!pad) return;

    pad.classList.remove('playing', 'looping', 'flash');

    switch (state) {
      case 'looping':
        pad.classList.add('looping');
        break;
      case 'playing':
        pad.classList.add('flash');
        pad.addEventListener('animationend', () => {
          pad.classList.remove('flash');
        }, { once: true });
        break;
      case 'idle':
      default:
        break;
    }
  }

  addPad(key, clip) {
    const padEl = this.keyToPad.get(key);
    if (padEl) {
      padEl.classList.remove('empty');
      padEl.dataset.clipId = clip.id;
      padEl.dataset.type = 'user';
      padEl.dataset.repeat = String(clip.repeat || 1);
      padEl.innerHTML = '';

      const keyLabel = document.createElement('span');
      keyLabel.className = 'key-letter';
      keyLabel.textContent = key.toUpperCase();
      padEl.appendChild(keyLabel);

      const clipLabel = document.createElement('span');
      clipLabel.className = 'clip-label';
      clipLabel.textContent = clip.label;
      padEl.appendChild(clipLabel);

      this._renderDots(padEl);
      this._addRenameButton(padEl, clip.id);
      this._addDeleteButton(padEl, clip.id);
      this._attachModeToggle(padEl, clip.id);

      this.pads.set(clip.id, padEl);
    }
  }

  updateBPM(bpm) {
    document.getElementById('bpm-display').textContent = `${bpm} BPM`;
  }

  setPadType(clipId, type) {
    const pad = this.pads.get(clipId);
    if (!pad) return;
    pad.dataset.type = type;
    this._renderDots(pad);
  }

  setPadRepeat(clipId, repeat) {
    const pad = this.pads.get(clipId);
    if (!pad) return;
    pad.dataset.repeat = String(Math.max(1, Math.min(4, repeat)));
    this._renderDots(pad);
  }

  _renderDots(pad) {
    // Remove existing dot row if present
    const existing = pad.querySelector('.pad-dots');
    if (existing) existing.remove();

    const type = pad.dataset.type;
    // Only render dots for one-shot or user clips in one-shot mode
    if (type !== 'oneshot' && type !== 'user') return;

    const repeat = parseInt(pad.dataset.repeat || '1', 10);

    const dotsEl = document.createElement('div');
    dotsEl.className = 'pad-dots';
    for (let i = 0; i < repeat; i++) {
      const dot = document.createElement('span');
      dot.className = 'pad-dot';
      dotsEl.appendChild(dot);
    }
    pad.appendChild(dotsEl);
  }

  clearPad(key) {
    const pad = this.keyToPad.get(key);
    if (!pad) return;
    // Remove from pads map
    const clipId = pad.dataset.clipId;
    if (clipId) this.pads.delete(clipId);
    // Reset to empty state
    delete pad.dataset.clipId;
    delete pad.dataset.type;
    pad.className = 'pad empty';
    pad.innerHTML = '';
    const keyLabel = document.createElement('span');
    keyLabel.className = 'key-letter';
    keyLabel.textContent = key.toUpperCase();
    pad.appendChild(keyLabel);
  }

  swapPads(keyA, keyB) {
    const padA = this.keyToPad.get(keyA);
    const padB = this.keyToPad.get(keyB);
    if (!padA || !padB) return;

    // Commit any open rename editor first — a swap rebuilds the pads (innerHTML
    // = ''), which would orphan the editor's input and lose the label. Finishing
    // it restores a real .clip-label before we read labels below.
    this._finishActiveRename();

    // Extract clip info from DOM
    const clipIdA = padA.dataset.clipId;
    const clipIdB = padB.dataset.clipId;
    const typeA = padA.dataset.type;
    const typeB = padB.dataset.type;
    const repeatA = padA.dataset.repeat;
    const repeatB = padB.dataset.repeat;
    const labelA = padA.querySelector('.clip-label')?.textContent;
    const labelB = padB.querySelector('.clip-label')?.textContent;

    // Rebuild pad A with B's content (or empty)
    this._rebuildPad(padA, keyA, clipIdB, typeB, labelB, repeatB);
    this._rebuildPad(padB, keyB, clipIdA, typeA, labelA, repeatA);

    // Update pads map
    if (clipIdA) this.pads.delete(clipIdA);
    if (clipIdB) this.pads.delete(clipIdB);
    if (clipIdB) this.pads.set(clipIdB, padA);
    if (clipIdA) this.pads.set(clipIdA, padB);
  }

  _rebuildPad(pad, key, clipId, type, label, repeat) {
    pad.innerHTML = '';
    pad.className = 'pad';
    if (clipId && label) {
      pad.dataset.clipId = clipId;
      pad.dataset.type = type || 'oneshot';
      pad.dataset.repeat = String(repeat || 1);
      const keyLabel = document.createElement('span');
      keyLabel.className = 'key-letter';
      keyLabel.textContent = key.toUpperCase();
      pad.appendChild(keyLabel);
      const clipLabel = document.createElement('span');
      clipLabel.className = 'clip-label';
      clipLabel.textContent = label;
      pad.appendChild(clipLabel);
      this._renderDots(pad);
      if (type === 'user') { this._addRenameButton(pad, clipId); this._addDeleteButton(pad, clipId); }
      this._attachModeToggle(pad, clipId);
    } else {
      delete pad.dataset.clipId;
      delete pad.dataset.type;
      delete pad.dataset.repeat;
      pad.classList.add('empty');
      const keyLabel = document.createElement('span');
      keyLabel.className = 'key-letter';
      keyLabel.textContent = key.toUpperCase();
      pad.appendChild(keyLabel);
    }
  }

  // --- Right-click / double-tap mode toggle ---

  _attachModeToggle(pad, clipId) {
    // Idempotent: the listeners read pad.dataset.clipId dynamically, so one set
    // per pad element is correct and survives content changes (addPad / swap).
    // Guard against double-binding when re-invoked for the same element.
    if (pad._modeToggleAttached) return;
    pad._modeToggleAttached = true;

    // Right-click (desktop)
    pad.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.onModeToggle && clipId) this.onModeToggle(pad.dataset.clipId);
    });

    // Double-tap (mobile)
    let lastTap = 0;
    pad.addEventListener('pointerup', (e) => {
      const now = Date.now();
      if (now - lastTap < 300) {
        // Double tap
        if (this.onModeToggle && pad.dataset.clipId) {
          this.onModeToggle(pad.dataset.clipId);
        }
        lastTap = 0;
      } else {
        lastTap = now;
      }
    });
  }

  // --- Voice-clip delete button ---

  // A small "×" in the pad's corner, shown on user (voice) pads. Revealed on
  // hover on desktop, always visible on touch (see style.css). Pointer/mouse/
  // touch starts are swallowed so the click neither starts a drag nor toggles
  // the pad mode; only the click fires the delete callback.
  _addDeleteButton(pad, clipId) {
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'pad-delete';
    del.textContent = '×';
    del.title = 'Delete this voice clip';
    del.setAttribute('aria-label', 'Delete this voice clip');
    // Swallow every pointer/mouse/touch step on the button so it never starts a
    // pad drag (mousedown/touchstart) nor feeds the pad's double-tap mode-toggle
    // detector (pointerup) — only the click below acts.
    for (const ev of ['pointerdown', 'mousedown', 'touchstart', 'pointerup']) {
      del.addEventListener(ev, (e) => { e.stopPropagation(); }, { passive: false });
    }
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (this.onPadDelete) this.onPadDelete(clipId);
    });
    pad.appendChild(del);
  }

  // A small "✎" next to the × on user (voice) pads. Tapping it turns the clip's
  // name into an inline text field so the visitor can rename it (the default is
  // "my thought N"). Pointer steps are swallowed like the × so it never starts a
  // drag or toggles the pad mode.
  _addRenameButton(pad, clipId) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pad-rename';
    btn.textContent = '✎';
    btn.title = 'Rename this voice clip';
    btn.setAttribute('aria-label', 'Rename this voice clip');
    for (const ev of ['pointerdown', 'mousedown', 'touchstart', 'pointerup']) {
      btn.addEventListener(ev, (e) => { e.stopPropagation(); }, { passive: false });
    }
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this._beginInlineRename(pad, clipId);
    });
    pad.appendChild(btn);
  }

  // Swap the pad's .clip-label span for a text input, prefilled and selected.
  // Enter or blur commits (non-empty, changed) via onPadRename; Escape cancels.
  // The keyboard pad-trigger handler already ignores INPUT targets, so typing a
  // name never fires pads; pointer steps are swallowed so clicks stay in the box.
  _beginInlineRename(pad, clipId) {
    const labelEl = pad.querySelector('.clip-label');
    if (!labelEl || pad.querySelector('.clip-rename-input')) return;  // already editing
    const current = labelEl.textContent;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'clip-rename-input';
    input.value = current;
    input.maxLength = 40;
    for (const ev of ['pointerdown', 'mousedown', 'touchstart', 'pointerup', 'click', 'dblclick']) {
      input.addEventListener(ev, (e) => e.stopPropagation(), { passive: false });
    }
    labelEl.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      this._activeRename = null;
      const next = input.value.trim();
      const final = (commit && next) ? next : current;
      const span = document.createElement('span');
      span.className = 'clip-label';
      span.textContent = final;
      // The input is normally still in the pad. If a concurrent rebuild detached
      // it, replaceWith would be a no-op — fall back to whatever .clip-label the
      // rebuild placed so the label is never lost.
      if (input.parentElement) input.replaceWith(span);
      else { const ex = pad.querySelector('.clip-label'); if (ex) ex.textContent = final; }
      if (commit && next && next !== current && this.onPadRename) this.onPadRename(clipId, next);
    };
    this._activeRename = { finish };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  }

  // Commit an open inline rename editor, if any. Called before mutations that
  // rebuild a pad (e.g. swapPads) so the editor's input is never orphaned.
  _finishActiveRename() {
    if (this._activeRename) this._activeRename.finish(true);
  }

  // --- Drag & Drop ---

  _attachDrag(pad, key) {
    let holdTimer = null;

    const startDrag = (startX, startY) => {
      const clipId = pad.dataset.clipId;
      if (!clipId) return; // Can't drag empty pads

      // Create floating clone
      const clone = pad.cloneNode(true);
      clone.classList.add('dragging');
      clone.style.position = 'fixed';
      clone.style.left = `${startX - 40}px`;
      clone.style.top = `${startY - 35}px`;
      clone.style.zIndex = '200';
      clone.style.pointerEvents = 'none';
      document.body.appendChild(clone);

      // Mark original as placeholder
      pad.classList.add('drag-placeholder');

      this._dragState = { fromKey: key, clone, pad };
    };

    const moveDrag = (x, y) => {
      if (!this._dragState) return;
      this._dragState.clone.style.left = `${x - 40}px`;
      this._dragState.clone.style.top = `${y - 35}px`;
    };

    const endDrag = (x, y) => {
      if (!this._dragState) return;

      const { fromKey, clone, pad: origPad } = this._dragState;

      // Remove clone
      clone.remove();
      origPad.classList.remove('drag-placeholder');

      // Dropped on another pad? Swap the two.
      const target = document.elementFromPoint(x, y);
      const targetPad = target?.closest('.pad');
      if (targetPad && targetPad !== origPad) {
        // Find the key for this pad
        for (const [k, p] of this.keyToPad) {
          if (p === targetPad) {
            if (this.onPadSwap) this.onPadSwap(fromKey, k);
            break;
          }
        }
      }

      this._dragState = null;
    };

    // Mouse events
    pad.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return; // Left click only
      const sx = e.clientX, sy = e.clientY;
      holdTimer = setTimeout(() => startDrag(sx, sy), 200);

      const onMove = (e) => moveDrag(e.clientX, e.clientY);
      const onUp = (e) => {
        clearTimeout(holdTimer);
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (this._dragState) endDrag(e.clientX, e.clientY);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // Touch events
    pad.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      const sx = touch.clientX, sy = touch.clientY;
      holdTimer = setTimeout(() => {
        e.preventDefault();
        startDrag(sx, sy);
      }, 200);

      const onMove = (e) => {
        if (!this._dragState) return;
        e.preventDefault();
        const t = e.touches[0];
        moveDrag(t.clientX, t.clientY);
      };
      const onEnd = (e) => {
        clearTimeout(holdTimer);
        pad.removeEventListener('touchmove', onMove);
        pad.removeEventListener('touchend', onEnd);
        if (this._dragState) {
          const t = e.changedTouches[0];
          endDrag(t.clientX, t.clientY);
        }
      };
      pad.addEventListener('touchmove', onMove, { passive: false });
      pad.addEventListener('touchend', onEnd);
    }, { passive: false });
  }
}
