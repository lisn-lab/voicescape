import { AudioEngine } from './audio.js?v=2';
import { InputHandler } from './input.js';
import { UIRenderer } from './ui.js';
import { SessionRecorder } from './session.js';
import { BlobStore } from './storage.js';
import { Visualizer } from './visualizer.js';
import { SeekBar } from './seekbar.js';
import { Tutorial } from './tutorial.js?v=2';
import { share } from './contribute.js';
import { processVoiceRecording } from './voice-processing.js';
import './supabase-config.js';  // side-effect: signs in anonymously on load

class App {
  constructor() {
    this.audio = new AudioEngine();
    this.input = new InputHandler();
    this.ui = new UIRenderer(document.getElementById('pad-container'));
    this.session = new SessionRecorder();
    this.storage = new BlobStore();
    this.visualizer = new Visualizer(document.getElementById('visualizer'));
    this.seekbar = new SeekBar(this.audio);
    this.tutorial = new Tutorial(this);
    this.manifest = null;
    this.clips = [];
  }

  async init() {
    try {
      // Ensure AudioContext is resumed on any user gesture
      const resumeAudio = async () => {
        await Tone.start();
        // See audio.js start(): move off the iOS ringer channel so the mute
        // switch doesn't silence playback. Set on first gesture too, since pads
        // can be auditioned before Play is pressed.
        try {
          if (navigator.audioSession) navigator.audioSession.type = 'playback';
        } catch (e) { /* unsupported — fine */ }
        document.removeEventListener('click', resumeAudio);
        document.removeEventListener('keydown', resumeAudio);
      };
      document.addEventListener('click', resumeAudio);
      document.addEventListener('keydown', resumeAudio);

      // Init storage
      await this.storage.init();

      // Load manifest
      const resp = await fetch('clips.json');
      this.manifest = await resp.json();
      this.clips = [...this.manifest.clips];

      // Init audio engine
      await this.audio.init(this.manifest);

      // Init visualizer
      this.visualizer.init(this.audio.getAnalyser());

      // Init background seek bar
      this.seekbar.init();

      // Restore custom voice clips from IndexedDB + localStorage metadata
      const customClipsMeta = JSON.parse(localStorage.getItem('voicescape-custom-clips') || '[]');
      for (const meta of customClipsMeta) {
        const blob = await this.storage.loadBlob(meta.idbKey);
        if (blob) {
          await this.audio.addCustomClip(meta.id, blob, meta.type === 'loop');
          this.input.addKey(meta.key, meta.id);
          this.clips.push(meta);
          console.log(`Restored voice clip "${meta.label}" on key [${meta.key.toUpperCase()}]`);
        }
      }

      // Apply clip mode overrides from localStorage
      // New format: 'loop' | '1x' | '2x' | '3x' | '4x'
      // Old format: 'loop' | 'oneshot'  (migrated to '1x' on load)
      const modeOverrides = JSON.parse(localStorage.getItem('voicescape-clip-modes') || '{}');
      for (const [clipId, raw] of Object.entries(modeOverrides)) {
        const stored = raw === 'oneshot' ? '1x' : raw;
        const { mode, repeat } = this._decodeClipMode(stored);
        this.audio.setClipMode(clipId, mode, repeat);
        // Update clip info so UI renders correct colour and dot count
        const clip = this.clips.find(c => c.id === clipId);
        if (clip) {
          clip.type = mode;
          clip.repeat = repeat;
        }
      }

      // Apply key binding overrides from localStorage
      const keyOverrides = JSON.parse(localStorage.getItem('voicescape-key-overrides') || '{}');
      if (Object.keys(keyOverrides).length > 0) {
        // Rebuild keymap from overrides
        for (const [key, clipId] of Object.entries(keyOverrides)) {
          if (clipId) this.input.addKey(key, clipId);
          else this.input.removeKey(key);
        }
      }

      // Init input handler
      this.input.init(this.clips);

      // Render UI
      this.ui.render(this.clips, this.input.mode);
      this.ui.updateBPM(this.manifest.bpm);

      // Re-render UI if custom clips were restored
      if (customClipsMeta.length > 0) {
        this.ui.render(this.clips, this.input.mode);
      }

      // Wire: input -> audio + session
      this.input.onPadTrigger = (clipId) => this._onPadTrigger(clipId);

      // Wire: input mode toggle -> audio + UI + persist
      this.input.onPadModeToggle = (clipId) => this._onPadModeToggle(clipId);

      // Wire: audio state changes -> UI
      this.audio.onClipStateChange = (clipId, state) => {
        this.ui.setPadState(clipId, state);
      };

      // Wire: touch pads -> input handler
      this.ui.onTouchTrigger = (clipId) => {
        this.input.handleTouchTrigger(clipId);
      };

      // Wire: UI mode toggle (right-click / double-tap)
      this.ui.onModeToggle = (clipId) => this._onPadModeToggle(clipId);

      // Wire: UI drag & drop (drag a pad onto another to swap their positions)
      this.ui.onPadSwap = (fromKey, toKey) => this._onPadSwap(fromKey, toKey);

      // Wire: per-pad delete + rename buttons (voice clips only)
      this.ui.onPadDelete = (clipId) => this._deleteVoiceClip(clipId);
      this.ui.onPadRename = (clipId, name) => this._renameVoiceClip(clipId, name);

      // Transport controls
      document.getElementById('play-btn').addEventListener('click', () => this._togglePlay());

      // REC button
      document.getElementById('rec-btn').addEventListener('click', () => this._toggleRecord());

      // "New jam" — discard the current performance + start fresh.
      document.getElementById('new-jam-btn').addEventListener('click', () => this._newJam());

      // Voice clip recording — single button toggles record / stop+autosave.
      document.getElementById('record-voice-btn').addEventListener('click', () => this._toggleVoiceRecord());

      // Mode toggle for ambiguous devices
      const toggleBtn = document.getElementById('mode-toggle-btn');
      if (toggleBtn && navigator.maxTouchPoints > 0) {
        toggleBtn.classList.remove('hidden');
        toggleBtn.textContent = this.input.mode === 'keyboard'
          ? 'Switch to Touch Grid'
          : 'Switch to Keyboard';

        toggleBtn.addEventListener('click', () => {
          const newMode = this.input.mode === 'keyboard' ? 'touch' : 'keyboard';
          this.input.switchMode(newMode);
          this.ui.render(this.clips, newMode);
          this._rewireUI();
          toggleBtn.textContent = newMode === 'keyboard'
            ? 'Switch to Touch Grid'
            : 'Switch to Keyboard';
        });
      }

      this.tutorial.init();

      console.log('Voicescape ready!');
    } catch (err) {
      console.error('Init failed:', err);
    }
  }

