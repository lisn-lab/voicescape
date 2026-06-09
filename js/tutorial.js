// Tutorial — welcome modal, guided walkthrough, help button wiring.

const SEEN_FLAG = 'voicescape-seen-welcome';

const STEPS = [
  {
    target: () => document.getElementById('play-btn'),
    desktop: '<strong>Press Play first.</strong> The pads only work while the background music is running — no Play, no jam.',
    touch: '<strong>Tap Play first.</strong> The pads only work while the background music is running — no Play, no jam.',
  },
  {
    target: () => findPadForKey('q'),
    desktop: 'Press an <span style="color:#f59e0b;font-weight:600;">orange</span> key — it plays a loop. Press once to start, press again to stop.',
    touch: 'Tap an <span style="color:#f59e0b;font-weight:600;">orange</span> pad — it plays a loop. Tap to start, tap again to stop.',
  },
  {
    target: () => findPadForKey('w'),
    desktop: 'Press a <span style="color:#06b6d4;font-weight:600;">blue</span> key — each press fires the clip. The dots show beats per press: 1 dot = 1 beat, 4 dots = 4 beats squeezed into one bar.',
    touch: 'Tap a <span style="color:#06b6d4;font-weight:600;">blue</span> pad — each tap fires the clip. The dots show beats per press: 1 dot = 1 beat, 4 dots = 4 beats squeezed into one bar.',
  },
  {
    target: () => findPadForKey('r'),
    desktop: 'Right-click any pad to cycle its mode — <span style="color:#f59e0b;font-weight:600;">orange</span> loop ↔ <span style="color:#06b6d4;font-weight:600;">blue</span> with 1, 2, 3, or 4 dots. Try it on this one.',
    touch: 'Double-tap any pad to cycle its mode — <span style="color:#f59e0b;font-weight:600;">orange</span> loop ↔ <span style="color:#06b6d4;font-weight:600;">blue</span> with 1, 2, 3, or 4 dots. Try it on this one.',
  },
  {
    target: () => document.getElementById('seek-bar'),
    desktop: 'See the slider under the visualiser? Drag it to start the background music from any point — you don\'t have to begin at the start.',
    touch: 'See the slider under the visualiser? Drag it to start the background music from any point — you don\'t have to begin at the start.',
  },
  {
    target: () => document.getElementById('record-voice-btn'),
    desktop: 'Want your own voice in the mix? Click <strong>Record your own voice</strong>, say something out loud, and your recording is saved onto a key — press it to play your own voice back like any other pad.',
    touch: 'Want your own voice in the mix? Tap <strong>Record your own voice</strong>, say something out loud, and your recording is saved onto a pad — tap it to play your own voice back like any other.',
  },
  {
    target: () => findPadForKey('a'),
    desktop: 'Rearrange the board: hold a pad and drag it onto another to swap where they sit.',
    touch: 'Rearrange the board: press and hold a pad, then drag it onto another to swap where they sit.',
  },
  {
    target: () => findPadForKey('s'),
    desktop: 'Your recorded clips get two buttons in the corner: <strong>✎</strong> renames it (otherwise they\'re all "my thought"), and <strong>×</strong> deletes it.',
    touch: 'Your recorded clips get two buttons in the corner: <strong>✎</strong> renames it (otherwise they\'re all "my thought"), and <strong>×</strong> deletes it.',
  },
  {
    target: () => document.getElementById('play-btn'),
    desktop: 'When you\'re done, press <strong>Stop</strong>. Your MP3 saves to your device, and you can share your thoughts with us.',
    touch: 'When you\'re done, tap <strong>Stop</strong>. Your MP3 saves to your device, and you can share your thoughts with us.',
  },
];

function findPadForKey(key) {
  const k = key.toLowerCase();
  for (const pad of document.querySelectorAll('.pad')) {
    const letterEl = pad.querySelector('.key-letter');
    if (letterEl && letterEl.textContent.trim().toLowerCase() === k) return pad;
  }
  return null;
}

export class Tutorial {
  constructor(app) {
    this.app = app;
    this.welcomeEl = null;
    this.tourEl = null;
    this.currentStep = -1;
  }

