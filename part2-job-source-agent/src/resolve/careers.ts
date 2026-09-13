import * as cheerio from 'cheerio';
import type { AgentConfig } from '../config.js';
import type { HttpClient } from '../http/fetcher.js';
import type { FetchedDoc, Logger, ResultKind, ScoredCandidate, TraceStep } from '../types.js';
import { findAtsInHtml, matchAtsUrl, verifyAts, type AtsMatch } from '../ats/registry.js';
import { analyseJobListPage } from '../verify/jobListPage.js';
import { rankCareersLinks, type LinkInput } from './score.js';
import { absolutise, normaliseToOrigin, registrableDomain, stripTracking } from '../util/url.js';

/** Paths worth probing directly; cheaper and more reliable than crawling. */
const WELL_KNOWN_PATHS = [
  '/careers', '/jobs', '/careers/jobs', '/careers/open-positions', '/join-us',
  '/company/careers', '/about/careers', '/company/jobs', '/about/jobs',
  '/work-with-us', '/opportunities', '/vacancies', '/en/careers', '/careers/openings',
];

/** Career-specific subdomains used by a large minority of companies. */
const CAREER_SUBDOMAINS = ['careers', 'jobs', 'talent', 'work', 'apply', 'hiring'];

export interface DiscoveryResult {
  jobsListUrl: string | null;
  kind: ResultKind;
  ats: string | null;
  atsSlug: string | null;
  jobCount: number | null;
  confidence: number;
}

interface Ctx {
  fetcher: HttpClient;
  cfg: AgentConfig;
  log: Logger;
  trace: TraceStep[];
  /** Pages actually parsed (404 probes are cheap and do not count). */
  pagesFetched: { n: number };
  /** Hard cap on total requests, so a pathological site cannot run away. */
  requests: { n: number };
  /** Mutable page budget; the sitemap fallback tops this up. */
  budget: { max: number };
}

/**
 * From a company website, find the page that lists that company's open jobs.
 *
 * Strategy, in descending order of reliability:
 *   1. ATS fingerprint anywhere in the site's HTML -> canonical board (verified by API)
 *   2. Direct probes of well-known career paths and career subdomains
 *   3. Ranked crawl of the homepage's links, one level deep
 *   4. sitemap.xml
 */
export async function discoverJobsList(
  website: string,
  ctx: Ctx,
): Promise<DiscoveryResult> {
  const started = Date.now();
  const origin = normaliseToOrigin(website) ?? website;

  const home = await fetchPage(origin, ctx);
  // The homepage footer very often already links the ATS board.
  const fromHome = await tryAts(findAtsInHtml(home.html), ctx, 'homepage-fingerprint');
  if (fromHome) return fromHome;

  const candidates = new Map<string, ScoredCandidate>();
  const add = (c: ScoredCandidate) => {
    const key = stripTracking(c.url);
    const prev = candidates.get(key);
    if (!prev || c.score > prev.score) candidates.set(key, { ...c, url: key });
  };

  for (const c of rankCareersLinks(extractLinks(home), home.finalUrl)) add(c);
  for (const p of WELL_KNOWN_PATHS) {
    add({ url: origin + p, score: 3.5, reasons: ['well-known-path'] });
  }
  for (const sub of careerSubdomains(origin)) {
    add({ url: sub, score: 4, reasons: ['career-subdomain'] });
  }

  ctx.trace.push({
    stage: 'careers-discovery',
    outcome: 'candidates-ranked',
    ms: Date.now() - started,
    url: origin,
    candidates: [...candidates.values()].sort((a, b) => b.score - a.score).slice(0, 8),
  });

  const result = await crawlCandidates([...candidates.values()], origin, ctx);
  if (result) return result;

  const fromSitemap = await trySitemap(origin, ctx);
  if (fromSitemap) return fromSitemap;

  return { jobsListUrl: null, kind: 'not-found', ats: null, atsSlug: null, jobCount: null, confidence: 0 };
}

