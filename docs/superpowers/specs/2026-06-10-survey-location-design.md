# Survey location capture – design

Date: 2026-06-10
Status: decided, not yet implemented

## Goal

Record participant location in the post-jam demographic survey to show a
geographic distribution of contributors. Illustration of the sample, not
verification – approximate is fine, fake values don't matter.

## Decision

Capture location automatically from the visitor's IP. No participant input,
no dropdown, no location-search widget.

- Store **country + region + city-guess** as returned by a GeoIP lookup.
  Region is the first-level subdivision (e.g. England, California, Bavaria) – 
  returned for free by any GeoIP service, nothing to curate.
- City-guess is unreliable (off by tens to hundreds of km, worse on mobile/VPN);
  stored anyway because the use is distribution, not fact-checking.

## Rejected alternatives

- **Ask for postcode** – doesn't generalise past the UK; format varies per country.
- **Country dropdown / city autocomplete** – autocomplete needs a places database
  or a paid API (e.g. Google Places). Too much for an illustrative field. Bo's call.
- **Self-report free-text override** – messy data, no real gain when the use is
  illustrative. Skipped.

## Requirement – GDPR

An IP address and location derived from it are personal data under UK GDPR.
The capture must be disclosed and have a lawful basis. Fold into the existing
demographic consent already collected on first share. One sentence, e.g.:

> "We record your approximate location (country and region) from your internet connection."

This converts silent tracking into disclosed tracking – the whole compliance
difference. Not optional.

## Implementation notes

- Demographics today are device-only and travel with a share (`js/demographics.js`,
  `js/contribute.js`). The IP lookup must happen **server-side** on the endpoint
  that receives a share – the browser cannot read its own public IP + geo reliably,
  and doing it client-side would expose an API key. Add the geo fields to the
  share payload server-side, not in `saveDemographics`.
- Pick a GeoIP source (self-hosted MaxMind GeoLite2 DB, or a hosted lookup on the
  receiving server). No per-request cost with a bundled DB.
