# Survey Location Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the app's silent country+region IP capture with an opt-in tick box, an editable prefilled location field (now including city), and a one-line disclosure, all folded into the first-share demographics block.

**Architecture:** Geo is resolved client-side by `js/geo.js` (ipapi.co, no key) and the row is inserted straight into Supabase by `js/contribute.js` – there is no backend. The new UI lives in the existing `#share-demographics` block in `index.html` (asked once, cached in localStorage like the other demographics). `country`/`region` reuse their existing table columns; `city` and the edited text go into the existing `extra_fields` JSONB, so no DB migration. Pure-logic changes (`geo.js` parse, `submission.js` row build) get Node `node --test` coverage; UI wiring is verified manually in the browser.

**Tech Stack:** Vanilla ES-module JS, Supabase JS client, ipapi.co, `Intl.DisplayNames` for country-code→name, Node built-in test runner.

---

## File Structure

- `package.json` – **create**: minimal, `"type": "module"` so Node loads the ES-module source files for testing. No dependencies.
- `js/geo.js` – **modify**: extract a pure `parseGeo(data)` and add `city` to the returned object.
- `js/submission.js` – **modify**: `buildSubmissionRow` takes a `locationText` arg, writes `extra_fields.geo_city` and `extra_fields.location_text`, with a tight cap on the location text.
- `index.html` – **modify**: add the editable location input + unticked consent checkbox + disclosure line to `#share-demographics`.
- `js/contribute.js` – **modify**: prefill the field from `getLocation()`, read consent + edited text on submit, apply the opt-out fallback, cache geo + text in localStorage, and reuse them on later shares without re-asking.
- `tests/geo.test.js` – **create**: cover `parseGeo`.
- `tests/submission.test.js` – **create**: cover `buildSubmissionRow` (ticked vs opted-out, caps).

---

## Task 1: Node test harness (package.json)

**Files:**
- Create: `package.json`

Node decides module type from the nearest `package.json`. The source files use `export`, so without `"type": "module"` Node parses them as CommonJS and the imports fail. This file is the whole test harness – no dependencies.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "voicescape",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 2: Verify Node runs with no tests yet**

Run: `node --test`
Expected: exits 0 with "tests 0" (no test files exist yet – confirms the runner works).

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "test: add Node test harness (type:module, node --test)"
```

---

## Task 2: geo.js returns city

**Files:**
- Modify: `js/geo.js`
- Test: `tests/geo.test.js`

Split parsing out of the network call so it can be tested without `fetch`. Add `city` from the same ipapi response. The fallback gains an empty `city`.

- [ ] **Step 1: Write the failing test**

Create `tests/geo.test.js`:

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/geo.test.js`
Expected: FAIL – `parseGeo` is not exported.

- [ ] **Step 3: Refactor `geo.js` to expose `parseGeo` and add city**

Replace the whole contents of `js/geo.js` with:

```javascript
// Calls ipapi.co to resolve the user's IP into {country, region, city}.
// On timeout or error, returns {country: 'ZZ', region: 'Unknown', city: ''}.
// Never exposes the raw IP to the calling code.

const TIMEOUT_MS = 3000;
const FALLBACK = Object.freeze({ country: 'ZZ', region: 'Unknown', city: '' });

// Pure: map an ipapi JSON body to our geo shape. Exported for tests.
export function parseGeo(data) {
  const country = typeof data.country_code === 'string' && /^[A-Z]{2}$/.test(data.country_code)
    ? data.country_code
    : 'ZZ';
  const region = typeof data.region === 'string' && data.region.length > 0
    ? data.region.slice(0, 100)
    : 'Unknown';
  const city = typeof data.city === 'string' && data.city.length > 0
    ? data.city.slice(0, 100)
    : '';
  return { country, region, city };
}

export async function getLocation() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch('https://ipapi.co/json/', { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!response.ok) return FALLBACK;
    return parseGeo(await response.json());
  } catch (e) {
    clearTimeout(timeoutId);
    return FALLBACK;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/geo.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add js/geo.js tests/geo.test.js
git commit -m "feat: geo.js returns city alongside country and region"
```

---

## Task 3: submission.js stores city and location text

**Files:**
- Modify: `js/submission.js`
- Test: `tests/submission.test.js`

`buildSubmissionRow` gains a `locationText` parameter. It writes `extra_fields.geo_city` (from `geo.city`) and `extra_fields.location_text`, each only when non-empty. The location text is capped at 120 chars – a place name needs no more, and `extra_fields` has a hard 4KB check constraint already carrying two ~1500-char fields, so a long entry here could fail the insert.

