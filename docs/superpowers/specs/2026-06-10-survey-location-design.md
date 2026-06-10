# Survey location capture – design

Date: 2026-06-10
Status: decided, not yet implemented

## Goal

Record participant location in the post-jam demographic survey to show a
geographic distribution of contributors. Illustration of the sample, not
verification – approximate is fine, fake values don't matter.

## Decision

Auto-detect location from the visitor's IP and show it prefilled in a single
**editable text field** on the demographic survey card. No tick box – the field
itself is the control.

The flow on the survey card:

- A GeoIP lookup gives **country + region + city-guess**. Region is the
  first-level subdivision (e.g. England, California, Bavaria) – returned for
  free by any GeoIP service, nothing to curate.
- The detected location prefills a "Where are you from?" text field, e.g.
  `Lancaster, England, United Kingdom`. The participant can edit it, leave it,
  or **clear it**. Editable text removes the "wrong guess looks bad" problem
  without a search widget or places database.
- **No tick box** (revised 2026-06-10 after seeing the card – the checkbox plus
  disclosure note read as too much). Leaving the field (edited or not) stores
  location; clearing it stores none. The visible prefilled field doubles as the
  disclosure of what was detected and as the opt-out control.

### Card composition (final)

Cached, ask-once block (hidden after first share), with a divider beneath it:
Age, Gender, **Where are you from?**.

Below the divider, asked **every share**: "Anything you'd like to share?"
(prompt: "What brought you here today, and how did this session feel?") and
"What is your inner experience like?" (prompt: "Do you talk to yourself in your
head? What's your inner speech like?").

The old "Do you talk to yourself in your head?" dropdown was removed; that signal
now comes back as free text in the inner-experience prompt. Both free-text
answers are read fresh each share – they are no longer cached – so the
session-feeling question is asked on every visit, not just the first.

## Data stored

Keep the machine guess and the human edit separate so edits don't corrupt the
distribution. The `submissions` table already has `country` and `region`
columns; `city` and the edited text go into the existing `extra_fields` JSONB,
so no DB migration is needed.

- **Raw IP geo** – `country` / `region` columns (existing) plus
  `extra_fields.geo_city`, stored when the location field is left non-empty.
  This drives the map/distribution.
- **Edited text** – `extra_fields.location_text`, the field as the participant
  left it. Supplementary, not the source of truth. Messy values ("the moon")
  are harmless because the map reads the structured fields.
- **Opt-out** – the field cleared to empty: write `country = 'ZZ'`,
  `region = 'Unknown'` (the existing geo.js fallback, so the columns stay
  non-null), and store no `geo_city` / `location_text`.

## Rejected alternatives

- **Ask for postcode** – doesn't generalise past the UK; format varies per country.
- **City autocomplete / searchable list** – needs a places database or paid API
  (e.g. Google Places). Too much for an illustrative field. Bo's call.
- **Disclosure-only / silent capture (legitimate interest)** – considered;
  rejected in favour of the tick box for transparency. Trade-off: opt-in leaves
  coverage gaps from people who skip the tick. Note this is the app's *current*
  behaviour: `geo.js` already captures country+region on every share with no
  tick and no disclosure. This change replaces that with consent.

## Requirement – GDPR

An IP address and location derived from it are personal data under UK GDPR.
The model here is **disclosed self-report**, not an explicit tick-box consent:
the participant sees the detected location in a labelled, editable field and can
clear it to store nothing. Lawful basis is legitimate interest, with the visible
field providing transparency and an opt-out.

This is a lighter posture than the unticked-checkbox consent first specced
(dropped 2026-06-10 as too heavy for the card). It is defensible for coarse,
non-sensitive, aggregate-use location. If a stricter explicit-consent basis is
ever wanted, restore the tick box – that is the only thing that gave active
opt-in.

## Implementation notes

Architecture as built (verified against the code, not assumed):

- The lookup is **already client-side**. `js/geo.js` calls `ipapi.co/json/` from
  the browser (no API key, free tier) and returns `{country, region}`. The same
  ipapi response carries `city`, so adding the city guess is one extra field – 
  no server, no key, no migration.
- There is **no custom backend**. `js/contribute.js` inserts the submission row
  straight into Supabase Postgres (`js/supabase-config.js`), so the geo must be
  resolved in the browser before the insert – which is what already happens.
- **Where it lives:** fold the location confirm (editable field + tick) into the
  existing first-share demographics block (`#share-demographics` in
  `index.html`), so it's asked once and cached in localStorage like the other
  demographics. `geo.js` prefills the field; later shares reuse the cached value.
- **Pure functions stay testable:** `geo.js` and `submission.js` import nothing
  from the bundler, so cover the city parse and the row-building (ticked vs
  opted-out) with `node --test`. UI wiring is verified manually in the browser.
