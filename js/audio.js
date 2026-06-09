// Audio engine — Tone.js Transport, Players, Recording, Export

import { encodeMP3 } from './encoder.js';

// Loudness is matched to the seed clips AFTER recording, by RMS-normalizing the
// captured blob (see voice-processing.js) — that adapts to the mic and distance,
// which a fixed capture gain can't. The recorder still runs through a limiter so
// a hot mic can't bake clipped samples into the blob that processing can't undo.
const VOICE_RECORD_LIMIT = -1;   // dBFS ceiling for the capture safety limiter

export class AudioEngine {
  constructor() {
    this.ready = false;
    this.playing = false;
    this.players = new Map();
    this.activeLoops = new Set();
    this.clipModes = new Map();       // clipId -> 'loop' | 'oneshot'
    this.repeatCounts = new Map();    // clipId -> 1..4 (only meaningful for oneshot)
    // clipId -> { transportId, action: 'start'|'stop' } for loop actions
    // scheduled at the next beat. Used to cancel a still-pending action when
    // the user taps the same loop pad twice within one beat — without this,
    // both schedules fire at the same boundary and the loop stays silent.
    this.pendingLoopActions = new Map();
    this.backgroundPlayer = null;
    this.bpm = 120;
    this.quantisation = '4n';
    this.onClipStateChange = null;
    // Seconds into the background song where playback begins. Set by the seek
    // bar; jamStartOffset snapshots it at Play so the export reproduces the
    // background from where the jam began (mid-jam scrubs are live-only).
    this.backgroundStartOffset = 0;
    this.jamStartOffset = 0;
  }

  async init(manifest) {
    this.bpm = manifest.bpm;
    this.quantisation = manifest.quantisation || '4n';
    Tone.getTransport().bpm.value = this.bpm;

    this.backgroundPlayer = new Tone.Player({
      url: manifest.background,
      loop: true
    }).toDestination();

    for (const clip of manifest.clips) {
      const isLoop = clip.type === 'loop';
      const player = new Tone.Player({
        url: clip.file,
        loop: isLoop,
      }).toDestination();
      this.players.set(clip.id, player);
      this.clipModes.set(clip.id, isLoop ? 'loop' : 'oneshot');
      this.repeatCounts.set(clip.id, clip.repeat || 1);
    }

    await Tone.loaded();
    this.ready = true;
    console.log(`AudioEngine ready: ${this.players.size} clips loaded, BPM=${this.bpm}`);
  }

  async start() {
    await Tone.start();
    this.jamStartOffset = this.backgroundStartOffset;
    this.backgroundPlayer.unsync();
    this.backgroundPlayer.sync().start(0, this.backgroundStartOffset);
    Tone.getTransport().start();
    this.playing = true;
    // Transport restarts at 0, so any previous live-seek start time is stale.
    this._lastSeekAt = 0;
  }

  getSongDuration() {
    return (this.backgroundPlayer && this.backgroundPlayer.buffer && this.backgroundPlayer.buffer.loaded)
      ? this.backgroundPlayer.buffer.duration : 0;
  }

  getSongPosition() {
    const dur = this.getSongDuration();
    if (!dur) return 0;
    return (this.backgroundStartOffset + Tone.getTransport().seconds) % dur;
  }

  setBackgroundStartOffset(sec) {
    const dur = this.getSongDuration();
    this.backgroundStartOffset = dur ? Math.max(0, Math.min(sec, dur - 0.01)) : 0;
  }

  // Live re-seek while playing. Best-effort: only changes the live sound. The
  // export uses jamStartOffset (snapshotted at Play), so mid-jam scrubs are not
  // re-rendered into the MP3 (start-point-only, per the design decision).
  seekBackground(sec) {
    this.setBackgroundStartOffset(sec);
    if (this.playing && this.backgroundPlayer) {
      // Restart the synced loop from the new offset at a transport time that is
      // STRICTLY after the previous (re)start — Tone throws "start time must be
      // strictly greater than previous start time" otherwise, which fired on
      // ~24% of live scrubs and broke the seek. A small lead past the current
      // transport position covers a normal scrub; max() against the last start
      // covers rapid back-to-back seeks where the clock hasn't advanced yet
      // (reset to 0 in start(), so a fresh Play never schedules into the future).
      const at = Math.max(Tone.getTransport().seconds + 0.05, (this._lastSeekAt || 0) + 0.005);
      this._lastSeekAt = at;
      this.backgroundPlayer.unsync();
      try { this.backgroundPlayer.stop(); } catch (e) { /* not started */ }
      try {
        this.backgroundPlayer.sync().start(at, this.backgroundStartOffset);
      } catch (e) {
        console.warn('Live seek restart skipped:', e);
      }
    }
  }