  _rewireUI() {
    this.ui.onTouchTrigger = (clipId) => this.input.handleTouchTrigger(clipId);
    this.ui.onModeToggle = (clipId) => this._onPadModeToggle(clipId);
    this.ui.onPadSwap = (fromKey, toKey) => this._onPadSwap(fromKey, toKey);
    this.ui.onPadDelete = (clipId) => this._deleteVoiceClip(clipId);
    this.ui.onPadRename = (clipId, name) => this._renameVoiceClip(clipId, name);
  }

  _onPadTrigger(clipId) {
    // Transport stopped: audition the clip once (immediate playback, no
    // recording) so any pad — including a voice clip just recorded — makes a
    // sound when pressed. Without this, pads were silent until Play was hit.
    if (!this.audio.playing) {
      this.audio.auditionClip(clipId);
      return;
    }
    const action = this.audio.triggerClip(clipId);
    if (action) {
      const repeat = this.audio.repeatCounts.get(clipId) || 1;
      this.session.recordEvent(clipId, action, this.audio.getTransportTime(), repeat);
    }
  }

  // --- Record toggle (Jam vs Record) ---

  async _togglePlay(suppressAutoExport = false) {
    const btn = document.getElementById('play-btn');
    const recBtn = document.getElementById('rec-btn');

    if (!this.audio.playing) {
      // Reset transport position to 0 + clear any leftover scheduled events
      // BEFORE we touch the schedule. Otherwise a previous playback can leave
      // stale callbacks queued, and replay events at the new schedule's start
      // get dropped because the transport is already past them.
      Tone.getTransport().cancel();
      Tone.getTransport().position = 0;

      const isReplay = this.session.events.length > 0 && !this.session.recording;

      if (isReplay) {
        // Schedule playback BEFORE starting the transport so events at t=0
        // and shortly after actually fire.
        this.session.schedulePlayback(this.audio);
      }

      await this.audio.start();
      btn.textContent = 'Stop';
      recBtn.disabled = false;
      this.visualizer.start();

      if (!isReplay && this.session.events.length === 0 && !this.session.recording) {
        // Fresh jam: capture the performance automatically so Export works
        // with no extra clicks.
        this.session.startRecording(false, 0);
        recBtn.classList.add('rec-active');
        this._showToast('Recording — press Stop when you\'re done to download the MP3.', 4500);
      } else if (isReplay) {
        this._showToast(`Replaying ${this.session.events.length} taps.`);
      }
      this._refreshTransportUI();
    } else {
      const wasRecording = this.session.recording;
      const eventsCount = this.session.events.length;
      // Capture the full performance length BEFORE stop() resets the transport,
      // so export render duration covers loops left running to the end.
      this.session.performanceDuration = this.audio.getTransportTime();

      this.audio.stop();
      btn.textContent = 'Play';
      recBtn.disabled = true;
      recBtn.classList.remove('rec-active');
      this.visualizer.stop();

      if (wasRecording) {
        this.session.stopRecording();
      }

      Tone.getTransport().cancel();
      for (const clipId of this.ui.pads.keys()) {
        this.ui.setPadState(clipId, 'idle');
      }

      // On Stop after a fresh jam (not after replay): render the MP3 once and
      // open the share card, which offers a click-to-download link for that blob
      // plus the option to share anonymously. Mental model: Play → jam → Stop →
      // share card with "Download your MP3" + "want to share it?".
      if (wasRecording && eventsCount > 0 && !suppressAutoExport) {
        setTimeout(() => this._finishJam(), 50);
      } else if (eventsCount > 0 && !suppressAutoExport) {
        this._showToast('Stopped. Play to replay, or New jam to start over.', 4500);
      }
      this._refreshTransportUI();
    }
  }

