// Calls ipapi.co to resolve the user's IP into {country, region}.
// On timeout or error, returns {country: 'ZZ', region: 'Unknown'}.
// Never exposes the raw IP to the calling code.

const TIMEOUT_MS = 3000;
const FALLBACK = Object.freeze({ country: 'ZZ', region: 'Unknown' });

export async function getLocation() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch('https://ipapi.co/json/', { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!response.ok) return FALLBACK;
    const data = await response.json();
    const country = typeof data.country_code === 'string' && /^[A-Z]{2}$/.test(data.country_code)
      ? data.country_code
      : 'ZZ';
    const region = typeof data.region === 'string' && data.region.length > 0
      ? data.region.slice(0, 100)
      : 'Unknown';
    return { country, region };
  } catch (e) {
    clearTimeout(timeoutId);
    return FALLBACK;
  }
}