  stop() {
    Tone.getTransport().stop();
    this.backgroundPlayer.unsync();
    this.backgroundPlayer.stop();
    // Force-silence every player — not just the active loops. Without this,
    // oneshots whose buffers were started just before Stop keep playing to
    // the end of their tails, producing a confusing "all clips at once"
    // wash right when the export starts.
    for (const player of this.players.values()) {
      try { player.stop(); } catch (e) { /* player wasn't started — fine */ }
    }
    this.activeLoops.clear();
    // Any not-yet-fired loop start/stop schedules are now moot because the
    // transport itself has been stopped + cleared. Drop the tracking so a
    // fresh Play starts each loop clean.
    this.pendingLoopActions.clear();
    this.playing = false;
  }

  triggerClip(clipId, overrideRepeat) {
    const player = this.players.get(clipId);
    if (!player || !this.playing) return;

    const mode = this.clipModes.get(clipId) || (player.loop ? 'loop' : 'oneshot');

    if (mode === 'loop') {
      // Cancel any still-pending start/stop for this clip from a previous tap
      // within the same beat. Without this, the new schedule races the old
      // one at the same boundary and the player ends up in an inconsistent
      // state — the visible "orange pad goes dark, no sound" symptom.
      const pending = this.pendingLoopActions.get(clipId);
      if (pending) {
        Tone.getTransport().clear(pending.transportId);
        this.pendingLoopActions.delete(clipId);
      }

      // Next quantise boundary in TRANSPORT time. Transport.schedule() expects a
      // time on the transport timeline, but Transport.nextSubdivision() returns an
      // AudioContext-domain time. Feeding that to schedule() pushed the start to
      // ~(context time when Play was pressed) seconds into the future — so the pad
      // lit up but the loop stayed silent until that delayed start eventually fired
      // (the "orange loop doesn't work" bug). Computing the boundary from
      // transport.seconds keeps the schedule time in the right domain.
      const beatSec = Tone.Time(this.quantisation).toSeconds();
      const tNow = Tone.getTransport().seconds;
      const nextBeat = Math.ceil((tNow + 1e-6) / beatSec) * beatSec;

      if (this.activeLoops.has(clipId)) {
        // Schedule stop at next beat boundary.
        const id = Tone.getTransport().schedule((time) => {
          player.stop(time);
          this.pendingLoopActions.delete(clipId);
        }, nextBeat);
        this.pendingLoopActions.set(clipId, { transportId: id, action: 'stop' });
        this.activeLoops.delete(clipId);
        if (this.onClipStateChange) this.onClipStateChange(clipId, 'idle');
        return 'stop';
      } else {
        // Schedule start at next beat boundary.
        const id = Tone.getTransport().schedule((time) => {
          player.start(time);
          this.pendingLoopActions.delete(clipId);
        }, nextBeat);
        this.pendingLoopActions.set(clipId, { transportId: id, action: 'start' });
        this.activeLoops.add(clipId);
        if (this.onClipStateChange) this.onClipStateChange(clipId, 'looping');
        return 'start';
      }
    } else {
      // One-shot ratchet: N hits evenly spaced across one bar at master BPM.
      // First hit fires immediately; subsequent hits at i * (1m / N) offsets.
      // If the clip is longer than the slot, the next hit retriggers it
      // (truncates the previous play) — that's the stutter effect.
      const repeat = overrideRepeat ?? (this.repeatCounts.get(clipId) || 1);
      const duration = player.buffer.duration;
      const barSec = Tone.Time('1m').toSeconds();
      const interval = barSec / repeat;
      const totalDur = (repeat - 1) * interval + duration;

      player.stop();
      player.loop = false;
      player.start();

      for (let i = 1; i < repeat; i++) {
        Tone.getTransport().scheduleOnce((time) => {
          player.stop(time);
          player.start(time);
        }, `+${i * interval}`);
      }

      if (this.onClipStateChange) this.onClipStateChange(clipId, 'playing');
      Tone.getTransport().scheduleOnce(() => {
        if (this.onClipStateChange) this.onClipStateChange(clipId, 'idle');
      }, `+${totalDur}`);
      return 'trigger';
    }
  }

