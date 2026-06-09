// Session recorder — performance event log + playback (in-memory only)

export class SessionRecorder {
  constructor() {
    this.events = [];
    this.recording = false;
    this.customClips = [];
    this.recordingOffset = 0;
    // Total transport length of the captured performance, in seconds. Set when
    // playback stops (see App._togglePlay). Used as the floor for export render
    // duration so a loop that was started and left running isn't truncated to
    // its start-event time.
    this.performanceDuration = 0;
  }

  startRecording(keepExistingEvents = false, offset = 0) {
    if (!keepExistingEvents) this.events = [];
    this.recordingOffset = offset;
    this.recording = true;
  }

  stopRecording() {
    this.recording = false;
    this._sortEvents();
  }

  recordEvent(clipId, action, time, repeat = 1) {
    if (!this.recording) return;
    this.events.push({ time: time - this.recordingOffset, clipId, action, repeat });
  }

  _sortEvents() {
    this.events.sort((a, b) => a.time - b.time);
  }

  schedulePlayback(audioEngine) {
    this._sortEvents();
    const transport = Tone.getTransport();

    for (const event of this.events) {
      transport.schedule((time) => {
        audioEngine.triggerClip(event.clipId, event.repeat || 1);
      }, event.time);
    }
  }

  addCustomClip(clipInfo) {
    this.customClips.push(clipInfo);
  }
}