  init() {
    this.welcomeEl = document.getElementById('welcome-overlay');
    this.tourEl = document.getElementById('tour-overlay');

    // Keep the step count on the welcome button in sync with STEPS (no drift).
    const tourBtn = document.getElementById('welcome-tour-btn');
    if (tourBtn) tourBtn.textContent = `Take the tour · ${STEPS.length} quick steps`;

    // Welcome modal CTAs
    document.getElementById('welcome-tour-btn').addEventListener('click', () => {
      this._hideWelcome();
      this.startTour();
    });

    document.getElementById('welcome-skip-btn').addEventListener('click', () => {
      this.dismiss();
    });

    // Help button always re-opens the welcome modal
    document.getElementById('help-btn').addEventListener('click', () => {
      this.showWelcome();
    });

    // Tour navigation
    document.getElementById('tour-next-btn').addEventListener('click', async () => {
      // Step 1 = "Press Play"; unlock AudioContext here in case the user advances
      // via Next rather than clicking the actual Play button.
      if (this.currentStep === 0 && typeof Tone !== 'undefined') {
        try { await Tone.start(); } catch (e) { console.warn('Tone.start() failed', e); }
      }
      this.nextStep();
    });

    document.getElementById('tour-back-btn').addEventListener('click', () => {
      this.prevStep();
    });

    document.getElementById('tour-skip-btn').addEventListener('click', () => {
      this._endTour();
    });

    // Re-position tooltip and spotlight on viewport resize
    window.addEventListener('resize', () => {
      if (this.currentStep >= 0) {
        const target = STEPS[this.currentStep].target();
        if (target) {
          this._positionSpotlight(target);
          this._positionTooltip(target);
        }
      }
    });

    // First-visit auto-show
    if (!this._hasSeenWelcome()) {
      this.showWelcome();
    }
  }

  showWelcome() {
    this.welcomeEl.classList.remove('hidden');
  }

  _hideWelcome() {
    this.welcomeEl.classList.add('hidden');
  }

  startTour() {
    this.tourEl.classList.remove('hidden');
    this.currentStep = 0;
    this._renderStep();
  }

  dismiss() {
    this._hideWelcome();
    this._markSeen();
  }

  _hasSeenWelcome() {
    return localStorage.getItem(SEEN_FLAG) === 'true';
  }

  _markSeen() {
    localStorage.setItem(SEEN_FLAG, 'true');
  }

  _positionSpotlight(targetEl) {
    const spot = document.getElementById('spotlight');
    const rect = targetEl.getBoundingClientRect();
    const pad = 6; // visual breathing room around the target
    spot.style.top = (rect.top - pad) + 'px';
    spot.style.left = (rect.left - pad) + 'px';
    spot.style.width = (rect.width + pad * 2) + 'px';
    spot.style.height = (rect.height + pad * 2) + 'px';
  }

  _positionTooltip(targetEl) {
    const tip = document.getElementById('tour-tooltip');
    const rect = targetEl.getBoundingClientRect();
    const margin = 12;
    const viewportPad = 16;

    // Measure tooltip after making it briefly visible to read its size.
    // Clear inline `display` after measuring so CSS retains control.
    tip.style.visibility = 'hidden';
    tip.style.display = 'flex';
    const tipRect = tip.getBoundingClientRect();
    tip.style.display = '';
    tip.style.visibility = 'visible';

    // Vertical: prefer below, fall back to above if no room
    let top = rect.bottom + margin;
    if (top + tipRect.height > window.innerHeight - viewportPad) {
      top = rect.top - margin - tipRect.height;
    }
    // If still off-screen (very tall target), pin to viewport top
    if (top < viewportPad) top = viewportPad;

    // Horizontal: centre on target, clamp to viewport edges
    let left = rect.left + (rect.width / 2) - (tipRect.width / 2);
    if (left < viewportPad) left = viewportPad;
    if (left + tipRect.width > window.innerWidth - viewportPad) {
      left = window.innerWidth - viewportPad - tipRect.width;
    }

    tip.style.top = top + 'px';
    tip.style.left = left + 'px';
  }

  _renderStep() {
    const step = STEPS[this.currentStep];
    const target = step.target();
    if (!target) {
      console.warn(`Tutorial: target for step ${this.currentStep + 1} not found, skipping.`);
      return this.nextStep();
    }

    // Touch vs keyboard copy
    const mode = this.app.input?.mode || 'keyboard';
    const html = mode === 'touch' ? step.touch : step.desktop;
    document.getElementById('tour-text').innerHTML = html;

    // Progress dots
    const dotsEl = document.getElementById('tour-progress');
    dotsEl.innerHTML = STEPS.map((_, i) =>
      `<span class="dot${i === this.currentStep ? ' active' : ''}"></span>`
    ).join('');

    // Back button visibility
    const backBtn = document.getElementById('tour-back-btn');
    backBtn.disabled = this.currentStep === 0;

    // Next button label changes on last step
    const nextBtn = document.getElementById('tour-next-btn');
    nextBtn.textContent = this.currentStep === STEPS.length - 1 ? 'Done' : 'Next →';

    // Position spotlight + tooltip
    this._positionSpotlight(target);
    this._positionTooltip(target);
  }

  nextStep() {
    if (this.currentStep < STEPS.length - 1) {
      this.currentStep += 1;
      this._renderStep();
    } else {
      this._endTour();
    }
  }

  prevStep() {
    if (this.currentStep > 0) {
      this.currentStep -= 1;
      this._renderStep();
    }
  }

  _endTour() {
    this.currentStep = -1;
    this.tourEl.classList.add('hidden');
    this._markSeen();
  }
}