- [ ] **Step 1: Write the failing test**

Create `tests/submission.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSubmissionRow, LOCATION_TEXT_CAP } from '../js/submission.js';

const base = {
  submissionId: 'sid', uid: 'uid',
  demographics: { ageBand: '25-34', gender: 'woman', genderSelfDescribe: null, selfTalkFrequency: 'often', about: '' },
  feedback: '', durationSec: 12, mp3SizeBytes: 1000, appVersion: 'v', storagePath: 'p',
};

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/submission.test.js`
Expected: FAIL – `LOCATION_TEXT_CAP` is not exported / `geo_city` undefined.

- [ ] **Step 3: Edit `js/submission.js`**

Add the cap constant after `FREE_TEXT_CAP` (around line 8):

```javascript
// Tight cap on the location text — it holds a place name, and extra_fields has a
// 4KB check constraint already carrying two ~1500-char free-text fields, so a
// long value here could push the insert over the limit.
export const LOCATION_TEXT_CAP = 120;
```

In `buildSubmissionRow`, add `locationText` to the destructured params:

```javascript
export function buildSubmissionRow({
  submissionId, uid, geo, demographics, feedback, locationText,
  durationSec, mp3SizeBytes, appVersion, storagePath,
}) {
```

Inside the function, after the `fb` block and before the `return`, add:

```javascript
  const city = (geo.city || '').trim().slice(0, 100);
  if (city) extra.geo_city = city;
  const loc = (locationText || '').trim().slice(0, LOCATION_TEXT_CAP);
  if (loc) extra.location_text = loc;
```

