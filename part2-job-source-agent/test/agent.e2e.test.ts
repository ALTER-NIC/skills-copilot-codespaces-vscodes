import { describe, expect, it } from 'vitest';
import { resolveJobsList } from '../src/agent.js';
import { silentLogger } from '../src/logger.js';
import { FakeHttp, companyHome, linkedInCompanyPage, linkedInJobPage, type Route } from '../src/testing/fakeHttp.js';

const OPTS = { cacheDir: null, retries: 0, useBrowser: false } as const;

const run = (url: string, routes: Route[]) =>
  resolveJobsList(url, {
    fetcher: new FakeHttp(routes),
    logger: silentLogger,
    config: { ...OPTS },
  });

describe('end-to-end resolution', () => {
  it('resolves LinkedIn -> LinkedIn company page -> site -> embedded Ashby board', async () => {
    const res = await run('https://www.linkedin.com/jobs/view/4427787182/', [
      { match: /jobs-guest\/jobs\/api\/jobPosting\/4427787182/,
        body: linkedInJobPage({ company: 'Harvey', companySlug: 'harvey-ai', title: 'Staff Engineer' }) },
      { match: 'https://www.linkedin.com/company/harvey-ai',
        body: linkedInCompanyPage('Harvey', 'https://www.harvey.ai') },
      { match: 'https://www.harvey.ai', body: companyHome({ name: 'Harvey', careersHref: '/careers' }) },
      { match: 'https://www.harvey.ai/careers', body:
        `<html><body><h1>Careers at Harvey</h1>
         <div id="ashby_embed"></div>
         <script src="https://jobs.ashbyhq.com/harvey/embed"></script></body></html>` },
      { match: /api\.ashbyhq\.com\/posting-api\/job-board\/harvey/,
        json: { jobs: Array.from({ length: 12 }, (_, i) => ({ id: `j${i}`, title: `Role ${i}` })) } },
    ]);

    expect(res.company.name).toBe('Harvey');
    expect(res.company.website).toBe('https://www.harvey.ai');
    expect(res.jobsListUrl).toBe('https://jobs.ashbyhq.com/harvey');
    expect(res.ats).toBe('ashby');
    expect(res.jobCount).toBe(12);
    expect(res.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('uses the website declared in JSON-LD and resolves a Greenhouse embed', async () => {
    const res = await run('https://www.linkedin.com/jobs/view/4111111111/', [
      { match: /jobPosting\/4111111111/, body: linkedInJobPage({
          company: 'Acme Robotics', companySlug: 'acme-robotics',
          title: 'Controls Engineer', website: 'https://www.acmerobotics.com' }) },
      { match: 'https://www.acmerobotics.com',
        body: companyHome({ name: 'Acme Robotics', careersHref: '/company/careers' }) },
      { match: 'https://www.acmerobotics.com/company/careers', body:
        `<html><body><h2>Open positions</h2><div id="grnhse_app"></div>
         <script src="https://boards.greenhouse.io/embed/job_board/js?for=acmerobotics"></script>
         </body></html>` },
      { match: /boards-api\.greenhouse\.io\/v1\/boards\/acmerobotics\/jobs/,
        json: { jobs: [{ id: 1 }, { id: 2 }, { id: 3 }] } },
    ]);

    expect(res.company.website).toBe('https://www.acmerobotics.com');
    expect(res.jobsListUrl).toBe('https://job-boards.greenhouse.io/acmerobotics');
    expect(res.ats).toBe('greenhouse');
    expect(res.jobCount).toBe(3);
  });

  it('recognises a self-hosted job list with no ATS', async () => {
    const res = await run('https://www.linkedin.com/jobs/view/4222222222/', [
      { match: /jobPosting\/4222222222/, body: linkedInJobPage({
          company: 'Northwind', companySlug: 'northwind', title: 'Data Scientist',
          website: 'https://www.northwind.com' }) },
      { match: 'https://www.northwind.com',
        body: companyHome({ name: 'Northwind', careersHref: '/careers' }) },
      { match: 'https://www.northwind.com/careers', body:
        `<html><body><h1>Open roles</h1><ul>
          <li><a href="/careers/senior-backend-engineer">Senior Backend Engineer</a></li>
          <li><a href="/careers/product-designer">Product Designer</a></li>
          <li><a href="/careers/data-scientist">Data Scientist</a></li>
          <li><a href="/careers/head-of-sales">Head of Sales</a></li>
         </ul></body></html>` },
    ]);

    expect(res.jobsListUrl).toBe('https://www.northwind.com/careers');
    expect(res.kind).toBe('self-hosted-list');
    expect(res.jobCount).toBe(4);
    expect(res.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('finds a board on a careers.* subdomain when the homepage does not link it', async () => {
    const res = await run('https://www.linkedin.com/jobs/view/4333333333/', [
      { match: /jobPosting\/4333333333/, body: linkedInJobPage({
          company: 'Initech', companySlug: 'initech', title: 'SRE',
          website: 'https://www.initech.com' }) },
      { match: 'https://www.initech.com',
        body: '<html><head><title>Initech</title></head><body><nav><a href="/product">Product</a></nav></body></html>' },
      { match: 'https://careers.initech.com', body:
        `<html><body><h1>Work at Initech</h1>
         <a href="https://jobs.lever.co/initech">See our openings</a></body></html>` },
      { match: /api\.lever\.co\/v0\/postings\/initech/,
        json: Array.from({ length: 7 }, (_, i) => ({ id: `p${i}` })) },
    ]);

    expect(res.jobsListUrl).toBe('https://jobs.lever.co/initech');
    expect(res.ats).toBe('lever');
    expect(res.jobCount).toBe(7);
  });

  it('resolves a Workday tenant/site pair to the canonical board', async () => {
    const res = await run('https://www.linkedin.com/jobs/view/4444444444/', [
      { match: /jobPosting\/4444444444/, body: linkedInJobPage({
          company: 'Globex', companySlug: 'globex', title: 'Analyst',
          website: 'https://www.globex.com' }) },
      { match: 'https://www.globex.com',
        body: companyHome({ name: 'Globex', careersHref: '/careers' }) },
      { match: 'https://www.globex.com/careers', body:
        `<html><body><h1>Careers</h1>
         <a href="https://globex.wd5.myworkdayjobs.com/en-US/Globex_Careers">Search jobs</a>
         </body></html>` },
      { match: /wday\/cxs\/globex\/Globex_Careers\/jobs/, json: { total: 57 } },
    ]);

    expect(res.ats).toBe('workday');
    expect(res.jobsListUrl).toBe('https://globex.wd5.myworkdayjobs.com/Globex_Careers');
    expect(res.jobCount).toBe(57);
  });

  it('fails clearly and actionably when LinkedIn blocks extraction', async () => {
    const res = await run('https://www.linkedin.com/jobs/view/4555555555/', [
      { match: /linkedin\.com/, status: 999, body: '' },
    ]);
    expect(res.jobsListUrl).toBeNull();
    expect(res.confidence).toBe(0);
    expect(res.errors.join(' ')).toMatch(/SCRAPINGDOG_API_KEY|PROXYCURL/);
  });

  it('accepts a direct ATS URL as input and short-circuits', async () => {
    const res = await run('https://jobs.lever.co/ekimetrics', [
      { match: /api\.lever\.co\/v0\/postings\/ekimetrics/, json: [{ id: 'a' }, { id: 'b' }] },
    ]);
    expect(res.kind).toBe('ats-board');
    expect(res.jobsListUrl).toBe('https://jobs.lever.co/ekimetrics');
    expect(res.jobCount).toBe(2);
  });
});