  // Refresh Play button label + New-jam button visibility based on whether
  // the session currently holds captured events. Called after every Play /
  // Stop / New jam / session load.
  _refreshTransportUI() {
    const playBtn = document.getElementById('play-btn');
    const newBtn = document.getElementById('new-jam-btn');
    const hasEvents = this.session.events.length > 0;
    if (this.audio.playing) {
      playBtn.textContent = 'Stop';
    } else {
      playBtn.textContent = hasEvents ? 'Replay' : 'Play';
    }
    if (hasEvents && !this.audio.playing) {
      newBtn.classList.remove('hidden');
    } else {
      newBtn.classList.add('hidden');
    }
  }

  _newJam() {
    if (this.audio.playing) {
      // Roll the stop path so audio is silenced cleanly. Recording state goes
      // false, transport is canceled. Suppress the auto-export — New jam is a
      // discard, not a Stop, so it must not queue an MP3 of what we're clearing.
      this._togglePlay(true);
    }
    this.session.events = [];
    this.session.recording = false;
    this.session.performanceDuration = 0;
    document.getElementById('rec-btn').classList.remove('rec-active');
    this._refreshTransportUI();
    this._showToast('Cleared. Press Play to start a new jam.');
  }

  _toggleRecord() {
    const recBtn = document.getElementById('rec-btn');

    if (!this.session.recording) {
      // Start recording — keep existing events if any (overdub)
      const offset = this.audio.getTransportTime();
      this.session.startRecording(this.session.events.length > 0, offset);
      recBtn.classList.add('rec-active');
      console.log(`Recording started at offset ${offset.toFixed(2)}s`);
    } else {
      // Stop recording — keep events
      this.session.recording = false;
      recBtn.classList.remove('rec-active');
      console.log(`Recording stopped. ${this.session.events.length} events captured.`);
    }
  }

  // --- Mode cycle: loop → 1× → 2× → 3× → 4× → loop ---

  _onPadModeToggle(clipId) {
    const player = this.audio.players.get(clipId);
    if (!player) return;

    // Read current encoded mode from audio engine state
    const curMode = this.audio.clipModes.get(clipId) || 'oneshot';
    const curRepeat = this.audio.repeatCounts.get(clipId) || 1;
    const curEncoded = curMode === 'loop' ? 'loop' : `${curRepeat}x`;

    // Cycle order
    const CYCLE = ['loop', '1x', '2x', '3x', '4x'];
    const idx = CYCLE.indexOf(curEncoded);
    const nextEncoded = CYCLE[(idx + 1) % CYCLE.length];

    const { mode: newMode, repeat: newRepeat } = this._decodeClipMode(nextEncoded);

    this.audio.setClipMode(clipId, newMode, newRepeat);

    // Preserve 'user' type tagging for user-recorded clips
    const clip = this.clips.find(c => c.id === clipId);
    const padType = clip?.userRecorded ? 'user' : newMode;
    this.ui.setPadType(clipId, padType);
    this.ui.setPadRepeat(clipId, newRepeat);

    // Update clip info (used for re-renders)
    if (clip) {
      clip.type = newMode;
      clip.repeat = newRepeat;
    }

    // Persist override using encoded form
    const overrides = JSON.parse(localStorage.getItem('voicescape-clip-modes') || '{}');
    overrides[clipId] = nextEncoded;
    localStorage.setItem('voicescape-clip-modes', JSON.stringify(overrides));

    console.log(`Clip ${clipId} → ${nextEncoded}`);
  }