/** Visit candidates best-first until one proves to be a jobs list. */
async function crawlCandidates(
  initial: ScoredCandidate[],
  origin: string,
  ctx: Ctx,
): Promise<DiscoveryResult | null> {
  const queue = [...initial].sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  /** Best "looks like careers but no job links" fallback. */
  let softFallback: string | null = null;
  /** A page with a listing headline but only one job link. */
  let weakFallback: { url: string; count: number } | null = null;

  while (queue.length && ctx.pagesFetched.n < ctx.budget.max
         && ctx.requests.n < ctx.cfg.maxCrawlPages * 5) {
    const cand = queue.shift()!;
    const key = stripTracking(cand.url);
    if (seen.has(key)) continue;
    seen.add(key);

    // A candidate that is itself an ATS URL needs no fetching to identify.
    const direct = matchAtsUrl(cand.url);
    if (direct) {
      const hit = await tryAts([direct], ctx, `direct-link(${cand.reasons.join(',')})`);
      if (hit) return hit;
    }

    const doc = await fetchPage(cand.url, ctx);
    if (doc.status < 200 || doc.status >= 400 || !doc.html) continue;

    const fingerprints = findAtsInHtml(doc.html);
    const viaAts = await tryAts(fingerprints, ctx, `page-fingerprint(${shortPath(cand.url)})`);
    if (viaAts) return viaAts;

    const evidence = analyseJobListPage(doc.html, doc.finalUrl);
    // "headline-weak" means a listing headline but only one job-ish link -- often
    // a culture page linking onward to the real board. Remember it, keep looking.
    if (evidence.isJobList && evidence.method === 'headline-weak') {
      weakFallback ??= { url: doc.finalUrl, count: evidence.count };
    } else if (evidence.isJobList) {
      const confidence =
        evidence.method === 'json-ld' || evidence.method === 'ats-dom' ? 0.85
        : evidence.method === 'job-links' ? 0.78
        : evidence.method === 'empty-board' ? 0.72
        : 0.55;
      ctx.trace.push({
        stage: 'jobs-list-resolution',
        outcome: `self-hosted:${evidence.method}`,
        detail: `${evidence.count} postings (${evidence.notes.join(', ')})`,
        url: doc.finalUrl,
        ms: 0,
      });
      return {
        jobsListUrl: stripTracking(doc.finalUrl),
        kind: 'self-hosted-list',
        ats: null,
        atsSlug: null,
        jobCount: evidence.count,
        confidence,
      };
    }

    softFallback ??= doc.finalUrl;

    // Not a list, but a careers landing page often links to the real board.
    const deeper = rankCareersLinks(extractLinks(doc), doc.finalUrl)
      .filter((c) => !seen.has(stripTracking(c.url)))
      .slice(0, 6);
    for (const d of deeper) queue.push({ ...d, score: d.score - 0.5 });
    queue.sort((a, b) => b.score - a.score);
  }

  if (weakFallback) {
    ctx.trace.push({
      stage: 'jobs-list-resolution', outcome: 'self-hosted:headline-weak',
      detail: 'listing headline present but only one job link found',
      url: weakFallback.url, ms: 0,
    });
    return {
      jobsListUrl: stripTracking(weakFallback.url), kind: 'self-hosted-list',
      ats: null, atsSlug: null, jobCount: weakFallback.count, confidence: 0.55,
    };
  }

  if (softFallback) {
    ctx.trace.push({
      stage: 'jobs-list-resolution',
      outcome: 'careers-page-unverified',
      detail: 'found a careers page but no individual job links',
      url: softFallback,
      ms: 0,
    });
    return {
      jobsListUrl: stripTracking(softFallback),
      kind: 'careers-page-unverified',
      ats: null, atsSlug: null, jobCount: null, confidence: 0.35,
    };
  }
  void origin;
  return null;
}

