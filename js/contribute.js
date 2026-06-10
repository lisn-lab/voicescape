// Owns the Share-on-Stop card. On the visitor's first share it also collects the
// demographics (folded in, then cached so later shares are just the thought box);
// no in-app stats. Submitting does Postgres insert → Storage upload only.

import { getClient, getReady } from './supabase-config.js';
import { getLocation } from './geo.js';
import { resolveDemographics, buildSubmissionRow } from './submission.js';
import { getStoredDemographics, saveDemographics } from './demographics.js';

const APP_VERSION = '2026-06-08';

// Country code -> display name for the prefill, e.g. 'GB' -> 'United Kingdom'.
// Intl.DisplayNames is built in; fall back to the raw code if unavailable.
function countryName(code) {
  if (!code || code === 'ZZ') return '';
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code;
  } catch {
    return code;
  }
}

// Human-readable prefill from a resolved geo object, skipping empty/unknown parts.
function prefillLocation(geo) {
  return [geo.city, geo.region, countryName(geo.country)]
    .filter((p) => p && p !== 'Unknown')
    .join(', ');
}

const NO_GEO = Object.freeze({ country: 'ZZ', region: 'Unknown', city: '' });

// Bumped on every share() call so a render that resolves after a newer share()
// has taken over the (singleton) card is ignored instead of writing to it.
let shareSeq = 0;

function $(id) { return document.getElementById(id); }

// Show the share card immediately for one composition. `resultPromise` resolves
// to { blob, durationSec } once the MP3 has rendered (or null on failure); the
// card does NOT block on it — Share awaits it only if the visitor submits before
// the render finishes. Resolves {ok:true} on a successful share, or
// {cancelled:true} if the visitor picks "Not now" (nothing uploaded).
export async function share(resultPromise) {
  const card = $('share-card');
  const demoBlock = $('share-demographics');
  const textarea = card.querySelector('textarea[name="feedback"]');
  const sub = card.querySelector('.share-card-sub');
  const submitBtn = $('share-submit-btn');
  const notNowBtn = $('share-not-now-btn');
  const status = $('share-status');
  const downloadLink = $('share-download');
  const seq = ++shareSeq;

  // Revoke whatever blob URL is currently on the (singleton) link and hide it.
  // Element-centric, so a URL set by an earlier, now-superseded share() is always
  // released here — no leak even when two jams' cards overlap.
  const clearDownload = () => {
    if (!downloadLink) return;
    if ((downloadLink.href || '').startsWith('blob:')) URL.revokeObjectURL(downloadLink.href);
    downloadLink.classList.add('hidden');
    downloadLink.removeAttribute('href');
  };

  textarea.value = '';
  status.textContent = '';
  status.classList.remove('error');
  submitBtn.disabled = false;
  if (sub) sub.textContent = 'Preparing your MP3…';
  clearDownload();   // reset: drop any leftover URL from a prior share

  // Fold: show the demographic fields only until they've been answered once.
  // After the first share they're cached in localStorage, so later shares are
  // just the thought box.
  const needDemographics = !getStoredDemographics();
  if (demoBlock) demoBlock.classList.toggle('hidden', !needDemographics);

  card.classList.remove('hidden');

  // Guards a late render promise from writing a stale sub-line onto a newer card
  // (if this share was already closed by the time its render resolves).
  let active = true;

  // When the render finishes, offer the MP3 as a click-to-download link rather
  // than auto-downloading every jam. The <a download> saves the file on click.
  resultPromise.then((r) => {
    if (seq !== shareSeq || !active) return;   // a newer share() took over the card
    if (r && r.blob && downloadLink) {
      if ((downloadLink.href || '').startsWith('blob:')) URL.revokeObjectURL(downloadLink.href);
      downloadLink.href = URL.createObjectURL(r.blob);
      downloadLink.download = `voicescape-${Date.now()}.mp3`;
      downloadLink.classList.remove('hidden');
      if (sub) sub.textContent = 'Your MP3 is ready.';
    } else if (sub) {
      sub.textContent = "Couldn't prepare the MP3.";
    }
  });

  // Only look up + ask for location on the first share (when the demographics
  // block is shown). Prefill the field as soon as it resolves.
  const geoPromise = needDemographics ? getLocation() : Promise.resolve(null);
  if (needDemographics) {
    geoPromise.then((g) => {
      if (seq !== shareSeq || !active) return;
      const input = demoBlock && demoBlock.querySelector('[name="locationText"]');
      if (input && g && !input.value) input.value = prefillLocation(g);
    });
  }

  return new Promise((resolve) => {
    // Attach via .onclick (not addEventListener) so each share() invocation
    // REPLACES the handlers rather than stacking them — a failed render or
    // submission that leaves the card open can't leak duplicate listeners into
    // the next share().
    const cleanup = () => {
      active = false;
      card.classList.add('hidden');
      submitBtn.onclick = null;
      notNowBtn.onclick = null;
      clearDownload();
    };
    const onNotNow = () => { cleanup(); resolve({ cancelled: true }); };
    const onSubmit = async () => {
      submitBtn.disabled = true;
      status.textContent = 'Preparing…';
      const result = await resultPromise;          // wait for the render if it's still going
      if (!result || !result.blob) {
        // Render failed — nothing to share. Close out cleanly so the promise
        // resolves and no listeners linger.
        status.textContent = "Couldn't prepare the MP3 to share.";
        status.classList.add('error');
        submitBtn.disabled = false;
        cleanup();
        resolve({ ok: false });
        return;
      }
      // First share: capture + cache the demographics AND the location choice
      // from this card. Later shares reuse the cached values.
      let geo, locationText;
      if (needDemographics && demoBlock) {
        const sel = (n) => demoBlock.querySelector(`[name="${n}"]`);
        // No tick box: the prefilled "Where are you from?" field is the control.
        // Leaving it (edited or not) opts in; clearing it opts out of all location
        // storage. The visible field doubles as the disclosure of what we detected.
        locationText = sel('locationText').value.trim();
        const looked = (await geoPromise) || NO_GEO;
        geo = locationText ? looked : NO_GEO;
        saveDemographics({
          ageBand: sel('ageBand').value || '',
          gender: sel('gender').value || '',
          about: sel('about').value || '',
          geo,
          locationText,
        });
      } else {
        const stored = getStoredDemographics() || {};
        geo = stored.geo || NO_GEO;
        locationText = stored.locationText || '';
      }
      const demographics = resolveDemographics(getStoredDemographics());
      const r = await performSubmission(result.blob, result.durationSec, demographics, textarea.value, geo, locationText, status);
      submitBtn.disabled = false;
      // On success, close. On submission failure, leave the card open so they can
      // retry — the same onclick handler is reused, no leak.
      if (r.ok) { cleanup(); resolve({ ok: true }); }
    };
    submitBtn.onclick = onSubmit;
    notNowBtn.onclick = onNotNow;
  });
}

