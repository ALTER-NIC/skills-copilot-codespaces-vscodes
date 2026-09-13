import { loadConfig, type AgentConfig } from './config.js';
import { createLogger } from './logger.js';
import { Fetcher, type HttpClient } from './http/fetcher.js';
import { extractCompanyFacts, type LinkedInProvider } from './linkedin/providers.js';
import { resolveCompanyWebsite } from './resolve/website.js';
import { discoverJobsList } from './resolve/careers.js';
import { matchAtsUrl, verifyAts } from './ats/registry.js';
import { normaliseToOrigin } from './util/url.js';
import type { CompanyIdentity, JobsListResult, Logger, TraceStep } from './types.js';

export interface ResolveOptions {
  config?: Partial<AgentConfig>;
  logger?: Logger;
  /** Override the provider chain (used by tests). */
  providers?: LinkedInProvider[];
  /** Reuse one Fetcher across many URLs so the cache and browser are shared. */
  fetcher?: HttpClient;
}

/**
 * End-to-end: a LinkedIn job posting URL -> the hiring company's job listing page.
 *
 * Every stage appends to `trace`, so a failure is explainable without re-running.
 */
export async function resolveJobsList(
  linkedinUrl: string,
  opts: ResolveOptions = {},
): Promise<JobsListResult> {
  const t0 = Date.now();
  const cfg = loadConfig(opts.config);
  const log = opts.logger ?? createLogger('info');
  const ownFetcher = !opts.fetcher;
  const fetcher = opts.fetcher ?? new Fetcher(cfg, log);

  const trace: TraceStep[] = [];
  const errors: string[] = [];
  const company: CompanyIdentity = { name: null, linkedinCompanyUrl: null, website: null, source: 'none' };

  const fail = (kind: JobsListResult['kind'] = 'not-found'): JobsListResult => ({
    input: linkedinUrl, company, jobsListUrl: null, kind, ats: null, atsSlug: null,
    jobCount: null, confidence: 0, trace, errors, totalMs: Date.now() - t0,
  });

  try {
    // Convenience: accept a direct ATS board or a plain company site too.
    const shortcut = await resolveShortcut(linkedinUrl, fetcher, trace);
    if (shortcut) return { ...shortcut, totalMs: Date.now() - t0 };

    // --- Stage 1: LinkedIn -> company identity -------------------------
    const s1 = Date.now();
    const { facts, sources } = await extractCompanyFacts(
      { jobUrl: linkedinUrl, fetcher, cfg, log }, opts.providers);
    company.name = facts.companyName;
    company.linkedinCompanyUrl = facts.linkedinCompanyUrl;
    company.source = sources.join('+') || 'none';
    trace.push({
      stage: 'linkedin',
      outcome: facts.companyName ? 'company-identified' : 'company-unknown',
      detail: facts.companyName
        ? `${facts.companyName}${facts.title ? ` — role: ${facts.title}` : ''} (via ${company.source})`
        : 'no provider returned a company; LinkedIn likely blocked this IP',
      url: facts.linkedinCompanyUrl ?? undefined,
      ms: Date.now() - s1,
    });
    if (!facts.companyName && !facts.linkedinCompanyUrl && !facts.companyWebsite) {
      errors.push('LinkedIn extraction failed: no company identified. Configure SCRAPINGDOG_API_KEY or PROXYCURL_API_KEY for reliable extraction from datacenter IPs.');
      return fail();
    }

    // --- Stage 2: company identity -> website --------------------------
    const s2 = Date.now();
    const site = await resolveCompanyWebsite({
      companyName: facts.companyName,
      linkedinCompanyUrl: facts.linkedinCompanyUrl,
      declaredWebsite: facts.companyWebsite,
      fetcher, log,
    });
    company.website = site.website;
    trace.push({
      stage: 'company-website',
      outcome: site.website ? `resolved:${site.how}` : `unresolved:${site.how}`,
      url: site.website ?? undefined,
      candidates: site.candidates.slice(0, 5),
      ms: Date.now() - s2,
    });
    if (!site.website) {
      errors.push(`Could not determine the company website for "${facts.companyName ?? 'unknown'}".`);
      return fail();
    }

    // --- Stage 3+4: website -> careers -> job listing page --------------
    const discovery = await discoverJobsList(site.website, {
      fetcher, cfg, log, trace,
      pagesFetched: { n: 0 }, requests: { n: 0 }, budget: { max: cfg.maxCrawlPages },
    });

    trace.push({
      stage: 'verification',
      outcome: discovery.jobsListUrl ? discovery.kind : 'not-found',
      detail: discovery.jobCount === null ? undefined : `${discovery.jobCount} open roles`,
      url: discovery.jobsListUrl ?? undefined,
      ms: 0,
    });
    if (!discovery.jobsListUrl) {
      errors.push(`Found the company website (${site.website}) but no job listing page.`);
    }

    return {
      input: linkedinUrl, company,
      jobsListUrl: discovery.jobsListUrl,
      kind: discovery.kind,
      ats: discovery.ats,
      atsSlug: discovery.atsSlug,
      jobCount: discovery.jobCount,
      confidence: discovery.confidence,
      trace, errors, totalMs: Date.now() - t0,
    };
  } catch (err) {
    errors.push(String(err instanceof Error ? err.message : err));
    log.error('resolve failed', { url: linkedinUrl, err: String(err) });
    return fail();
  } finally {
    if (ownFetcher) await fetcher.close();
  }
}

/**
 * If the caller passes something that is already an ATS board or a company
 * website, skip LinkedIn entirely. Makes the tool useful beyond the benchmark.
 */
async function resolveShortcut(
  input: string, fetcher: HttpClient, trace: TraceStep[],
): Promise<Omit<JobsListResult, 'totalMs'> | null> {
  if (/linkedin\.com/i.test(input)) return null;
  const direct = matchAtsUrl(input);
  if (!direct) return null;
  const count = await verifyAts(direct, fetcher);
  trace.push({
    stage: 'jobs-list-resolution', outcome: 'input-is-ats-board',
    detail: `${direct.ats}/${direct.slug}`, url: direct.boardUrl, ms: 0,
  });
  return {
    input,
    company: { name: direct.slug, linkedinCompanyUrl: null,
               website: normaliseToOrigin(direct.boardUrl), source: 'input' },
    jobsListUrl: direct.boardUrl, kind: 'ats-board', ats: direct.ats, atsSlug: direct.slug,
    jobCount: count, confidence: count === null ? 0.8 : 0.95, trace, errors: [],
  };
}

export { Fetcher, loadConfig, createLogger };
export type { JobsListResult, AgentConfig };
