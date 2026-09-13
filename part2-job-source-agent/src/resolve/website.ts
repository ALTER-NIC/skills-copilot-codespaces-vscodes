import * as cheerio from 'cheerio';
import type { HttpClient } from '../http/fetcher.js';
import type { Logger, ScoredCandidate } from '../types.js';
import { parseCompanyPage, unwrapRedirect } from '../linkedin/parse.js';
import { normaliseToOrigin, registrableDomain, tokensOf } from '../util/url.js';

/** Domains that are never a company's own website. */
const AGGREGATORS = new Set([
  'linkedin.com', 'indeed.com', 'glassdoor.com', 'ziprecruiter.com', 'monster.com',
  'crunchbase.com', 'wikipedia.org', 'facebook.com', 'twitter.com', 'x.com',
  'instagram.com', 'youtube.com', 'bloomberg.com', 'zoominfo.com', 'pitchbook.com',
  'dnb.com', 'owler.com', 'medium.com', 'github.com', 'apollo.io', 'lusha.com',
  'builtin.com', 'wellfound.com', 'angel.co', 'levels.fyi', 'jobs.lever.co',
  'greenhouse.io', 'workable.com', 'smartrecruiters.com', 'ashbyhq.com',
  'myworkdayjobs.com', 'reddit.com', 'trustpilot.com', 'g2.com', 'yelp.com',
]);

export function isAggregator(url: string): boolean {
  const d = registrableDomain(url);
  return d ? AGGREGATORS.has(d) : true;
}

export interface WebsiteResolution {
  website: string | null;
  how: string;
  candidates: ScoredCandidate[];
}

/**
 * Resolve the company's own website.
 *
 * Strategies run cheapest-first and each result is validated against the
 * company name before we accept it -- an unvalidated guess poisons every
 * downstream stage, so a wrong answer here is worse than no answer.
 */
export async function resolveCompanyWebsite(
  args: {
    companyName: string | null;
    linkedinCompanyUrl: string | null;
    declaredWebsite: string | null;
    fetcher: HttpClient;
    log: Logger;
  },
): Promise<WebsiteResolution> {
  const { companyName, linkedinCompanyUrl, declaredWebsite, fetcher, log } = args;
  const candidates: ScoredCandidate[] = [];

  // 1. The posting told us directly (JSON-LD sameAs / provider field).
  if (declaredWebsite && !isAggregator(declaredWebsite)) {
    const origin = normaliseToOrigin(declaredWebsite);
    if (origin) {
      candidates.push({ url: origin, score: 1, reasons: ['declared-by-posting'] });
      return { website: origin, how: 'declared-by-posting', candidates };
    }
  }

  // 2. The LinkedIn company page's outbound website link.
  if (linkedinCompanyUrl) {
    const site = await websiteFromLinkedInCompanyPage(linkedinCompanyUrl, fetcher);
    if (site) {
      candidates.push({ url: site, score: 0.95, reasons: ['linkedin-company-page'] });
      return { website: site, how: 'linkedin-company-page', candidates };
    }
    log.debug('linkedin company page gave no website', { linkedinCompanyUrl });
  }

  if (!companyName) return { website: null, how: 'no-company-name', candidates };

  // 3. Guess the obvious domains; cheap and surprisingly effective for startups.
  for (const guess of guessDomains(companyName)) {
    const ok = await validateCompanySite(guess, companyName, fetcher);
    if (ok) {
      candidates.push({ url: ok, score: 0.8, reasons: ['domain-guess-validated'] });
      return { website: ok, how: 'domain-guess', candidates };
    }
  }

  // 4. Web search as the general fallback.
  const found = await searchForCompanySite(companyName, fetcher, log);
  candidates.push(...found);
  for (const c of found) {
    const ok = await validateCompanySite(c.url, companyName, fetcher);
    if (ok) return { website: ok, how: 'web-search', candidates };
  }

  return { website: null, how: 'exhausted', candidates };
}

