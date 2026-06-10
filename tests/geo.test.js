import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGeo } from '../js/geo.js';

test('parseGeo reads country_code, region, city', () => {
  const out = parseGeo({ country_code: 'GB', region: 'England', city: 'Lancaster' });
  assert.deepEqual(out, { country: 'GB', region: 'England', city: 'Lancaster' });
});

test('parseGeo falls back on a bad country code', () => {
  const out = parseGeo({ country_code: 'lancashire', region: 'England', city: 'Lancaster' });
  assert.equal(out.country, 'ZZ');
  assert.equal(out.region, 'England');
  assert.equal(out.city, 'Lancaster');
});

test('parseGeo falls back on missing region and city', () => {
  const out = parseGeo({ country_code: 'US' });
  assert.deepEqual(out, { country: 'US', region: 'Unknown', city: '' });
});

test('parseGeo caps city length at 100', () => {
  const out = parseGeo({ country_code: 'US', region: 'X', city: 'a'.repeat(200) });
  assert.equal(out.city.length, 100);
});
