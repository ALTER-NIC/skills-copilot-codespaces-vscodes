/** URL and company-name normalisation shared across the pipeline. */

/** Multi-part public suffixes we care about, so foo.co.uk yields "foo.co.uk". */
const MULTI_PART_TLDS = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'co.jp', 'co.kr', 'co.nz', 'co.za',
  'co.in', 'com.au', 'net.au', 'org.au', 'com.br', 'com.sg', 'com.mx',
  'com.tr', 'com.cn', 'com.hk', 'com.tw', 'co.il', 'com.ar', 'com.es',
]);

export function registrableDomain(url: string): string | null {
  let host: string;
  try {
    host = new URL(url.includes('://') ? url : `https://${url}`).hostname.toLowerCase();
  } catch {
    return null;
  }
  host = host.replace(/^www\./, '');
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const lastTwo = parts.slice(-2).join('.');
  if (MULTI_PART_TLDS.has(lastTwo) && parts.length >= 3) return parts.slice(-3).join('.');
  return lastTwo;
}

/** Reduce any URL to a clean scheme+host origin. */
export function normaliseToOrigin(url: string): string | null {
  try {
    const u = new URL(url.includes('://') ? url : `https://${url}`);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/** Resolve a possibly-relative href against a base, dropping junk schemes. */
export function absolutise(href: string, base: string): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  if (/^(mailto:|tel:|javascript:|#|data:)/i.test(trimmed)) return null;
  try {
    const u = new URL(trimmed, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

/** True when two URLs live on the same registrable domain. */
export function sameSite(a: string, b: string): boolean {
  const da = registrableDomain(a);
  const db = registrableDomain(b);
  return Boolean(da && db && da === db);
}

const NAME_STOPWORDS = new Set([
  'the', 'and', 'inc', 'llc', 'ltd', 'limited', 'corp', 'corporation', 'company',
  'co', 'group', 'holdings', 'international', 'global', 'technologies', 'technology',
  'solutions', 'services', 'systems', 'software', 'labs', 'lab', 'partners',
  'ventures', 'capital', 'gmbh', 'bv', 'sa', 'plc', 'ag', 'as', 'ab', 'oy', 'sas',
]);

/**
 * Distinctive lowercase tokens of a company name, used for domain guessing and
 * for validating that a candidate site really belongs to the company.
 */
export function tokensOf(name: string): string[] {
  const raw = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const filtered = raw.filter((t) => !NAME_STOPWORDS.has(t));
  // Never return empty: a company literally called "The Group" still needs tokens.
  return (filtered.length ? filtered : raw).slice(0, 4);
}

/** Strip tracking params so results compare equal across runs. */
export function stripTracking(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|ref|referrer|gh_src|source|trk|trackingId|originalSubdomain)/i.test(k)) {
        u.searchParams.delete(k);
      }
    }
    return u.toString().replace(/\?$/, '');
  } catch {
    return url;
  }
}
