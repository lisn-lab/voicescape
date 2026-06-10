# Survey location capture – design

Date: 2026-06-10
Status: decided, not yet implemented

## Goal

Record participant location in the post-jam demographic survey to show a
geographic distribution of contributors. Illustration of the sample, not
verification – approximate is fine, fake values don't matter.

## Decision

Auto-detect location from the visitor's IP, then show it for opt-in confirmation
on the demographic survey card. Consent model (tick box), not silent capture.

The flow on the survey card:

- A GeoIP lookup gives **country + region + city-guess**. Region is the
  first-level subdivision (e.g. England, California, Bavaria) – returned for
  free by any GeoIP service, nothing to curate.
- The detected location is shown prefilled in a single **editable text field**,
  e.g. `Lancaster, England, UK`. The participant can correct it, blank it, or
  leave it. Editable text removes the "wrong guess looks bad" problem without
  needing a search widget or places database.
- A tick box, **unticked by default**, opts the location into the contributor
  map. Default-unticked is required for valid GDPR consent.

## Data stored

Keep the machine guess and the human edit separate so edits don't corrupt the
distribution:

- **Raw IP geo** – structured `country` / `region` / `city` from the lookup,
  stored whenever the box is ticked. This drives the map/distribution.
- **Edited text** – the free-text field as the participant left it, stored as a
  separate field. Supplementary, not the source of truth. Messy values
  ("the moon") are harmless because the map reads the structured fields.

## Rejected alternatives

- **Ask for postcode** – doesn't generalise past the UK; format varies per country.
- **City autocomplete / searchable list** – needs a places database or paid API
  (e.g. Google Places). Too much for an illustrative field. Bo's call.
- **Disclosure-only / silent capture (legitimate interest)** – considered;
  rejected in favour of the tick box for transparency. Trade-off: opt-in leaves
  coverage gaps from people who skip the tick.

## Requirement – GDPR

An IP address and location derived from it are personal data under UK GDPR.
Lawful basis here is **consent**, given by the tick box. The box must be
unticked by default – a pre-ticked box is not valid consent. Wording near it,
e.g.:

> "OK to include your approximate location on our contributor map?"

## Implementation notes

- Demographics today are device-only and travel with a share
  (`js/demographics.js`, `js/contribute.js`).
- The geo lookup must happen **before the survey card renders** so the field can
  be prefilled – not silently on receipt. The browser can't read its own public
  IP + geo reliably, and a client-side geo API would expose a key, so the lookup
  is a small **server-side** endpoint the client calls when the card opens; the
  server returns `country` / `region` / `city` for the requesting IP.
- On share, the payload carries: raw IP geo (if ticked), tick state, and edited
  text. Add these to the share payload, not to `saveDemographics`.
- Pick a GeoIP source (self-hosted MaxMind GeoLite2 DB, or a hosted lookup on the
  server). No per-request cost with a bundled DB.