  addCustomClip(clipId, audioBlob, isLoop) {
    const url = URL.createObjectURL(audioBlob);
    return new Promise((resolve) => {
      const player = new Tone.Player({
        url: url,
        loop: isLoop,
        onload: () => resolve()
      }).toDestination();
      this.players.set(clipId, player);
      this.clipModes.set(clipId, isLoop ? 'loop' : 'oneshot');
      this.repeatCounts.set(clipId, 1);
    });
  }

  setClipMode(clipId, mode, repeat = 1) {
    const player = this.players.get(clipId);
    if (!player) return null;
    // If clip is actively looping, stop it first
    if (this.activeLoops.has(clipId)) {
      player.stop();
      this.activeLoops.delete(clipId);
      if (this.onClipStateChange) this.onClipStateChange(clipId, 'idle');
    }
    player.loop = (mode === 'loop');
    this.clipModes.set(clipId, mode);
    this.repeatCounts.set(clipId, Math.max(1, Math.min(4, repeat)));
    return mode;
  }

  // Play a clip once, immediately, regardless of transport state. Used to
  // audition a pad — especially a voice clip the user just recorded — while
  // the transport is stopped, so a pad press always makes a sound instead of
  // silently doing nothing (the "my voice clip doesn't play" symptom). A
  // throwaway player is used so the real pad player's configured loop/oneshot
  // mode is never mutated; it disposes itself when the one-shot finishes.
  auditionClip(clipId) {
    const src = this.players.get(clipId);
    if (!src || !src.buffer || !src.buffer.loaded) return false;
    const oneShot = new Tone.Player(src.buffer.get()).toDestination();
    oneShot.loop = false;
    oneShot.start();
    if (this.onClipStateChange) this.onClipStateChange(clipId, 'playing');
    // Reset the pad to idle and free the throwaway player once the clip ends.
    // Keyed to the buffer length rather than the player's onstop — Tone.Player's
    // onstop does not reliably fire on a natural (non-stop()) buffer end, so
    // relying on it would both leave the pad lit and leak the player (nothing
    // else holds a reference to dispose it).
    const lifeMs = (src.buffer.duration + 0.1) * 1000;
    setTimeout(() => {
      if (this.onClipStateChange) this.onClipStateChange(clipId, 'idle');
      try { oneShot.dispose(); } catch (e) { /* already disposed */ }
    }, lifeMs);
    return true;
  }

  async startMicRecording() {
    // Re-entrancy guard: a rapid double-trigger (e.g. clicking Record twice
    // during the permission prompt) must not open a second mic over the first.
    // The app-level flag is only set after this resolves, so guard here too.
    if (this._micStarting || this.recorder) return false;
    this._micStarting = true;
    // Clear any nodes left over from a prior failed attempt before opening fresh.
    this._teardownMic();
    try {
      this.mic = new Tone.UserMedia();
      await this.mic.open();
      this.recorder = new Tone.Recorder();
      // mic -> limiter -> recorder: the limiter only catches peaks near full scale
      // (a hot mic); loudness matching happens later in voice-processing.
      this._recordLimiter = new Tone.Limiter(VOICE_RECORD_LIMIT);
      this.mic.chain(this._recordLimiter, this.recorder);
      this.recorder.start();
      this._micStarting = false;
      return true;
    } catch (err) {
      console.error('Mic access denied or unavailable:', err);
      // Dispose whatever was created before the throw so nothing leaks.
      this._teardownMic();
      this._micStarting = false;
      return false;
    }
  }

  async stopMicRecording() {
    if (!this.recorder) return null;
    const blob = await this.recorder.stop();
    this._teardownMic();
    return blob;
  }

  // Dispose every node a recording session may have created, in whatever partial
  // state it is in (failed open, mid-setup throw, or a clean stop). Safe to call
  // when nothing is open — each step is independently guarded and nulled.
  _teardownMic() {
    if (this.mic) { try { this.mic.close(); } catch (e) {} try { this.mic.dispose(); } catch (e) {} this.mic = null; }
    if (this.recorder) { try { this.recorder.dispose(); } catch (e) {} this.recorder = null; }
    if (this._recordLimiter) { try { this._recordLimiter.dispose(); } catch (e) {} this._recordLimiter = null; }
  }

