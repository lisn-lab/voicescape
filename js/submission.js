// Pure, network-free helpers for building a submission. Unit-testable in node.

export const DEMOGRAPHICS_KEY = 'voicescape:demographics';

// Per-field cap on free text. The submissions.extra_fields JSONB has a hard 4KB
// check constraint; two ~1500-char fields plus JSON overhead stays comfortably
// under it, so a long answer can never make the insert fail.
export const FREE_TEXT_CAP = 1500;

// Tight cap on the location text — it holds a place name, and extra_fields has a
// 4KB check constraint already carrying two ~1500-char free-text fields, so a
// long value here could push the insert over the limit.
export const LOCATION_TEXT_CAP = 120;

// Map a parsed localStorage demographics object (or null) to table-valid values.
// Unset age/gender become 'prefer-not-to-say' (the NOT NULL columns accept it);
// unset self-talk frequency becomes null (the column is nullable). The gender
// "self-describe" category was removed; gender_self_describe is always null now.
// These are the cached, ask-once fields; the free-text answers (about, feedback)
// are asked every share and passed separately to buildSubmissionRow.
export function resolveDemographics(stored) {
  const d = stored || {};
  return {
    ageBand: d.ageBand || 'prefer-not-to-say',
    gender: d.gender || 'prefer-not-to-say',
    genderSelfDescribe: null,
    selfTalkFrequency: d.selfTalkFrequency || null,
  };
}

// Build the row inserted into public.submissions. The two free-text fields
// (about = "anything you'd like to share", feedback = "your inner experience")
// are asked on the share card every time, trimmed, capped, and only added to
// extra_fields when non-empty.
export function buildSubmissionRow({
  submissionId, uid, geo, demographics, about, feedback, locationText,
  durationSec, mp3SizeBytes, appVersion, storagePath,
}) {
  const extra = {};
  const ab = (about || '').trim().slice(0, FREE_TEXT_CAP);
  if (ab) extra.about = ab;
  const fb = (feedback || '').trim().slice(0, FREE_TEXT_CAP);
  if (fb) extra.feedback = fb;
  const city = (geo.city || '').trim().slice(0, 100);
  if (city) extra.geo_city = city;
  const loc = (locationText || '').trim().slice(0, LOCATION_TEXT_CAP);
  if (loc) extra.location_text = loc;
  return {
    id: submissionId,
    uid,
    country: geo.country,
    region: geo.region,
    age_band: demographics.ageBand,
    gender: demographics.gender,
    gender_self_describe: demographics.genderSelfDescribe,
    self_talk_frequency: demographics.selfTalkFrequency,
    extra_fields: extra,
    storage_path: storagePath,
    duration_sec: Number(durationSec) || 0,
    mp3_size_bytes: mp3SizeBytes,
    app_version: appVersion,
  };
}
