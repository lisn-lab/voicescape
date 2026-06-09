// Renders the running aggregate stats panel inside the Share modal.
// Pure DOM rendering — no fetching, no state.

const COUNTRY_NAMES = {
  GB: 'United Kingdom', US: 'United States', DE: 'Germany', AU: 'Australia',
  FR: 'France', JP: 'Japan', CA: 'Canada', IT: 'Italy', ES: 'Spain',
  NL: 'Netherlands', SE: 'Sweden', NO: 'Norway', IE: 'Ireland', NZ: 'New Zealand',
  ZZ: 'Unknown'
};

const AGE_LABELS = {
  'under-18': 'under 18', '18-24': '18–24', '25-34': '25–34',
  '35-44': '35–44', '45-54': '45–54', '55-64': '55–64',
  '65-plus': '65+', 'prefer-not-to-say': '(prefer not to say)'
};

const SELFTALK_LABELS = {
  'almost-never': 'almost never', sometimes: 'sometimes',
  often: 'often', 'almost-constantly': 'almost constantly',
  'prefer-not-to-say': '(prefer not to say)'
};

function modal(map, exclude = []) {
  let best = null;
  let bestCount = -1;
  for (const [k, v] of Object.entries(map)) {
    if (exclude.includes(k)) continue;
    if (v > bestCount) { best = k; bestCount = v; }
  }
  return best;
}

export function renderEmptyState(containerEl) {
  containerEl.innerHTML = `
    <div class="stats-panel stats-empty">
      Be among the first to contribute. We'll show contributor stats here once a few people have shared.
    </div>
  `;
}

export function renderStats(containerEl, stats) {
  const total = stats.total || 0;
  const countryEntries = Object.entries(stats.byCountry || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const countryCount = Object.keys(stats.byCountry || {}).length;
  const maxCount = countryEntries[0]?.[1] || 1;

  const modalAge = modal(stats.byAgeBand || {}, ['prefer-not-to-say']);
  const modalSelfTalk = modal(stats.bySelfTalkFreq || {}, ['prefer-not-to-say']);

  const bars = countryEntries.map(([code, count]) => {
    const pct = Math.round((count / maxCount) * 100);
    const name = COUNTRY_NAMES[code] || code;
    return `
      <li>
        <span class="stats-country-name">${name}</span>
        <span class="stats-bar"><span class="stats-bar-fill" style="width:${pct}%"></span></span>
        <span class="stats-country-count">${count}</span>
      </li>
    `;
  }).join('');

  containerEl.innerHTML = `
    <div class="stats-panel">
      <p class="stats-headline">${total} composition${total === 1 ? '' : 's'} from ${countryCount} countr${countryCount === 1 ? 'y' : 'ies'} so far</p>
      <p class="stats-subhead">Top regions:</p>
      <ul class="stats-bars">${bars}</ul>
      <p class="stats-modal">
        Contributors most often:
        ${modalAge ? `aged <strong>${AGE_LABELS[modalAge]}</strong>` : ''}
        ${modalAge && modalSelfTalk ? ' · ' : ''}
        ${modalSelfTalk ? `talk to themselves <strong>"${SELFTALK_LABELS[modalSelfTalk]}"</strong>` : ''}
      </p>
    </div>
  `;
}