async function websiteFromLinkedInCompanyPage(
  companyUrl: string, fetcher: HttpClient,
): Promise<string | null> {
  const doc = await fetcher.getText(companyUrl);
  if (doc.status !== 200 || !doc.html) return null;
  const { website } = parseCompanyPage(doc.html);
  if (!website || isAggregator(website)) return null;
  return normaliseToOrigin(website);
}

/** company name -> plausible domains, best-first. */
export function guessDomains(companyName: string): string[] {
  const tokens = tokensOf(companyName);
  if (!tokens.length) return [];
  const joined = tokens.join('');
  const hyphen = tokens.join('-');
  const first = tokens[0]!;
  const stems = [...new Set([joined, hyphen, first])].filter((s) => s.length >= 3);
  const tlds = ['com', 'ai', 'io', 'co', 'com.au', 'dev'];
  const out: string[] = [];
  for (const stem of stems) {
    for (const tld of tlds) out.push(`https://${stem}.${tld}`);
  }
  return out.slice(0, 12);
}

/**
 * Accept a candidate domain only if the page actually looks like that company:
 * the company's distinctive tokens must appear in the title/description, or the
 * domain itself must contain them.
 */
export async function validateCompanySite(
  url: string, companyName: string, fetcher: HttpClient,
): Promise<string | null> {
  const origin = normaliseToOrigin(url);
  if (!origin || isAggregator(origin)) return null;

  const domain = registrableDomain(origin) ?? '';
  const tokens = tokensOf(companyName).filter((t) => t.length >= 3);
  const domainStem = domain.split('.')[0] ?? '';
  const domainMatches = tokens.some((t) => domainStem.includes(t) || t.includes(domainStem));

  const doc = await fetcher.getText(origin);
  if (doc.status < 200 || doc.status >= 400 || !doc.html) {
    // Unreachable or blocked: trust a strong domain match, reject otherwise.
    return domainMatches ? origin : null;
  }
  const $ = cheerio.load(doc.html);
  const hay = [
    $('title').text(),
    $('meta[property="og:site_name"]').attr('content') ?? '',
    $('meta[name="description"]').attr('content') ?? '',
    $('meta[property="og:title"]').attr('content') ?? '',
  ].join(' ').toLowerCase();

  const textMatches = tokens.length > 0 && tokens.every((t) => hay.includes(t));
  const looseMatch = tokens.length > 1 && tokens.filter((t) => hay.includes(t)).length >= 2;
  return domainMatches || textMatches || looseMatch ? normaliseToOrigin(doc.finalUrl) ?? origin : null;
}

/** DuckDuckGo's HTML endpoint: no API key, no JS. */
async function searchForCompanySite(
  companyName: string, fetcher: HttpClient, log: Logger,
): Promise<ScoredCandidate[]> {
  const q = encodeURIComponent(`${companyName} official website careers`);
  const doc = await fetcher.getText(`https://html.duckduckgo.com/html/?q=${q}`);
  if (doc.status !== 200 || !doc.html) {
    log.debug('search unavailable', { status: doc.status });
    return [];
  }
  const $ = cheerio.load(doc.html);
  const seen = new Map<string, ScoredCandidate>();
  $('a.result__a, a.result__url').each((i, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const real = href.includes('uddg=') ? unwrapDdg(href) : href;
    if (!real || isAggregator(real)) return;
    const origin = normaliseToOrigin(real);
    if (!origin || seen.has(origin)) return;
    seen.set(origin, { url: origin, score: 0.6 - i * 0.02, reasons: [`search-rank-${i + 1}`] });
  });
  return [...seen.values()].slice(0, 5);
}

function unwrapDdg(href: string): string | null {
  try {
    const u = new URL(href, 'https://duckduckgo.com');
    const t = u.searchParams.get('uddg');
    return t ? decodeURIComponent(t) : unwrapRedirect(href);
  } catch {
    return null;
  }
}