async function performSubmission(mp3Blob, durationSec, demographics, feedback, geo, locationText, statusEl) {
  const supabase = getClient();
  statusEl.classList.remove('error');
  statusEl.textContent = 'Sending…';

  let uid;
  try {
    uid = await getReady();
  } catch {
    statusEl.textContent = 'Could not connect. Try again in a moment.';
    statusEl.classList.add('error');
    return { ok: false };
  }

  const submissionId = crypto.randomUUID();
  const storagePath = `submissions/${submissionId}.mp3`;
  const row = buildSubmissionRow({
    submissionId, uid, geo, demographics, feedback, locationText,
    durationSec, mp3SizeBytes: mp3Blob.size, appVersion: APP_VERSION, storagePath,
  });

  const { error: insertErr } = await supabase.from('submissions').insert(row);
  if (insertErr) {
    console.error('Submission insert failed', insertErr);
    statusEl.textContent = "Saved on your device — couldn't reach the lab's archive this time.";
    statusEl.classList.add('error');
    return { ok: false };
  }

  const { error: uploadErr } = await supabase.storage.from('submissions')
    .upload(`${submissionId}.mp3`, mp3Blob, { contentType: 'audio/mpeg', cacheControl: '3600', upsert: false });
  if (uploadErr) {
    console.error('Storage upload failed', uploadErr);
    statusEl.textContent = "Saved on your device — your audio didn't reach the archive.";
    statusEl.classList.add('error');
    return { ok: true, degraded: 'storage' };
  }

  statusEl.textContent = 'Sent — thank you.';
  return { ok: true, submissionId };
}