/** Confirm an ATS candidate and turn it into a result. */
async function tryAts(
  matches: AtsMatch[], ctx: Ctx, how: string,
): Promise<DiscoveryResult | null> {
  if (!matches.length) return null;
  for (const m of matches) {
    const t0 = Date.now();
    const count = await verifyAts(m, ctx.fetcher);

    if (count !== null) {
      ctx.trace.push({
        stage: 'jobs-list-resolution',
        outcome: 'ats-api-confirmed',
        detail: `${m.ats}/${m.slug} -> ${count} open roles (via ${how})`,
        url: m.boardUrl,
        ms: Date.now() - t0,
      });
      return {
        jobsListUrl: m.boardUrl, kind: 'ats-board', ats: m.ats, atsSlug: m.slug,
        jobCount: count, confidence: count > 0 ? 0.98 : 0.9,
      };
    }

    // No public API (or it failed): confirm by loading the board itself.
    const doc = await fetchPage(m.boardUrl, ctx);
    const evidence = analyseJobListPage(doc.html, doc.finalUrl);
    // A confirmed ATS board is the listing page even on weak page evidence.
    if (evidence.isJobList) {
      ctx.trace.push({
        stage: 'jobs-list-resolution',
        outcome: 'ats-page-confirmed',
        detail: `${m.ats}/${m.slug} -> ${evidence.count} postings (via ${how})`,
        url: m.boardUrl, ms: Date.now() - t0,
      });
      return {
        jobsListUrl: m.boardUrl, kind: 'ats-board', ats: m.ats, atsSlug: m.slug,
        jobCount: evidence.count, confidence: 0.88,
      };
    }
    ctx.log.debug('ats candidate not confirmed', { ats: m.ats, slug: m.slug });
  }
  return null;
}

async function trySitemap(origin: string, ctx: Ctx): Promise<DiscoveryResult | null> {
  const doc = await fetchPage(`${origin}/sitemap.xml`, ctx, { noRender: true });
  if (!doc.html) return null;
  const locs = [...doc.html.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) => m[1]!);
  if (!locs.length) return null;
  // Reuse the tuned link scorer rather than maintaining a second keyword list.
  const scored = rankCareersLinks(locs.map((href) => ({ href, text: '' })), origin).slice(0, 10);
  if (!scored.length) return null;

  ctx.budget.max = ctx.pagesFetched.n + 6;
  ctx.trace.push({
    stage: 'careers-discovery', outcome: 'sitemap-candidates',
    detail: `${scored.length} career-ish URLs in sitemap`, url: `${origin}/sitemap.xml`, ms: 0,
    candidates: scored.slice(0, 5),
  });
  const cands = scored.map<ScoredCandidate>((c) => ({ ...c, reasons: [...c.reasons, 'sitemap'] }));
  return crawlCandidates(cands, origin, ctx);
}

// ---- page helpers -----------------------------------------------------

/** Fetch, upgrading to a rendered page when the HTML is an empty JS shell. */
async function fetchPage(
  url: string, ctx: Ctx, opts: { noRender?: boolean } = {},
): Promise<FetchedDoc> {
  ctx.requests.n++;
  const doc = await ctx.fetcher.getText(url);
  // Only a page we can actually parse consumes crawl budget.
  if (doc.status >= 200 && doc.status < 400 && doc.html) ctx.pagesFetched.n++;
  if (opts.noRender || !ctx.cfg.useBrowser) return doc;
  if (doc.status >= 200 && doc.status < 400 && !looksLikeJsShell(doc.html)) return doc;
  ctx.log.debug('upgrading to rendered fetch', { url, status: doc.status });
  return ctx.fetcher.render(url);
}

/** Heuristic: a hydrated SPA shell has markup but almost no links or text. */
export function looksLikeJsShell(html: string): boolean {
  if (!html) return true;
  const links = (html.match(/<a\s+[^>]*href=/gi) ?? []).length;
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return links < 5 && text.length < 800;
}

/** Extract links with a coarse DOM region label for scoring. */
export function extractLinks(doc: FetchedDoc): LinkInput[] {
  const $ = cheerio.load(doc.html || '');
  const out: LinkInput[] = [];
  $('a[href]').each((_, el) => {
    const $el = $(el);
    const href = $el.attr('href');
    if (!href) return;
    const region: LinkInput['region'] =
      $el.closest('footer, [class*=footer], [id*=footer]').length ? 'footer'
      : $el.closest('nav, header, [class*=nav], [role=navigation]').length ? 'nav'
      : 'body';
    out.push({ href, text: $el.text().replace(/\s+/g, ' ').trim(), region });
  });
  return out;
}

function careerSubdomains(origin: string): string[] {
  const domain = registrableDomain(origin);
  if (!domain) return [];
  return CAREER_SUBDOMAINS.map((s) => `https://${s}.${domain}`);
}

const shortPath = (u: string): string => {
  try { return new URL(u).pathname || '/'; } catch { return u; }
};

export { absolutise };
