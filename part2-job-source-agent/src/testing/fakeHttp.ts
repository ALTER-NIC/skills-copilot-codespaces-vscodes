import type { HttpClient } from '../http/fetcher.js';
import type { FetchedDoc } from '../types.js';

export interface Route {
  /** Exact URL or a pattern tested against the URL. */
  match: string | RegExp;
  status?: number;
  body?: string;
  json?: unknown;
  contentType?: string;
}

/**
 * An in-memory "internet" implementing HttpClient.
 *
 * Lets the full agent run deterministically in CI with no network, which is the
 * only way to regression-test crawler heuristics: real sites change under you.
 */
export class FakeHttp implements HttpClient {
  readonly requested: string[] = [];
  constructor(private readonly routes: Route[]) {}

  private find(url: string): Route | undefined {
    return this.routes.find((r) =>
      typeof r.match === 'string' ? r.match === url || r.match === url.replace(/\/$/, '')
                                  : r.match.test(url));
  }

  async getText(url: string): Promise<FetchedDoc> {
    this.requested.push(url);
    const r = this.find(url);
    if (!r) return { url, finalUrl: url, status: 404, html: '', contentType: '', rendered: false };
    const html = r.json !== undefined ? JSON.stringify(r.json) : (r.body ?? '');
    return {
      url,
      finalUrl: url,
      status: r.status ?? 200,
      html,
      contentType: r.contentType ?? (r.json !== undefined ? 'application/json' : 'text/html'),
      rendered: false,
    };
  }

  async getJson<T>(url: string): Promise<T | null> {
    const doc = await this.getText(url);
    if (doc.status < 200 || doc.status >= 300 || !doc.html) return null;
    try { return JSON.parse(doc.html) as T; } catch { return null; }
  }

  async render(url: string): Promise<FetchedDoc> {
    return { ...(await this.getText(url)), rendered: true };
  }

  async close(): Promise<void> {}
}

// ---- fixture builders --------------------------------------------------

/** A LinkedIn guest job page carrying JSON-LD, as LinkedIn actually serves it. */
export function linkedInJobPage(opts: {
  company: string; companySlug: string; title: string; website?: string;
}): string {
  const ld = {
    '@context': 'https://schema.org/',
    '@type': 'JobPosting',
    title: opts.title,
    datePosted: '2026-08-01',
    employmentType: 'FULL_TIME',
    hiringOrganization: {
      '@type': 'Organization',
      name: opts.company,
      sameAs: opts.website ?? `https://www.linkedin.com/company/${opts.companySlug}`,
      logo: 'https://media.licdn.com/dms/image/logo.png',
    },
    jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: 'San Francisco' } },
  };
  return `<!DOCTYPE html><html><head><title>${opts.company} hiring ${opts.title}</title>
<script type="application/ld+json">${JSON.stringify(ld)}</script></head>
<body><section class="top-card-layout">
<a class="topcard__org-name-link" href="https://www.linkedin.com/company/${opts.companySlug}?trk=public_jobs_topcard-org-name">${opts.company}</a>
<h1 class="topcard__title">${opts.title}</h1>
</section></body></html>`;
}

/** A LinkedIn company page whose outbound website link is wrapped in /redir/. */
export function linkedInCompanyPage(company: string, website: string): string {
  return `<!DOCTYPE html><html><head><title>${company} | LinkedIn</title></head><body>
<h1>${company}</h1>
<a href="https://www.linkedin.com/redir/redirect?url=${encodeURIComponent(website)}&urlhash=abcd"
   data-tracking-control-name="about_website">${website}</a>
</body></html>`;
}

export function companyHome(opts: { name: string; careersHref: string }): string {
  return `<!DOCTYPE html><html><head><title>${opts.name} — AI for legal teams</title>
<meta property="og:site_name" content="${opts.name}"></head><body>
<nav><a href="/product">Product</a><a href="/pricing">Pricing</a><a href="/blog">Blog</a></nav>
<main><h1>${opts.name}</h1><p>We build things.</p>
<a href="/blog/career-advice-for-engineers">Career advice for engineers</a></main>
<footer><a href="/privacy">Privacy</a><a href="${opts.careersHref}">Careers</a>
<a href="/about">About</a></footer></body></html>`;
}