  _decodeClipMode(encoded) {
    if (encoded === 'loop') return { mode: 'loop', repeat: 1 };
    const match = /^([1-4])x$/.exec(encoded);
    if (match) return { mode: 'oneshot', repeat: parseInt(match[1], 10) };
    return { mode: 'oneshot', repeat: 1 };
  }

  // --- Drag & drop ---

  _onPadSwap(fromKey, toKey) {
    this.input.swapKeys(fromKey, toKey);
    this.ui.swapPads(fromKey, toKey);
    this._persistKeyOverrides();
    console.log(`Swapped keys [${fromKey.toUpperCase()}] ↔ [${toKey.toUpperCase()}]`);
  }

  // --- Voice clip deletion ---

  async _deleteVoiceClip(clipId) {
    const clip = this.clips.find(c => c.id === clipId);
    if (!clip || !clip.userRecorded) return;
    if (!confirm(`Delete voice clip "${clip.label}"? This can't be undone.`)) return;
    await this._purgeVoiceClip(clip);
    this._showToast(`Deleted "${clip.label}".`);
  }

  // Rename a user-recorded voice clip. The label is local-only (never sent to
  // Supabase) — it just helps the visitor find a clip on the board. The pad's
  // visible label was already swapped in by the inline editor; here we persist
  // the new name everywhere it lives: the in-memory clip, the session's custom-
  // clip entry, and the localStorage metadata that init() restores from on reload.
  _renameVoiceClip(clipId, newName) {
    const clip = this.clips.find(c => c.id === clipId);
    if (!clip || !clip.userRecorded) return;
    const name = (newName || '').trim();
    if (!name || name === clip.label) return;
    clip.label = name;

    const sessionClip = this.session.customClips.find(c => c.id === clipId);
    if (sessionClip) sessionClip.label = name;

    const meta = JSON.parse(localStorage.getItem('voicescape-custom-clips') || '[]');
    const entry = meta.find(m => m.id === clipId);
    if (entry) { entry.label = name; localStorage.setItem('voicescape-custom-clips', JSON.stringify(meta)); }

    this._showToast(`Renamed to "${name}".`);
    console.log(`Renamed voice clip [${clipId}] to "${name}"`);
  }

  // Fully remove a user-recorded voice clip from every place it lives: the live
  // Tone.Player, the keymap, the pad, the in-memory clip list, the session's
  // custom-clip list, the IndexedDB blob, and all localStorage traces (custom-
  // clips metadata, clip-mode override, key override). Without the storage half
  // of this, the clip reappears on the next reload because init() restores it
  // from voicescape-custom-clips.
  async _purgeVoiceClip(clip) {
    const clipId = clip.id;

    // Resolve the key the clip CURRENTLY occupies from the live keymap. clip.key
    // is set at record time and not updated by drag-swap (swap only rewrites the
    // keymap), so using it directly would unbind the wrong pad after a swap.
    let currentKey = clip.key;
    for (const [k, id] of this.input.keymap) {
      if (id === clipId) { currentKey = k; break; }
    }

    // Cancel any still-pending loop start/stop scheduled on the transport for
    // this clip, BEFORE disposing the player — otherwise that callback fires
    // later against a disposed node and throws inside the transport tick.
    const pending = this.audio.pendingLoopActions.get(clipId);
    if (pending) {
      try { Tone.getTransport().clear(pending.transportId); } catch (e) { /* already cleared */ }
      this.audio.pendingLoopActions.delete(clipId);
    }

    const player = this.audio.players.get(clipId);
    if (player) {
      try { player.stop(); } catch (e) { /* not started */ }
      try { player.dispose(); } catch (e) { /* already disposed */ }
    }
    this.audio.players.delete(clipId);
    this.audio.clipModes.delete(clipId);
    this.audio.repeatCounts.delete(clipId);
    this.audio.activeLoops.delete(clipId);

    this.input.removeKey(currentKey);
    this.ui.clearPad(currentKey);
    this.clips = this.clips.filter(c => c.id !== clipId);
    this.session.customClips = this.session.customClips.filter(c => c.id !== clipId);
    // Drop captured performance events that referenced this clip, so a later
    // export/replay does not hit a missing buffer and render a silent gap.
    this.session.events = this.session.events.filter(e => e.clipId !== clipId);

    if (clip.idbKey) {
      try { await this.storage.deleteBlob(clip.idbKey); }
      catch (e) { console.warn(`Failed to delete blob ${clip.idbKey}:`, e); }
    }

    const meta = JSON.parse(localStorage.getItem('voicescape-custom-clips') || '[]')
      .filter(m => m.id !== clipId);
    localStorage.setItem('voicescape-custom-clips', JSON.stringify(meta));

    const modes = JSON.parse(localStorage.getItem('voicescape-clip-modes') || '{}');
    if (clipId in modes) {
      delete modes[clipId];
      localStorage.setItem('voicescape-clip-modes', JSON.stringify(modes));
    }

    this._persistKeyOverrides();
    console.log(`Deleted voice clip ${clipId} (was on key [${currentKey.toUpperCase()}])`);
  }

