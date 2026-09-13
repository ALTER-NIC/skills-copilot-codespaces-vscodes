import { absolutise, registrableDomain, sameSite } from '../util/url.js';
import { matchAtsUrl } from '../ats/registry.js';
import type { ScoredCandidate } from '../types.js';

/** Path/anchor signals that a link leads to a careers area. Tuned, not learned. */
const POSITIVE: Array<[RegExp, number, string]> = [
  [/\bcareers?\b/i, 5, 'careers'],
  [/\bjobs?\b/i, 4.5, 'jobs'],
  [/\bvacanc(y|ies)\b/i, 4.5, 'vacancies'],
  [/\bopen(ings?|[- ]?positions?|[- ]?roles?)\b/i, 4.5, 'openings'],
  [/\bjoin[- _]?(us|our[- _]team|the[- _]team)\b/i, 4, 'join-us'],
  [/\bwork[- _](with|for|at)[- _]us\b/i, 3.5, 'work-with-us'],
  [/\bwe[-' ]?re[- _]hiring\b/i, 3.5, 'hiring'],
  [/\bhiring\b/i, 2.5, 'hiring'],
  [/\bemployment\b/i, 2, 'employment'],
  [/\brecruit(ing|ment)?\b/i, 2, 'recruiting'],
  [/\bopportunit(y|ies)\b/i, 2, 'opportunities'],
  [/\blife[- _]at\b/i, 1.5, 'life-at'],
  [/\bwork[- _]?(here|at)\b/i, 1.5, 'work-here'],
  [/\bteam\b/i, 0.5, 'team'],
  [/\bpeople\b/i, 0.5, 'people'],
];

/** Contexts where a "career"/"job" word does NOT mean a job board. */
const NEGATIVE: Array<[RegExp, number, string]> = [
  [/\/blog\//i, -6, 'blog'],
  [/\/news\//i, -5, 'news'],
  [/\/press\//i, -4, 'press'],
  [/\/(investors?|ir)\//i, -4, 'investors'],
  [/\b(privacy|terms|cookie|legal|gdpr)\b/i, -8, 'legal'],
  [/\bjob[- _]?alerts?\b/i, -3, 'job-alerts'],
  [/\b(career[- _]advice|career[- _]tips|career[- _]growth)\b/i, -6, 'career-content'],
  [/\/(case-stud|customer|product|pricing|docs?|support|help)\b/i, -3, 'non-careers-section'],
  [/\b(login|signin|sign-in|signup|register)\b/i, -5, 'auth'],
  [/\.(pdf|jpg|png|zip|mp4|svg)$/i, -10, 'asset'],
  [/\b(alumni|students?|university|scholarship)\b/i, -2, 'education'],
];

export interface LinkInput {
  href: string;
  text: string;
  /** Rough DOM region; nav/footer links to careers are high-signal. */
  region?: 'nav' | 'footer' | 'body';
}

/**
 * Score one link for "is this the company's careers/jobs area?".
 *
 * Pure function -- the whole ranking layer is testable without network access,
 * which is what makes the behaviour on odd sites debuggable.
 */
export function scoreCareersLink(link: LinkInput, baseUrl: string): ScoredCandidate | null {
  const url = absolutise(link.href, baseUrl);
  if (!url) return null;

  const reasons: string[] = [];
  let score = 0;

  // A link straight to a known ATS board is as good as it gets.
  const ats = matchAtsUrl(url);
  if (ats) {
    score += 12;
    reasons.push(`ats:${ats.ats}`);
  }

  let path: string;
  try {
    const u = new URL(url);
    path = u.pathname + u.search;
  } catch {
    return null;
  }
  const text = (link.text || '').trim().slice(0, 120);

  for (const [re, w, label] of POSITIVE) {
    if (re.test(path)) { score += w; reasons.push(`path:${label}`); }
    if (re.test(text)) { score += w * 0.8; reasons.push(`text:${label}`); }
  }
  for (const [re, w, label] of NEGATIVE) {
    if (re.test(path) || re.test(text)) { score += w; reasons.push(`neg:${label}`); }
  }

  // Prefer a short, top-level path: /careers beats /about/x/y/careers-in-2021.
  const depth = path.split('/').filter(Boolean).length;
  if (depth === 1) { score += 1.5; reasons.push('top-level'); }
  else if (depth >= 4) { score -= 1; reasons.push('deep-path'); }

  if (link.region === 'nav' || link.region === 'footer') {
    score += 1;
    reasons.push(`region:${link.region}`);
  }

  // Off-site links are only interesting if they are a recognised ATS.
  if (!sameSite(url, baseUrl) && !ats) {
    const d = registrableDomain(url) ?? '';
    // Career subdomains (careers.acme.com) are same-company in practice.
    if (!/^(careers?|jobs|talent|work|apply|hiring)\./i.test(new URL(url).hostname)) {
      score -= 6;
      reasons.push(`offsite:${d}`);
    }
  }

  if (score <= 0) return null;
  return { url, score: round(score), reasons: dedupe(reasons) };
}

/** Rank a page's links, best first. */
export function rankCareersLinks(links: LinkInput[], baseUrl: string): ScoredCandidate[] {
  const best = new Map<string, ScoredCandidate>();
  for (const l of links) {
    const c = scoreCareersLink(l, baseUrl);
    if (!c) continue;
    const prev = best.get(c.url);
    if (!prev || c.score > prev.score) best.set(c.url, c);
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}

const round = (n: number): number => Math.round(n * 100) / 100;
const dedupe = (a: string[]): string[] => [...new Set(a)];