(The `return` object is unchanged – `country: geo.country`, `region: geo.region`, `extra_fields: extra` already carry these through.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/submission.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add js/submission.js tests/submission.test.js
git commit -m "feat: store geo_city and capped location_text in extra_fields"
```

---

## Task 4: Location UI in the share card

**Files:**
- Modify: `index.html` (inside `#share-demographics`, after the `about` textarea label, before the closing `</div>` at line 117)

Add an editable location input (JS prefills it), an unticked consent checkbox, and the disclosure line. No DB or JS logic here – just markup the next task reads.

- [ ] **Step 1: Add the markup**

After the `about` `<label>…</label>` block (ends line 116) and before the `</div>` that closes `#share-demographics` (line 117), insert:

```html
        <label>Where are you based?
          <input type="text" name="locationText" autocomplete="off"
            placeholder="City, region, country">
        </label>
        <label class="share-location-consent">
          <input type="checkbox" name="locationConsent">
          OK to include your approximate location on our contributor map
        </label>
        <p class="share-location-note">
          We detect this from your internet connection. Leave the box unticked
          and we won't record where you are.
        </p>
```

- [ ] **Step 2: Verify the markup loads**

Run: open `index.html` in a browser (or your usual local serve), trigger a jam to first-share so the demographics block shows.
Expected: the location text input, an **unticked** checkbox, and the note appear under "Anything you'd like to share?". The input is empty for now (prefill comes in Task 5).

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add location field, consent checkbox, and disclosure to share card"
```

---

## Task 5: Wire prefill, consent, caching into contribute.js

**Files:**
- Modify: `js/contribute.js`

Prefill the field once geo resolves; on submit, read the checkbox and field; if unticked use the ZZ/Unknown fallback; cache geo + text in localStorage with the rest of the demographics; on later shares reuse the cached values without re-asking or re-looking-up.

Current relevant behaviour: `getLocation()` is called every share (line 78) and the result is always inserted. After this task, the lookup + UI happen only on first share; later shares read the cached geo.

- [ ] **Step 1: Add a country-name helper at the top of the module**

After the imports (after line 8), add:

```javascript
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
```

- [ ] **Step 2: Prefill the field when the demographics block shows**

The existing `const geoPromise = getLocation();` is at line 78. Replace it and the surrounding intent so the lookup only runs when we'll ask. Change line 78 from:

```javascript
  const geoPromise = getLocation();
```

to:

```javascript
  // Only look up + ask for location on the first share (when the demographics
  // block is shown). Prefill the field as soon as it resolves.
  const geoPromise = needDemographics ? getLocation() : Promise.resolve(null);
  if (needDemographics) {
    geoPromise.then((g) => {
      if (seq !== shareSeq || !active) return;
      const input = demoBlock && demoBlock.querySelector('[name="locationText"]');
      if (input && g) input.value = prefillLocation(g);
    });
  }
```

- [ ] **Step 3: Read consent + edited text on submit, and cache them**

Replace the first-share capture block (lines 107–118, from the `if (needDemographics && demoBlock)` block through `const geo = await geoPromise;`) with:

```javascript
      // First share: capture + cache the demographics AND the location choice
      // from this card. Later shares reuse the cached values.
      let geo, locationText;
      if (needDemographics && demoBlock) {
        const sel = (n) => demoBlock.querySelector(`[name="${n}"]`);
        const consented = sel('locationConsent').checked;
        const looked = (await geoPromise) || NO_GEO;
        geo = consented ? looked : NO_GEO;
        locationText = consented ? sel('locationText').value : '';
        saveDemographics({
          ageBand: sel('ageBand').value || '',
          gender: sel('gender').value || '',
          selfTalkFrequency: sel('selfTalkFrequency').value || '',
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
```

(This removes the standalone `const geo = await geoPromise;` line – `geo` is now set in both branches above.)

- [ ] **Step 4: Pass `locationText` into the submission**

The `performSubmission(...)` call (line 119) and its definition must carry `locationText`. Change the call to:

```javascript
      const r = await performSubmission(result.blob, result.durationSec, demographics, textarea.value, geo, locationText, status);
```

Change the `performSubmission` signature (line 130) to:

```javascript
async function performSubmission(mp3Blob, durationSec, demographics, feedback, geo, locationText, statusEl) {
```

And add `locationText` to the `buildSubmissionRow({...})` call (line 146):

```javascript
  const row = buildSubmissionRow({
    submissionId, uid, geo, demographics, feedback, locationText,
    durationSec, mp3SizeBytes: mp3Blob.size, appVersion: APP_VERSION, storagePath,
  });
```

- [ ] **Step 5: Manual verification in the browser**

Run through these in a browser with the app served:

1. **Clear state:** in devtools, `localStorage.removeItem('voicescape:demographics')`, reload.
2. **First share, opt in:** jam → stop → share card shows the demographics block. The location field prefills (e.g. "Lancaster, England, United Kingdom") within ~3s. Tick the box, submit. In the Supabase `submissions` row (or the network insert payload), confirm `country`/`region` are real and `extra_fields.geo_city` + `extra_fields.location_text` are present.
3. **Returning share:** jam → stop again. The demographics block is hidden (cached). Submit. Confirm the row reuses the same geo and `location_text` without re-asking.
4. **Opt out:** clear localStorage again, reload, first share, **leave the box unticked**, submit. Confirm the row has `country: 'ZZ'`, `region: 'Unknown'`, and no `geo_city` / `location_text`.
5. **Edit:** clear localStorage, first share, change the prefilled text to something else, tick, submit. Confirm `location_text` holds the edited string while `country`/`region`/`geo_city` still reflect the IP lookup.

- [ ] **Step 6: Commit**

```bash
git add js/contribute.js
git commit -m "feat: prefill, consent, and cache location in the share flow"
```

---

## Task 6: Style the new fields (optional polish)

**Files:**
- Modify: `style.css`

Match the new checkbox/note to the existing share-card look. Only if the defaults look out of place after Task 4–5.

- [ ] **Step 1: Add rules near the existing `.share-demo-intro` / `#share-demographics` styles**

```css
.share-location-consent {
  display: flex;
  align-items: center;
  gap: 0.5em;
}
.share-location-note {
  font-size: 0.85em;
  opacity: 0.7;
  margin: 0.25em 0 0;
}
```

- [ ] **Step 2: Verify in browser, then commit**

```bash
git add style.css
git commit -m "style: location consent checkbox and disclosure note"
```

---

## Self-Review notes

- **Spec coverage:** opt-in tick (Task 4/5), editable prefilled field incl. city (Task 2/4/5), country+region columns reused + city/location_text in extra_fields (Task 3), opt-out → ZZ/Unknown (Task 5), disclosure line (Task 4), ask-once caching (Task 5), `node --test` for pure logic (Task 2/3). All covered.
- **Type consistency:** geo shape `{country, region, city}` is produced by `parseGeo` (Task 2), consumed by `buildSubmissionRow` (Task 3) and `contribute.js` (Task 5); the `NO_GEO` constant matches it. Element names `locationText` / `locationConsent` match between `index.html` (Task 4) and `contribute.js` (Task 5).
- **Caps:** `geo_city` ≤100, `location_text` ≤120, keeping `extra_fields` under its 4KB constraint.
- **Backward compatibility:** users with demographics already cached (no `geo` key) fall through to `NO_GEO` on their next share – no location stored without consent, which is the GDPR-safe default.