  _persistKeyOverrides() {
    const overrides = {};
    for (const [key, clipId] of this.input.keymap) {
      overrides[key] = clipId;
    }
    localStorage.setItem('voicescape-key-overrides', JSON.stringify(overrides));
  }

  // --- Voice clip recording (mic → pad) ---
  //
  // Single-button toggle. Press once to start; the button turns red and
  // shows a live timer. Press again to stop — the captured audio is auto-
  // saved to the next empty key as a one-shot, and a toast tells you where
  // it landed. Alt+key cycles the new pad's playback mode.
  //
  // Distinct from the REC button up top, which captures the *performance
  // timeline* (which pads got hit when) for Export / Share.

  async _toggleVoiceRecord() {
    if (this._savingVoiceClip) return;   // previous clip still being processed/saved
    if (this._voiceRecording) {
      await this._stopAndSaveVoiceClip();
    } else {
      await this._beginVoiceClipCapture();
    }
  }

  async _beginVoiceClipCapture() {
    const success = await this.audio.startMicRecording();
    if (!success) {
      this._showToast('Microphone access denied. Allow it in browser settings and try again.');
      return;
    }
    this._voiceRecording = true;
    this._voiceRecordStartedAt = Date.now();
    this._renderVoiceRecordButton();
    this._voiceRecordTimer = setInterval(() => this._renderVoiceRecordButton(), 200);
  }

  async _stopAndSaveVoiceClip() {
    clearInterval(this._voiceRecordTimer);
    this._voiceRecordTimer = null;
    this._voiceRecording = false;
    // Recording has stopped but processing + save are still ahead (up to ~1s).
    // Block a new capture during that window (see _toggleVoiceRecord) and show
    // the button as busy; the finally restores it on every exit, even a throw.
    this._savingVoiceClip = true;
    const recBtn = document.getElementById('record-voice-btn');
    if (recBtn) { recBtn.disabled = true; recBtn.textContent = 'Saving…'; }

    try {
      const rawBlob = await this.audio.stopMicRecording();
      if (!rawBlob) return;

      // Trim the silence and match the loudness to the seed clips. Fall back to
      // the raw recording if processing fails so a glitch never loses the clip.
      let blob = rawBlob;
      try {
        blob = await processVoiceRecording(rawBlob, Tone.getContext().rawContext);
      } catch (err) {
        console.warn('Voice processing failed; keeping the raw recording:', err);
      }

      const key = this.input.getNextAvailableKey();
      if (!key) {
        this._showToast('All keys are full — delete one of your voice clips with its × button to free a key, then record again.');
        return;
      }

      // Auto-name: "my thought", "my thought 2", "my thought 3", ...
      const baseName = 'my thought';
      let n = 1;
      let name = baseName;
      while (this.clips.some(c => c.label === name)) {
        n++;
        name = `${baseName} ${n}`;
      }

      const clipId = 'user_' + Date.now().toString(36);
      const idbKey = 'voice_' + clipId;

      await this.storage.saveBlob(idbKey, blob);
      await this.audio.addCustomClip(clipId, blob, false);
      this.input.addKey(key, clipId);

      const clipInfo = {
        id: clipId,
        label: name,
        type: 'oneshot',
        repeat: 1,
        key: key,
        userRecorded: true,
        idbKey: idbKey,
      };
      this.clips.push(clipInfo);
      this.ui.addPad(key, clipInfo);
      this.session.addCustomClip({ id: clipId, label: name, type: 'oneshot', idbKey: idbKey });

      const customClipsMeta = JSON.parse(localStorage.getItem('voicescape-custom-clips') || '[]');
      customClipsMeta.push(clipInfo);
      localStorage.setItem('voicescape-custom-clips', JSON.stringify(customClipsMeta));

      const padEl = this.ui.keyToPad.get(key);
      if (padEl) {
        padEl.classList.add('just-added');
        setTimeout(() => padEl.classList.remove('just-added'), 1200);
      }
      this._showToast(`Saved to [${key.toUpperCase()}] · Alt+${key.toUpperCase()} cycles loop / 1× / 2× / 3× / 4×`);
      console.log(`Voice clip "${name}" added to key [${key.toUpperCase()}]`);
    } finally {
      this._savingVoiceClip = false;
      if (recBtn) recBtn.disabled = false;
      this._renderVoiceRecordButton();
    }
  }

