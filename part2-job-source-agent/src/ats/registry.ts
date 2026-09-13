import type { HttpClient } from '../http/fetcher.js';

/**
 * Registry of Applicant Tracking Systems.
 *
 * This is the backbone of the resolver. The long tail of company career pages is
 * wildly inconsistent, but the moment a page reveals an ATS slug we can build the
 * canonical job-board URL deterministically -- and for most vendors we can hit a
 * public JSON endpoint that both proves the board exists and tells us how many
 * jobs are open. That turns a fuzzy crawl into a verifiable answer.
 */
export interface AtsMatch {
  ats: string;
  slug: string;
  boardUrl: string;
  extra?: Record<string, string>;
}

export interface AtsDefinition {
  id: string;
  name: string;
  /** Patterns that identify a *direct* board/job URL and capture the slug. */
  urlPatterns: RegExp[];
  /**
   * Patterns found inside a company's own careers page HTML (script srcs,
   * iframes, embed divs, XHR endpoints) that reveal the ATS slug.
   */
  embedPatterns?: RegExp[];
  /** Build the canonical "all open jobs" URL from a match. */
  boardUrl: (slug: string, extra?: Record<string, string>) => string;
  /** Public endpoint returning open postings; used to verify + count. */
  countJobs?: (m: AtsMatch, f: HttpClient) => Promise<number | null>;
  /** Slugs that are generic vendor pages rather than a customer board. */
  reservedSlugs?: string[];
}

const RESERVED_COMMON = ['', 'about', 'blog', 'privacy', 'terms', 'login', 'signup', 'pricing', 'contact', 'legal', 'search', 'jobs', 'companies', 'home', 'static', 'assets'];

/** Count helpers for the common JSON shapes. */
const countArray = (v: unknown): number | null => (Array.isArray(v) ? v.length : null);

