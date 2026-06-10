import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSubmissionRow, LOCATION_TEXT_CAP } from '../js/submission.js';

const base = {
  submissionId: 'sid', uid: 'uid',
  demographics: { ageBand: '25-34', gender: 'woman', genderSelfDescribe: null, selfTalkFrequency: null },
  about: '', feedback: '', durationSec: 12, mp3SizeBytes: 1000, appVersion: 'v', storagePath: 'p',
};

test('about and feedback land in extra_fields per share', () => {
  const row = buildSubmissionRow({
    ...base,
    geo: { country: 'GB', region: 'England', city: 'Lancaster' },
    about: 'Came after a hard day; calmer now.',
    feedback: 'I narrate constantly.',
  });
  assert.equal(row.extra_fields.about, 'Came after a hard day; calmer now.');
  assert.equal(row.extra_fields.feedback, 'I narrate constantly.');
});

test('ticked: city and location_text land in extra_fields', () => {
  const row = buildSubmissionRow({
    ...base,
    geo: { country: 'GB', region: 'England', city: 'Lancaster' },
    locationText: 'Lancaster, England, United Kingdom',
  });
  assert.equal(row.country, 'GB');
  assert.equal(row.region, 'England');
  assert.equal(row.extra_fields.geo_city, 'Lancaster');
  assert.equal(row.extra_fields.location_text, 'Lancaster, England, United Kingdom');
});

test('opted out: ZZ/Unknown geo, no geo_city or location_text', () => {
  const row = buildSubmissionRow({
    ...base,
    geo: { country: 'ZZ', region: 'Unknown', city: '' },
    locationText: '',
  });
  assert.equal(row.country, 'ZZ');
  assert.equal(row.region, 'Unknown');
  assert.ok(!('geo_city' in row.extra_fields));
  assert.ok(!('location_text' in row.extra_fields));
});

test('location_text is capped', () => {
  const row = buildSubmissionRow({
    ...base,
    geo: { country: 'GB', region: 'England', city: 'X' },
    locationText: 'a'.repeat(500),
  });
  assert.equal(row.extra_fields.location_text.length, LOCATION_TEXT_CAP);
});
