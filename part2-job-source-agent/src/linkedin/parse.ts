import * as cheerio from 'cheerio';

/** Pull the numeric posting id out of any LinkedIn job URL shape. */
export function extractJobId(url: string): string | null {
  const direct = /\/jobs\/view\/(?:[^/]*-)?(\d{6,})/.exec(url);
  if (direct?.[1]) return direct[1];
  try {
    const u = new URL(url);
    const q = u.searchParams.get('currentJobId') ?? u.searchParams.get('jobId');
    if (q && /^\d{6,}$/.test(q)) return q;
  } catch {
    /* not a URL */
  }
  const loose = /(\d{10,})/.exec(url);
  return loose?.[1] ?? null;
}

export interface LinkedInJobFacts {
  companyName: string | null;
  linkedinCompanyUrl: string | null;
  /** Website declared by the posting itself (JSON-LD sameAs). Rare but authoritative. */
  companyWebsite: string | null;
  title: string | null;
}

/**
 * Parse a LinkedIn job page (full page or the jobs-guest HTML fragment).
 *
 * Order matters: JSON-LD is structured and authoritative, so it wins; the
 * topcard anchor is the reliable fallback present in the guest fragment.
 */
export function parseJobPage(html: string): LinkedInJobFacts {
  const out: LinkedInJobFacts = {
    companyName: null, linkedinCompanyUrl: null, companyWebsite: null, title: null,
  };
  if (!html) return out;
  const $ = cheerio.load(html);

  for (const el of $('script[type="application/ld+json"]').toArray()) {
    const posting = findJobPosting(safeParse($(el).text()));
    if (!posting) continue;
    const org = posting.hiringOrganization;
    if (typeof posting.title === 'string') out.title ??= posting.title;
    if (org && typeof org === 'object') {
      const o = org as Record<string, unknown>;
      if (typeof o.name === 'string') out.companyName ??= o.name.trim();
      const sameAs = firstString(o.sameAs);
      if (sameAs) {
        if (/linkedin\.com\/company\//i.test(sameAs)) out.linkedinCompanyUrl ??= sameAs;
        else out.companyWebsite ??= sameAs;
      }
      const url = firstString(o.url);
      if (url && !/linkedin\.com/i.test(url)) out.companyWebsite ??= url;
    }
  }

  // Topcard anchor -> /company/{slug}; present on guest pages and fragments.
  const orgLink = $(
    'a.topcard__org-name-link, a[data-tracking-control-name="public_jobs_topcard-org-name"], ' +
    '.topcard__flavor a, a[href*="/company/"]',
  ).first();
  const href = orgLink.attr('href');
  if (href && /\/company\//.test(href)) {
    out.linkedinCompanyUrl ??= cleanLinkedInUrl(href);
    out.companyName ??= orgLink.text().trim() || null;
  }

  out.companyName ??= textOrNull($, '.topcard__org-name-link, .topcard__flavor--black-link');
  out.title ??= textOrNull($, 'h1.topcard__title, h1.top-card-layout__title, h1');
  if (out.companyName) out.companyName = tidyName(out.companyName);
  return out;
}

/** Parse a LinkedIn company page for the company's declared website. */
export function parseCompanyPage(html: string): { website: string | null; name: string | null } {
  const out: { website: string | null; name: string | null } = { website: null, name: null };
  if (!html) return out;
  const $ = cheerio.load(html);

  for (const el of $('script[type="application/ld+json"]').toArray()) {
    const data = safeParse($(el).text());
    const org = findOrganization(data);
    if (!org) continue;
    if (typeof org.name === 'string') out.name ??= tidyName(org.name);
    const url = firstString(org.url) ?? firstString(org.sameAs);
    if (url && !/linkedin\.com/i.test(url)) out.website ??= url;
  }

  // Guest company pages link out through /redir/redirect?url=<encoded>
  for (const el of $('a[href*="/redir/redirect"], a[data-tracking-control-name*="website"]').toArray()) {
    const href = $(el).attr('href');
    const resolved = href ? unwrapRedirect(href) : null;
    if (resolved) { out.website ??= resolved; break; }
  }

  out.name ??= textOrNull($, 'h1');
  return out;
}

/** LinkedIn wraps outbound links; recover the real destination. */
export function unwrapRedirect(href: string): string | null {
  try {
    const u = new URL(href, 'https://www.linkedin.com');
    const target = u.searchParams.get('url');
    if (!target) return null;
    const decoded = decodeURIComponent(target);
    return /^https?:\/\//i.test(decoded) && !/linkedin\.com/i.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

export function cleanLinkedInUrl(href: string): string | null {
  try {
    const u = new URL(href, 'https://www.linkedin.com');
    u.search = '';
    u.hash = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

// ---- helpers ----------------------------------------------------------

type Obj = Record<string, unknown>;

function safeParse(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

/** JSON-LD may be an object, an array, or wrapped in @graph. */
function walk(data: unknown, pred: (o: Obj) => boolean): Obj | null {
  if (!data || typeof data !== 'object') return null;
  if (Array.isArray(data)) {
    for (const item of data) {
      const hit = walk(item, pred);
      if (hit) return hit;
    }
    return null;
  }
  const o = data as Obj;
  if (pred(o)) return o;
  if (o['@graph']) return walk(o['@graph'], pred);
  return null;
}

const findJobPosting = (d: unknown): Obj | null =>
  walk(d, (o) => typeOf(o).includes('JobPosting'));

const findOrganization = (d: unknown): Obj | null =>
  walk(d, (o) => typeOf(o).some((t) => t === 'Organization' || t === 'Corporation'));

function typeOf(o: Obj): string[] {
  const t = o['@type'];
  if (typeof t === 'string') return [t];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === 'string');
  return [];
}

function firstString(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    const s = v.find((x) => typeof x === 'string');
    return typeof s === 'string' ? s : null;
  }
  return null;
}

function textOrNull($: cheerio.CheerioAPI, sel: string): string | null {
  const t = $(sel).first().text().trim();
  return t || null;
}

/** Strip legal suffixes and decoration that hurt later domain matching. */
export function tidyName(name: string): string {
  return name
    .replace(/\s+/g, ' ')
    .replace(/\s*[|·].*$/, '')
    .replace(/,?\s+(Inc|LLC|Ltd|Limited|GmbH|B\.?V|S\.?A|Corp|Corporation|Co|PLC|AB|Oy|AS|SAS|SARL)\.?$/i, '')
    .trim();
}