export const ATS_REGISTRY: AtsDefinition[] = [
  {
    id: 'greenhouse',
    name: 'Greenhouse',
    urlPatterns: [
      /https?:\/\/(?:boards|job-boards)\.greenhouse\.io\/(?:embed\/job_board\?for=)?([a-z0-9][a-z0-9_-]*)/i,
      /https?:\/\/(?!boards\.|job-boards\.|www\.|app\.)([a-z0-9][a-z0-9_-]*)\.greenhouse\.io\/?/i,
    ],
    embedPatterns: [
      /boards\.greenhouse\.io\/embed\/job_board(?:\/js)?\?for=([a-z0-9][a-z0-9_-]*)/i,
      /boards-api\.greenhouse\.io\/v1\/boards\/([a-z0-9][a-z0-9_-]*)/i,
      /(?:job-boards|boards)\.greenhouse\.io\/([a-z0-9][a-z0-9_-]*)/i,
    ],
    boardUrl: (slug) => `https://job-boards.greenhouse.io/${slug}`,
    countJobs: async (m, f) => {
      const j = await f.getJson<{ jobs?: unknown[] }>(
        `https://boards-api.greenhouse.io/v1/boards/${m.slug}/jobs`);
      return countArray(j?.jobs);
    },
    reservedSlugs: [...RESERVED_COMMON, 'embed', 'v1', 'boards', 'job-boards', 'my', 'app'],
  },
  {
    id: 'lever',
    name: 'Lever',
    urlPatterns: [/https?:\/\/jobs\.(?:eu\.)?lever\.co\/([a-z0-9][a-z0-9_-]*)/i],
    embedPatterns: [
      /api\.lever\.co\/v0\/postings\/([a-z0-9][a-z0-9_-]*)/i,
      /jobs\.(?:eu\.)?lever\.co\/([a-z0-9][a-z0-9_-]*)/i,
    ],
    boardUrl: (slug) => `https://jobs.lever.co/${slug}`,
    countJobs: async (m, f) => {
      const j = await f.getJson<unknown[]>(
        `https://api.lever.co/v0/postings/${m.slug}?mode=json`);
      return countArray(j);
    },
    reservedSlugs: RESERVED_COMMON,
  },
  {
    id: 'ashby',
    name: 'Ashby',
    urlPatterns: [/https?:\/\/jobs\.ashbyhq\.com\/([a-z0-9][a-z0-9._-]*)/i],
    embedPatterns: [
      /api\.ashbyhq\.com\/posting-api\/job-board\/([a-z0-9][a-z0-9._-]*)/i,
      /jobs\.ashbyhq\.com\/([a-z0-9][a-z0-9._-]*)/i,
    ],
    boardUrl: (slug) => `https://jobs.ashbyhq.com/${slug}`,
    countJobs: async (m, f) => {
      const j = await f.getJson<{ jobs?: unknown[] }>(
        `https://api.ashbyhq.com/posting-api/job-board/${m.slug}`);
      return countArray(j?.jobs);
    },
    reservedSlugs: RESERVED_COMMON,
  },
  {
    id: 'workday',
    name: 'Workday',
    // https://tenant.wd5.myworkdayjobs.com/en-US/SiteName
    urlPatterns: [
      /https?:\/\/([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/,
    ],
    embedPatterns: [
      /([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/,
    ],
    boardUrl: (slug, extra) =>
      `https://${slug}.${extra?.wd ?? 'wd1'}.myworkdayjobs.com/${extra?.site ?? ''}`,
    countJobs: async (m, f) => {
      const { wd, site } = m.extra ?? {};
      if (!wd || !site) return null;
      const j = await f.getJson<{ total?: number }>(
        `https://${m.slug}.${wd}.myworkdayjobs.com/wday/cxs/${m.slug}/${site}/jobs`,
        { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: '' }) });
      return typeof j?.total === 'number' ? j.total : null;
    },
  },
  {
    id: 'smartrecruiters',
    name: 'SmartRecruiters',
    urlPatterns: [
      /https?:\/\/(?:jobs|careers)\.smartrecruiters\.com\/([A-Za-z0-9][A-Za-z0-9_-]*)/i,
    ],
    embedPatterns: [
      /api\.smartrecruiters\.com\/v1\/companies\/([A-Za-z0-9][A-Za-z0-9_-]*)/i,
      /(?:jobs|careers)\.smartrecruiters\.com\/([A-Za-z0-9][A-Za-z0-9_-]*)/i,
    ],
    boardUrl: (slug) => `https://jobs.smartrecruiters.com/${slug}`,
    countJobs: async (m, f) => {
      const j = await f.getJson<{ totalFound?: number }>(
        `https://api.smartrecruiters.com/v1/companies/${m.slug}/postings?limit=1`);
      return typeof j?.totalFound === 'number' ? j.totalFound : null;
    },
    reservedSlugs: RESERVED_COMMON,
  },
  {
    id: 'workable',
    name: 'Workable',
    urlPatterns: [/https?:\/\/(?:apply|jobs)\.workable\.com\/([a-z0-9][a-z0-9_-]*)/i],
    embedPatterns: [
      /apply\.workable\.com\/api\/v1\/widget\/accounts\/([a-z0-9][a-z0-9_-]*)/i,
      /apply\.workable\.com\/([a-z0-9][a-z0-9_-]*)/i,
    ],
    boardUrl: (slug) => `https://apply.workable.com/${slug}/`,
    countJobs: async (m, f) => {
      const j = await f.getJson<{ jobs?: unknown[] }>(
        `https://apply.workable.com/api/v1/widget/accounts/${m.slug}?details=true`);
      return countArray(j?.jobs);
    },
    reservedSlugs: [...RESERVED_COMMON, 'api', 'j'],
  },
  {
    id: 'recruitee',
    name: 'Recruitee',
    urlPatterns: [/https?:\/\/([a-z0-9][a-z0-9-]*)\.recruitee\.com/i],
    embedPatterns: [/([a-z0-9][a-z0-9-]*)\.recruitee\.com/i],
    boardUrl: (slug) => `https://${slug}.recruitee.com/`,
    countJobs: async (m, f) => {
      const j = await f.getJson<{ offers?: unknown[] }>(
        `https://${m.slug}.recruitee.com/api/offers/`);
      return countArray(j?.offers);
    },
    reservedSlugs: ['www', 'api', 'help', 'app'],
  },
  {
    id: 'teamtailor',
    name: 'Teamtailor',
    urlPatterns: [/https?:\/\/([a-z0-9][a-z0-9-]*)\.teamtailor\.com/i],
    embedPatterns: [/([a-z0-9][a-z0-9-]*)\.teamtailor\.com/i],
    boardUrl: (slug) => `https://${slug}.teamtailor.com/jobs`,
    reservedSlugs: ['www', 'app', 'blog', 'support'],
  },
  {
    id: 'personio',
    name: 'Personio',
    urlPatterns: [/https?:\/\/([a-z0-9][a-z0-9-]*)\.jobs\.personio\.(?:de|com)/i],
    embedPatterns: [/([a-z0-9][a-z0-9-]*)\.jobs\.personio\.(?:de|com)/i],
    boardUrl: (slug) => `https://${slug}.jobs.personio.com/`,
    reservedSlugs: ['www'],
  },
  {
    id: 'bamboohr',
    name: 'BambooHR',
    urlPatterns: [/https?:\/\/([a-z0-9][a-z0-9-]*)\.bamboohr\.com\/(?:careers|jobs)/i],
    embedPatterns: [/([a-z0-9][a-z0-9-]*)\.bamboohr\.com\/(?:careers|jobs)/i],
    boardUrl: (slug) => `https://${slug}.bamboohr.com/careers`,
    countJobs: async (m, f) => {
      const j = await f.getJson<{ result?: unknown[] }>(
        `https://${m.slug}.bamboohr.com/careers/list`);
      return countArray(j?.result);
    },
    reservedSlugs: ['www', 'app'],
  },
  {
    id: 'jazzhr',
    name: 'JazzHR',
    urlPatterns: [/https?:\/\/([a-z0-9][a-z0-9-]*)\.applytojob\.com/i],
    embedPatterns: [/([a-z0-9][a-z0-9-]*)\.applytojob\.com/i],
    boardUrl: (slug) => `https://${slug}.applytojob.com/apply`,
    reservedSlugs: ['www', 'app'],
  },
  {
    id: 'breezy',
    name: 'Breezy HR',
    urlPatterns: [/https?:\/\/([a-z0-9][a-z0-9-]*)\.breezy\.hr/i],
    embedPatterns: [/([a-z0-9][a-z0-9-]*)\.breezy\.hr/i],
    boardUrl: (slug) => `https://${slug}.breezy.hr/`,
    reservedSlugs: ['www', 'app'],
  },
  {
    id: 'icims',
    name: 'iCIMS',
    urlPatterns: [/https?:\/\/(?:careers-)?([a-z0-9][a-z0-9-]*)\.icims\.com/i],
    embedPatterns: [/(?:careers-)?([a-z0-9][a-z0-9-]*)\.icims\.com/i],
    boardUrl: (slug) => `https://careers-${slug}.icims.com/jobs/search`,
    reservedSlugs: ['www', 'app'],
  },
  {
    id: 'jobvite',
    name: 'Jobvite',
    urlPatterns: [/https?:\/\/jobs\.jobvite\.com\/([a-z0-9][a-z0-9-]*)/i],
    embedPatterns: [/jobs\.jobvite\.com\/([a-z0-9][a-z0-9-]*)/i],
    boardUrl: (slug) => `https://jobs.jobvite.com/${slug}`,
    reservedSlugs: RESERVED_COMMON,
  },
  {
    id: 'rippling',
    name: 'Rippling',
    urlPatterns: [/https?:\/\/ats\.rippling\.com\/([a-z0-9][a-z0-9-]*)/i],
    embedPatterns: [/ats\.rippling\.com\/([a-z0-9][a-z0-9-]*)/i],
    boardUrl: (slug) => `https://ats.rippling.com/${slug}/jobs`,
    reservedSlugs: RESERVED_COMMON,
  },
  {
    id: 'pinpoint',
    name: 'Pinpoint',
    urlPatterns: [/https?:\/\/([a-z0-9][a-z0-9-]*)\.pinpointhq\.com/i],
    embedPatterns: [/([a-z0-9][a-z0-9-]*)\.pinpointhq\.com/i],
    boardUrl: (slug) => `https://${slug}.pinpointhq.com/`,
    reservedSlugs: ['www', 'app'],
  },
  {
    id: 'eightfold',
    name: 'Eightfold',
    urlPatterns: [/https?:\/\/([a-z0-9][a-z0-9-]*)\.eightfold\.ai\/careers/i],
    embedPatterns: [/([a-z0-9][a-z0-9-]*)\.eightfold\.ai\/careers/i],
    boardUrl: (slug) => `https://${slug}.eightfold.ai/careers`,
    reservedSlugs: ['www', 'app'],
  },
  {
    id: 'gem',
    name: 'Gem',
    urlPatterns: [/https?:\/\/jobs\.gem\.com\/([a-z0-9][a-z0-9-]*)/i],
    embedPatterns: [/jobs\.gem\.com\/([a-z0-9][a-z0-9-]*)/i],
    boardUrl: (slug) => `https://jobs.gem.com/${slug}`,
    reservedSlugs: RESERVED_COMMON,
  },
  {
    id: 'comeet',
    name: 'Comeet',
    urlPatterns: [/https?:\/\/(?:www\.)?comeet\.com\/jobs\/([a-z0-9][a-z0-9-]*)/i],
    embedPatterns: [/comeet\.com\/jobs\/([a-z0-9][a-z0-9-]*)/i],
    boardUrl: (slug) => `https://www.comeet.com/jobs/${slug}`,
    reservedSlugs: RESERVED_COMMON,
  },
  {
    id: 'zohorecruit',
    name: 'Zoho Recruit',
    urlPatterns: [/https?:\/\/([a-z0-9][a-z0-9-]*)\.zohorecruit\.com/i],
    embedPatterns: [/([a-z0-9][a-z0-9-]*)\.zohorecruit\.com/i],
    boardUrl: (slug) => `https://${slug}.zohorecruit.com/jobs/Careers`,
    reservedSlugs: ['www', 'app'],
  },
  {
    id: 'join',
    name: 'Join.com',
    urlPatterns: [/https?:\/\/join\.com\/companies\/([a-z0-9][a-z0-9-]*)/i],
    embedPatterns: [/join\.com\/companies\/([a-z0-9][a-z0-9-]*)/i],
    boardUrl: (slug) => `https://join.com/companies/${slug}`,
    reservedSlugs: RESERVED_COMMON,
  },
  {
    id: 'ultipro',
    name: 'UKG / UltiPro',
    urlPatterns: [/https?:\/\/recruiting\d*\.ultipro\.com\/([A-Za-z0-9]+)/i],
    embedPatterns: [/recruiting\d*\.ultipro\.com\/([A-Za-z0-9]+)/i],
    boardUrl: (slug) => `https://recruiting.ultipro.com/${slug}`,
  },
  {
    id: 'paylocity',
    name: 'Paylocity',
    urlPatterns: [/https?:\/\/recruiting\.paylocity\.com\/recruiting\/jobs\/All\/([a-f0-9-]+)/i],
    embedPatterns: [/recruiting\.paylocity\.com\/recruiting\/jobs\/All\/([a-f0-9-]+)/i],
    boardUrl: (slug) => `https://recruiting.paylocity.com/recruiting/jobs/All/${slug}`,
  },
  {
    id: 'dover',
    name: 'Dover',
    urlPatterns: [/https?:\/\/(?:app|jobs)\.dover\.(?:io|com)\/(?:company\/)?([a-z0-9-]+)/i],
    embedPatterns: [/(?:app|jobs)\.dover\.(?:io|com)\/(?:company\/)?([a-z0-9-]+)/i],
    boardUrl: (slug) => `https://app.dover.io/jobs/${slug}`,
    reservedSlugs: RESERVED_COMMON,
  },
  {
    id: 'taleo',
    name: 'Oracle Taleo',
    urlPatterns: [/https?:\/\/([a-z0-9-]+)\.taleo\.net/i],
    embedPatterns: [/([a-z0-9-]+)\.taleo\.net/i],
    boardUrl: (slug) => `https://${slug}.taleo.net/careersection/`,
    reservedSlugs: ['www'],
  },
];

const byId = new Map(ATS_REGISTRY.map((d) => [d.id, d]));
export const getAts = (id: string): AtsDefinition | undefined => byId.get(id);

/** Identify a direct ATS board/job URL. */
export function matchAtsUrl(url: string): AtsMatch | null {
  for (const def of ATS_REGISTRY) {
    for (const re of def.urlPatterns) {
      const m = re.exec(url);
      if (!m) continue;
      const built = buildMatch(def, m);
      if (built) return built;
    }
  }
  return null;
}

/**
 * Scan a page's HTML for any ATS fingerprint. This is what lets us resolve a
 * company careers page that merely *embeds* its board (very common) to the
 * canonical hosted board URL.
 */
export function findAtsInHtml(html: string): AtsMatch[] {
  const found = new Map<string, AtsMatch>();
  for (const def of ATS_REGISTRY) {
    for (const re of def.embedPatterns ?? []) {
      // Patterns are authored without /g; clone with /g to sweep the document.
      const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
      for (const m of html.matchAll(g)) {
        const built = buildMatch(def, m);
        if (built) found.set(`${built.ats}:${built.slug}`, built);
      }
    }
  }
  return [...found.values()];
}

function buildMatch(def: AtsDefinition, m: RegExpMatchArray): AtsMatch | null {
  if (def.id === 'workday') {
    const [, tenant, wd, site] = m;
    if (!tenant || !wd || !site) return null;
    const extra = { wd, site };
    return { ats: def.id, slug: tenant, extra, boardUrl: def.boardUrl(tenant, extra) };
  }
  const slug = m[1];
  if (!slug) return null;
  const lower = slug.toLowerCase();
  if (def.reservedSlugs?.includes(lower)) return null;
  if (lower.length < 2) return null;
  return { ats: def.id, slug, boardUrl: def.boardUrl(slug) };
}

/**
 * Verify a candidate board really exists and count its open roles.
 * Returns null when the vendor has no public API (absence of proof, not failure).
 */
export async function verifyAts(m: AtsMatch, f: HttpClient): Promise<number | null> {
  const def = byId.get(m.ats);
  if (!def?.countJobs) return null;
  try {
    return await def.countJobs(m, f);
  } catch {
    return null;
  }
}
