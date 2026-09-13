import * as cheerio from 'cheerio';
import { absolutise } from '../util/url.js';

export interface JobListEvidence {
  isJobList: boolean;
  count: number;
  /** How we concluded it: json-ld | ats-dom | job-links | headline-only. */
  method: string;
  sampleJobUrls: string[];
  notes: string[];
}

/** DOM fingerprints of rendered ATS boards. */
const ATS_ROW_SELECTORS = [
  '.opening',                                   // Greenhouse
  '.posting',                                   // Lever
  'a[href*="/jobs/"][class*="posting"]',
  '[class*="job-posting-row"], [class*="jobPosting"]', // Ashby
  '[data-automation-id="jobTitle"]',            // Workday
  '[data-testid*="job-card"], [data-test*="job-card"]',
  'li[class*="job"] a[href]',
  '[itemtype*="JobPosting"]',
];

/** Path shapes that indicate an individual job detail page. */
const JOB_DETAIL_PATTERNS: RegExp[] = [
  /\/jobs?\/[A-Za-z0-9][A-Za-z0-9_-]{2,}/i,
  /\/careers?\/[A-Za-z0-9][A-Za-z0-9_-]{2,}/i,
  /\/(positions?|openings?|vacanc(?:y|ies)|roles?)\/[A-Za-z0-9][A-Za-z0-9_-]{2,}/i,
  /\/o\/[A-Za-z0-9_-]{4,}/i,                    // Recruitee
  /[?&]gh_jid=\d+/i,                            // Greenhouse embed
  /\/job-details?\//i,
  /\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i, // Lever/Ashby UUIDs
];

/** Section headings that appear above a real list of roles. */
const LIST_HEADINGS =
  /\b(open (positions|roles|jobs|opportunities)|current (openings|vacancies)|join (our|the) team|all jobs|browse jobs|we'?re hiring|job openings|explore (roles|opportunities))\b/i;

/**
 * Decide whether a page is a job *listing* page and how many roles it shows.
 *
 * The bar is deliberately "individual job detail links are present", because a
 * careers landing page full of culture copy is not the deliverable -- the job
 * listing page is.
 */
export function analyseJobListPage(html: string, baseUrl: string): JobListEvidence {
  const notes: string[] = [];
  if (!html) return { isJobList: false, count: 0, method: 'empty', sampleJobUrls: [], notes };
  const $ = cheerio.load(html);

  // 1. Structured data is unambiguous.
  const ldCount = countJsonLdPostings($);
  if (ldCount >= 1) {
    notes.push(`json-ld:${ldCount}`);
    if (ldCount >= 2) {
      return { isJobList: true, count: ldCount, method: 'json-ld',
               sampleJobUrls: collectJobLinks($, baseUrl, true).slice(0, 5), notes };
    }
  }

  // Child-path inference is only safe once the page announces itself as a
  // listing (or lives at a careers-ish URL); otherwise docs sites false-positive.
  const bodyTextEarly = $('body').text().slice(0, 20_000);
  const looksLikeCareersPage =
    LIST_HEADINGS.test(bodyTextEarly) || /career|job|vacanc|join-us|open-role/i.test(baseUrl);

  // 2. Rendered ATS board markup.
  let domRows = 0;
  for (const sel of ATS_ROW_SELECTORS) {
    const n = $(sel).length;
    if (n > domRows) domRows = n;
  }
  const jobLinks = collectJobLinks($, baseUrl, looksLikeCareersPage);

  if (domRows >= 2) {
    notes.push(`ats-dom:${domRows}`);
    return { isJobList: true, count: Math.max(domRows, jobLinks.length),
             method: 'ats-dom', sampleJobUrls: jobLinks.slice(0, 5), notes };
  }

  // 3. Generic: several distinct links to individual job pages.
  if (jobLinks.length >= 2) {
    notes.push(`job-links:${jobLinks.length}`);
    return { isJobList: true, count: jobLinks.length, method: 'job-links',
             sampleJobUrls: jobLinks.slice(0, 5), notes };
  }

  // 4. A listing headline plus one link: weak, but better than nothing.
  const bodyText = bodyTextEarly;
  if (LIST_HEADINGS.test(bodyText) && (jobLinks.length === 1 || ldCount === 1)) {
    notes.push('headline+single-link');
    return { isJobList: true, count: Math.max(jobLinks.length, ldCount), method: 'headline-weak',
             sampleJobUrls: jobLinks.slice(0, 5), notes };
  }

  // A board with genuinely zero openings still *is* the jobs page.
  if (LIST_HEADINGS.test(bodyText) && /\b(no (current )?(open )?(positions|openings|roles|vacancies)|there are no)\b/i.test(bodyText)) {
    notes.push('explicitly-empty-board');
    return { isJobList: true, count: 0, method: 'empty-board', sampleJobUrls: [], notes };
  }

  notes.push(`job-links:${jobLinks.length}`, `ats-dom:${domRows}`);
  return { isJobList: false, count: 0, method: 'none', sampleJobUrls: jobLinks.slice(0, 5), notes };
}

function countJsonLdPostings($: cheerio.CheerioAPI): number {
  let n = 0;
  $('script[type="application/ld+json"]').each((_, el) => {
    let data: unknown;
    try { data = JSON.parse($(el).text()); } catch { return; }
    n += countPostingsIn(data);
  });
  return n;
}

function countPostingsIn(data: unknown, depth = 0): number {
  if (!data || typeof data !== 'object' || depth > 6) return 0;
  if (Array.isArray(data)) return data.reduce<number>((s, x) => s + countPostingsIn(x, depth + 1), 0);
  const o = data as Record<string, unknown>;
  const t = o['@type'];
  const isPosting = t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'));
  let n = isPosting ? 1 : 0;
  for (const key of ['@graph', 'itemListElement', 'mainEntity', 'item']) {
    if (o[key]) n += countPostingsIn(o[key], depth + 1);
  }
  return n;
}

/** Distinct links on the page that look like individual job postings. */
export function collectJobLinks(
  $: cheerio.CheerioAPI, baseUrl: string, allowChildPaths = false,
): string[] {
  // Companies invent their own URL schemes (/company/join-us/<role>), so beyond
  // the known patterns we also accept links that sit directly *underneath* the
  // page we are on -- the shape every listing page has, whatever it is called.
  let basePath = '';
  try { basePath = new URL(baseUrl).pathname.replace(/\/$/, ''); } catch { /* ignore */ }
  const isChildOfBase = (path: string): boolean => {
    if (!allowChildPaths || !basePath || basePath === '') return false;
    if (!path.startsWith(basePath + '/')) return false;
    const rest = path.slice(basePath.length + 1).replace(/\/$/, '');
    return rest.length >= 3 && !rest.includes('/');
  };

  const found = new Set<string>();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const url = absolutise(href, baseUrl);
    if (!url) return;
    let path: string;
    try {
      const u = new URL(url);
      path = u.pathname + u.search;
    } catch { return; }
    // Exclude the page's own URL and obvious non-detail links.
    if (url.replace(/\/$/, '') === baseUrl.replace(/\/$/, '')) return;
    if (!JOB_DETAIL_PATTERNS.some((re) => re.test(path)) && !isChildOfBase(path)) return;
    // Require the anchor to carry a plausible title, not just an icon.
    const text = $(el).text().trim();
    if (text.length < 2 && !$(el).find('h1,h2,h3,h4,[class*=title]').length) return;
    found.add(url);
  });
  return [...found];
}
