import type { AgentConfig } from '../config.js';
import type { HttpClient } from '../http/fetcher.js';
import type { Logger } from '../types.js';
import { extractJobId, parseJobPage, tidyName, type LinkedInJobFacts } from './parse.js';

export interface ProviderCtx {
  jobUrl: string;
  jobId: string | null;
  fetcher: HttpClient;
  cfg: AgentConfig;
  log: Logger;
}

export interface LinkedInProvider {
  id: string;
  /** Human label for the report. */
  label: string;
  /** Free providers are ordered first; paid ones only run if configured. */
  isAvailable(cfg: AgentConfig): boolean;
  run(ctx: ProviderCtx): Promise<LinkedInJobFacts | null>;
}

const EMPTY = (f: LinkedInJobFacts | null): boolean =>
  !f || (!f.companyName && !f.linkedinCompanyUrl && !f.companyWebsite);

/**
 * LinkedIn's unauthenticated "guest" fragment endpoint. Free and fast, but
 * aggressively rate-limited from datacenter IPs -- which is exactly why the
 * paid providers below exist as fallbacks.
 */
export const guestFragmentProvider: LinkedInProvider = {
  id: 'linkedin-guest-api',
  label: 'LinkedIn guest fragment API',
  isAvailable: () => true,
  async run({ jobId, fetcher, log }) {
    if (!jobId) return null;
    const url = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${jobId}`;
    const doc = await fetcher.getText(url);
    if (doc.status !== 200 || !doc.html) {
      log.debug('guest fragment unavailable', { status: doc.status });
      return null;
    }
    return parseJobPage(doc.html);
  },
};

/** The public job view page. Carries JSON-LD when LinkedIn serves the guest shell. */
export const publicPageProvider: LinkedInProvider = {
  id: 'linkedin-public-page',
  label: 'LinkedIn public job page',
  isAvailable: () => true,
  async run({ jobUrl, fetcher }) {
    const doc = await fetcher.getText(jobUrl);
    if (doc.status !== 200 || !doc.html) return null;
    return parseJobPage(doc.html);
  },
};

export const scrapingdogProvider: LinkedInProvider = {
  id: 'scrapingdog',
  label: 'ScrapingDog LinkedIn Jobs API',
  isAvailable: (cfg) => Boolean(cfg.scrapingdogApiKey),
  async run({ jobId, fetcher, cfg }) {
    if (!jobId || !cfg.scrapingdogApiKey) return null;
    const url = `https://api.scrapingdog.com/linkedinjobs?api_key=${encodeURIComponent(
      cfg.scrapingdogApiKey)}&job_id=${encodeURIComponent(jobId)}`;
    const json = await fetcher.getJson<unknown>(url);
    const row = Array.isArray(json) ? json[0] : json;
    if (!row || typeof row !== 'object') return null;
    const r = row as Record<string, unknown>;
    return {
      companyName: str(r.company_name) ? tidyName(str(r.company_name)!) : null,
      linkedinCompanyUrl: str(r.company_linkedin_url) ?? str(r.company_url) ?? null,
      companyWebsite: str(r.company_website) ?? null,
      title: str(r.job_position) ?? str(r.job_title) ?? null,
    };
  },
};

export const proxycurlProvider: LinkedInProvider = {
  id: 'proxycurl',
  label: 'Proxycurl Job API',
  isAvailable: (cfg) => Boolean(cfg.proxycurlApiKey),
  async run({ jobUrl, fetcher, cfg }) {
    if (!cfg.proxycurlApiKey) return null;
    const url = `https://nubela.co/proxycurl/api/linkedin/job?url=${encodeURIComponent(jobUrl)}`;
    const json = await fetcher.getJson<Record<string, unknown>>(url, {
      headers: { authorization: `Bearer ${cfg.proxycurlApiKey}` },
    });
    if (!json) return null;
    const company = (json.company ?? {}) as Record<string, unknown>;
    return {
      companyName: str(company.name) ? tidyName(str(company.name)!) : null,
      linkedinCompanyUrl: str(company.url) ?? null,
      companyWebsite: str(company.website) ?? null,
      title: str(json.job_title) ?? null,
    };
  },
};

export const apifyProvider: LinkedInProvider = {
  id: 'apify',
  label: 'Apify LinkedIn scraper actor',
  isAvailable: (cfg) => Boolean(cfg.apifyToken),
  async run({ jobUrl, fetcher, cfg }) {
    if (!cfg.apifyToken) return null;
    const actor = process.env.APIFY_ACTOR_ID ?? 'bebity~linkedin-jobs-scraper';
    const url = `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${
      encodeURIComponent(cfg.apifyToken)}`;
    const json = await fetcher.getJson<unknown[]>(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ startUrls: [{ url: jobUrl }], maxItems: 1 }),
    });
    const row = Array.isArray(json) ? (json[0] as Record<string, unknown> | undefined) : undefined;
    if (!row) return null;
    return {
      companyName: str(row.companyName) ? tidyName(str(row.companyName)!) : null,
      linkedinCompanyUrl: str(row.companyLinkedinUrl) ?? null,
      companyWebsite: str(row.companyWebsite) ?? null,
      title: str(row.title) ?? null,
    };
  },
};

/** Ordered cheapest-first; the orchestrator stops as soon as it has enough. */
export const DEFAULT_PROVIDERS: LinkedInProvider[] = [
  guestFragmentProvider,
  publicPageProvider,
  scrapingdogProvider,
  proxycurlProvider,
  apifyProvider,
];

/**
 * Run providers in order, merging partial results. LinkedIn blocks datacenter
 * IPs often enough that a single provider is never reliable; merging lets a
 * free provider supply the company name while a paid one supplies the website.
 */
export async function extractCompanyFacts(
  ctx: Omit<ProviderCtx, 'jobId'>,
  providers: LinkedInProvider[] = DEFAULT_PROVIDERS,
): Promise<{ facts: LinkedInJobFacts; sources: string[] }> {
  const jobId = extractJobId(ctx.jobUrl);
  const merged: LinkedInJobFacts = {
    companyName: null, linkedinCompanyUrl: null, companyWebsite: null, title: null,
  };
  const sources: string[] = [];

  for (const p of providers) {
    if (!p.isAvailable(ctx.cfg)) continue;
    let facts: LinkedInJobFacts | null = null;
    try {
      facts = await p.run({ ...ctx, jobId });
    } catch (err) {
      ctx.log.debug(`provider ${p.id} threw`, { err: String(err) });
    }
    if (EMPTY(facts)) continue;
    sources.push(p.id);
    merged.companyName ??= facts!.companyName;
    merged.linkedinCompanyUrl ??= facts!.linkedinCompanyUrl;
    merged.companyWebsite ??= facts!.companyWebsite;
    merged.title ??= facts!.title;
    ctx.log.debug(`provider ${p.id} hit`, merged);
    // A website is the jackpot; a name plus company page is enough to continue.
    if (merged.companyWebsite) break;
    if (merged.companyName && merged.linkedinCompanyUrl) break;
  }
  return { facts: merged, sources };
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
