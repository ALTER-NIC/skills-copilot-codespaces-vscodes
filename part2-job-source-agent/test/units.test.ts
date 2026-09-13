import { describe, expect, it } from 'vitest';
import { extractJobId, parseJobPage, tidyName } from '../src/linkedin/parse.js';
import { findAtsInHtml, matchAtsUrl } from '../src/ats/registry.js';
import { rankCareersLinks, scoreCareersLink } from '../src/resolve/score.js';
import { analyseJobListPage } from '../src/verify/jobListPage.js';
import { guessDomains } from '../src/resolve/website.js';
import { registrableDomain, stripTracking, tokensOf } from '../src/util/url.js';
import { looksLikeJsShell } from '../src/resolve/careers.js';
import { linkedInJobPage } from '../src/testing/fakeHttp.js';

describe('LinkedIn URL parsing', () => {
  it('extracts ids from every URL shape LinkedIn emits', () => {
    expect(extractJobId('https://www.linkedin.com/jobs/view/4427787182/')).toBe('4427787182');
    expect(extractJobId('https://www.linkedin.com/jobs/view/staff-engineer-at-harvey-4427787182'))
      .toBe('4427787182');
    expect(extractJobId('https://www.linkedin.com/jobs/search/?currentJobId=4427787182&f_TPR=r86400'))
      .toBe('4427787182');
    expect(extractJobId('https://example.com/nope')).toBeNull();
  });

  it('prefers JSON-LD over DOM scraping', () => {
    const facts = parseJobPage(linkedInJobPage({
      company: 'Harvey', companySlug: 'harvey-ai', title: 'Staff Engineer',
      website: 'https://www.harvey.ai',
    }));
    expect(facts.companyName).toBe('Harvey');
    expect(facts.companyWebsite).toBe('https://www.harvey.ai');
    expect(facts.title).toBe('Staff Engineer');
  });

  it('normalises legal suffixes out of company names', () => {
    expect(tidyName('Ekimetrics, Inc.')).toBe('Ekimetrics');
    expect(tidyName('Harvey | AI for legal')).toBe('Harvey');
    expect(tidyName('Contoso GmbH')).toBe('Contoso');
  });
});

describe('ATS detection', () => {
  it('matches direct board URLs across vendors', () => {
    expect(matchAtsUrl('https://jobs.lever.co/ekimetrics/d9d64766-3d42')?.slug).toBe('ekimetrics');
    expect(matchAtsUrl('https://jobs.ashbyhq.com/harvey?utm_source=58AzKxpoq0')?.ats).toBe('ashby');
    expect(matchAtsUrl('https://boards.greenhouse.io/stripe')?.ats).toBe('greenhouse');
    const wd = matchAtsUrl('https://globex.wd5.myworkdayjobs.com/en-US/Globex_Careers');
    expect(wd?.boardUrl).toBe('https://globex.wd5.myworkdayjobs.com/Globex_Careers');
  });

  it('ignores vendor marketing paths that are not customer boards', () => {
    expect(matchAtsUrl('https://boards.greenhouse.io/privacy')).toBeNull();
    expect(matchAtsUrl('https://jobs.lever.co/login')).toBeNull();
  });

  it('finds embedded boards inside a careers page', () => {
    const hits = findAtsInHtml(`
      <div id="grnhse_app"></div>
      <script src="https://boards.greenhouse.io/embed/job_board/js?for=acmerobotics"></script>`);
    expect(hits.map((h) => `${h.ats}:${h.slug}`)).toContain('greenhouse:acmerobotics');
  });

  it('detects an ATS referenced only through an XHR endpoint', () => {
    const hits = findAtsInHtml(`fetch("https://api.smartrecruiters.com/v1/companies/Contoso/postings")`);
    expect(hits[0]?.ats).toBe('smartrecruiters');
    expect(hits[0]?.boardUrl).toBe('https://jobs.smartrecruiters.com/Contoso');
  });
});

describe('careers link scoring', () => {
  const base = 'https://www.acme.com';

  it('ranks a real careers link above blog noise', () => {
    const ranked = rankCareersLinks([
      { href: '/blog/career-advice-for-engineers', text: 'Career advice', region: 'body' },
      { href: '/careers', text: 'Careers', region: 'footer' },
      { href: '/pricing', text: 'Pricing', region: 'nav' },
    ], base);
    expect(ranked[0]?.url).toBe('https://www.acme.com/careers');
  });

  it('scores an ATS link highest of all', () => {
    const c = scoreCareersLink({ href: 'https://jobs.lever.co/acme', text: 'Openings' }, base);
    expect(c!.score).toBeGreaterThan(10);
    expect(c!.reasons).toContain('ats:lever');
  });

  it('rejects legal and auth pages outright', () => {
    expect(scoreCareersLink({ href: '/privacy', text: 'Privacy Policy' }, base)).toBeNull();
    expect(scoreCareersLink({ href: '/login', text: 'Sign in' }, base)).toBeNull();
  });

  it('penalises unrelated offsite links but keeps careers subdomains', () => {
    const offsite = scoreCareersLink({ href: 'https://partner.example.org/jobs', text: 'Jobs' }, base);
    const sub = scoreCareersLink({ href: 'https://careers.acme.com', text: 'Careers' }, base);
    expect(sub!.score).toBeGreaterThan(offsite?.score ?? 0);
  });
});

describe('job list verification', () => {
  it('counts JSON-LD postings', () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org', '@graph': [
        { '@type': 'JobPosting', title: 'A' }, { '@type': 'JobPosting', title: 'B' }],
    })}</script>`;
    const ev = analyseJobListPage(html, 'https://x.com/careers');
    expect(ev.isJobList).toBe(true);
    expect(ev.count).toBe(2);
    expect(ev.method).toBe('json-ld');
  });

  it('does not mistake a homepage nav for a job list', () => {
    const html = `<body><nav><a href="/careers">Careers</a><a href="/jobs">Jobs</a></nav>
                  <h1>We build software</h1></body>`;
    expect(analyseJobListPage(html, 'https://x.com').isJobList).toBe(false);
  });

  it('treats a board with zero openings as still being the jobs page', () => {
    const html = `<body><h2>Open positions</h2><p>There are no open positions right now.</p></body>`;
    const ev = analyseJobListPage(html, 'https://x.com/careers');
    expect(ev.isJobList).toBe(true);
    expect(ev.count).toBe(0);
  });
});

describe('url + name utilities', () => {
  it('handles multi-part public suffixes', () => {
    expect(registrableDomain('https://careers.acme.co.uk/x')).toBe('acme.co.uk');
    expect(registrableDomain('https://www.acme.com')).toBe('acme.com');
  });

  it('strips tracking params so results are comparable', () => {
    expect(stripTracking('https://jobs.ashbyhq.com/harvey?utm_source=58AzKxpoq0'))
      .toBe('https://jobs.ashbyhq.com/harvey');
  });

  it('drops legal-entity noise when tokenising', () => {
    expect(tokensOf('Ekimetrics Technologies Inc')).toEqual(['ekimetrics']);
  });

  it('guesses plausible domains best-first', () => {
    expect(guessDomains('Harvey')).toContain('https://harvey.com');
    expect(guessDomains('Harvey')).toContain('https://harvey.ai');
  });

  it('spots an unhydrated SPA shell', () => {
    expect(looksLikeJsShell('<div id="root"></div>')).toBe(true);
    expect(looksLikeJsShell('<a href="/1">x</a>'.repeat(10) + 'y'.repeat(900))).toBe(false);
  });
});