  _renderVoiceRecordButton() {
    const btn = document.getElementById('record-voice-btn');
    if (!btn) return;
    if (this._voiceRecording) {
      const elapsed = Math.floor((Date.now() - this._voiceRecordStartedAt) / 1000);
      const m = Math.floor(elapsed / 60);
      const s = (elapsed % 60).toString().padStart(2, '0');
      btn.textContent = `Stop · ${m}:${s}`;
      btn.classList.add('voice-recording');
    } else {
      btn.textContent = 'Record your own voice';
      btn.classList.remove('voice-recording');
    }
  }

  _showToast(message, durationMs = 3500) {
    const el = document.getElementById('voicescape-toast');
    if (!el) return;
    el.textContent = message;
    el.classList.remove('hidden');
    // Force reflow so the transition fires the first time too.
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.classList.add('hidden'), 300);
    }, durationMs);
  }

  // --- Export ---

  // Total render length (seconds) for the offline export, shared by Export and
  // Share. Accounts for ratchet tails on one-shots and floors at the captured
  // performance length so a loop started and left running isn't truncated to
  // its start-event time.
  _computeRenderDuration() {
    const barSec = 60 / this.audio.bpm * 4;
    let maxEnd = 0;
    for (const event of this.session.events) {
      const player = this.audio.players.get(event.clipId);
      const clipDur = player?.buffer?.duration || 2;
      let endTime;
      if (event.action === 'trigger') {
        // Ratchet places N hits across one bar; the last hit's tail extends
        // clipDur past its start at (N-1)/N of one bar.
        const r = event.repeat || 1;
        const interval = barSec / r;
        endTime = event.time + (r - 1) * interval + clipDur;
      } else if (event.action === 'start') {
        // A loop's 'start' marks where it begins, not where it ends — the floor
        // below extends it to the full performance length.
        endTime = event.time + clipDur;
      } else {
        endTime = event.time;
      }
      if (endTime > maxEnd) maxEnd = endTime;
    }
    maxEnd = Math.max(maxEnd, this.session.performanceDuration || 0);
    return maxEnd + 1;
  }

  // --- Finish a jam: show the share card immediately, render in the background ---
  //
  // The card must not wait on the render — for a long performance the offline
  // bounce + MP3 encode can take several seconds. So we kick the render off as a
  // promise and hand it to the card. The card shows "Preparing your MP3…", then a
  // click-to-download link when it resolves; the Share button awaits it only if
  // the visitor submits before it finishes.

  async _finishJam() {
    if (this.session.events.length === 0) return;

    const events = this.session.events.slice();   // snapshot — a new jam may follow
    const duration = this._computeRenderDuration();
    const offset = this.audio.jamStartOffset;

    // Render the MP3 in the background. It is NOT auto-downloaded — the share card
    // shows a "Download" link the visitor can click if they want to keep it.
    const resultPromise = this.audio.exportComposition(events, duration, offset)
      .catch((err) => { console.error('Export failed:', err); return null; });

    try {
      await share(resultPromise);
    } catch (err) {
      console.error('Share card failed', err);
    }
  }

}

const app = new App();
app.init();
window.app = app;