  async exportComposition(sessionEvents, duration, startOffset = 0) {
    if (duration <= 0) {
      console.warn('Nothing to export');
      return null;
    }

    const renderDuration = duration + 1;

    // IMPORTANT: extract the RAW Web Audio AudioBuffer here, not the
    // Tone.js ToneAudioBuffer wrapper. Tone.ToneAudioBuffer is bound to
    // the context it was created in (the main context here); passing it
    // to a new Tone.Player created inside Tone.Offline (a separate offline
    // context) silently produces no sound. The raw AudioBuffer is
    // context-independent — Tone.Player re-wraps it in the offline
    // context, and audio actually renders.
    const bufferMap = new Map();
    let skipped = 0;
    for (const [clipId, player] of this.players) {
      if (player.buffer && player.buffer.loaded) {
        bufferMap.set(clipId, { buffer: player.buffer.get(), loop: player.loop });
      } else {
        skipped++;
      }
    }
    const bgBuffer = this.backgroundPlayer.buffer.get();
    console.log(`[export] ${sessionEvents.length} events, ${bufferMap.size} buffers ready, ${skipped} clips skipped (unloaded), render duration ${renderDuration.toFixed(2)}s`);
    const eventSummary = {};
    let missingBuffers = 0;
    for (const ev of sessionEvents) {
      const k = `${ev.action}:${ev.clipId}`;
      eventSummary[k] = (eventSummary[k] || 0) + 1;
      if (!bufferMap.has(ev.clipId)) missingBuffers++;
    }
    console.log('[export] event summary:', eventSummary);
    if (missingBuffers > 0) {
      console.warn(`[export] ${missingBuffers} event(s) reference clips with no loaded buffer — those will be silent.`);
    }

    const audioBuffer = await Tone.Offline(({ transport }) => {
      transport.bpm.value = this.bpm;

      const bg = new Tone.Player(bgBuffer).toDestination();
      bg.loop = true;
      bg.sync().start(0, startOffset);

      // CRITICAL: every Player must be created HERE, in the synchronous setup
      // body, not inside the transport.schedule callbacks below. The setup body
      // runs while the offline context is the global context, so toDestination()
      // wires into the render buffer. The scheduled callbacks, by contrast, fire
      // during render() — after Tone.Offline has restored the global context to
      // the live one. A Tone.Player created in a callback would connect to the
      // *live* destination and contribute nothing to the export (the previous
      // "background only, no pad sounds" bug). So we pre-build one player per
      // referenced clip up front and only start()/stop() them in callbacks.
      const clipPlayers = new Map();
      for (const event of sessionEvents) {
        if (clipPlayers.has(event.clipId)) continue;
        const clipInfo = bufferMap.get(event.clipId);
        if (!clipInfo) continue;
        clipPlayers.set(event.clipId, new Tone.Player(clipInfo.buffer).toDestination());
      }

      for (const event of sessionEvents) {
        const player = clipPlayers.get(event.clipId);
        if (!player) continue;

        if (event.action === 'start') {
          transport.schedule((time) => {
            player.loop = true;
            player.start(time);
          }, event.time);
        } else if (event.action === 'stop') {
          transport.schedule((time) => {
            player.stop(time);
          }, event.time);
        } else if (event.action === 'trigger') {
          // Ratchet: N hits evenly spaced across one bar (at the engine's BPM,
          // which the offline transport mirrors via transport.bpm.value above).
          // stop+start retriggers the single shared player — same truncation
          // semantics as the live engine's one-shot ratchet.
          const repeat = event.repeat || 1;
          const barSec = 60 / this.bpm * 4;
          const interval = barSec / repeat;
          for (let i = 0; i < repeat; i++) {
            const hitTime = event.time + i * interval;
            transport.schedule((time) => {
              player.loop = false;
              player.stop(time);
              player.start(time);
            }, hitTime);
          }
        }
      }

      transport.start();
    }, renderDuration);

    const rawBuffer = audioBuffer.get();
    console.log(`[export] render complete: ${rawBuffer.duration.toFixed(2)}s, ${rawBuffer.numberOfChannels}ch, ${rawBuffer.sampleRate}Hz`);
    const blob = await encodeMP3(rawBuffer);
    return { blob, durationSec: rawBuffer.duration };
  }

  getTransportTime() {
    return Tone.getTransport().seconds;
  }

  getAnalyser() {
    if (!this._analyser) {
      this._analyser = new Tone.Analyser({ type: 'fft', size: 128 });
      Tone.getDestination().connect(this._analyser);
    }
    return this._analyser;
  }
}
