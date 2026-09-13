import { companyHome, linkedInCompanyPage, linkedInJobPage, type Route } from '../src/testing/fakeHttp.js';

/**
 * Offline regression corpus.
 *
 * These are synthetic sites, NOT a real-world success rate -- they exist so the
 * crawler's heuristics have a deterministic suite that runs in CI, where live
 * sites would change under us. The headline number for the submission comes
 * from `--live` runs against real LinkedIn URLs.
 */
export interface Scenario {
  name: string;
  input: string;
  routes: Route[];
  /** What a correct agent must return. */
  expect: { jobsListUrl: string; ats?: string | null };
}

let id = 4400000000;
const nextUrl = (): string => `https://www.linkedin.com/jobs/view/${id++}/`;

/** Company whose careers page embeds a hosted ATS board. */
function embedded(opts: {
  name: string; slug: string; host: string; careersPath: string;
  embedHtml: string; apiMatch: RegExp; apiJson: unknown;
  expectUrl: string; ats: string; viaCompanyPage?: boolean;
}): Scenario {
  const input = nextUrl();
  const jobId = /\/(\d+)\//.exec(input)![1]!;
  const website = `https://www.${opts.host}`;
  return {
    name: `${opts.name} (${opts.ats} embed)`,
    input,
    routes: [
      { match: new RegExp(`jobPosting/${jobId}`), body: linkedInJobPage({
          company: opts.name, companySlug: opts.slug, title: 'Software Engineer',
          ...(opts.viaCompanyPage ? {} : { website }) }) },
      ...(opts.viaCompanyPage
        ? [{ match: `https://www.linkedin.com/company/${opts.slug}`,
             body: linkedInCompanyPage(opts.name, website) } as Route]
        : []),
      { match: website, body: companyHome({ name: opts.name, careersHref: opts.careersPath }) },
      { match: website + opts.careersPath, body: opts.embedHtml },
      { match: opts.apiMatch, json: opts.apiJson },
    ],
    expect: { jobsListUrl: opts.expectUrl, ats: opts.ats },
  };
}

/** Scenario whose routes need the generated job id (avoids hardcoded regexes). */
function custom(
  name: string,
  build: (jobId: string) => { routes: Route[]; expect: Scenario['expect'] },
): Scenario {
  const input = nextUrl();
  const jobId = /\/(\d+)\//.exec(input)![1]!;
  const { routes, expect } = build(jobId);
  return { name, input, routes, expect };
}

const jobs = (n: number): unknown[] => Array.from({ length: n }, (_, i) => ({ id: `j${i}` }));

export const CORPUS: Scenario[] = [
  embedded({
    name: 'Harvey', slug: 'harvey-ai', host: 'harvey.ai', careersPath: '/careers',
    embedHtml: '<html><body><div id="ashby_embed"></div><script src="https://jobs.ashbyhq.com/harvey/embed"></script></body></html>',
    apiMatch: /posting-api\/job-board\/harvey/, apiJson: { jobs: jobs(12) },
    expectUrl: 'https://jobs.ashbyhq.com/harvey', ats: 'ashby', viaCompanyPage: true,
  }),
  embedded({
    name: 'Acme Robotics', slug: 'acme-robotics', host: 'acmerobotics.com', careersPath: '/company/careers',
    embedHtml: '<html><body><div id="grnhse_app"></div><script src="https://boards.greenhouse.io/embed/job_board/js?for=acmerobotics"></script></body></html>',
    apiMatch: /boards\/acmerobotics\/jobs/, apiJson: { jobs: jobs(3) },
    expectUrl: 'https://job-boards.greenhouse.io/acmerobotics', ats: 'greenhouse',
  }),
  embedded({
    name: 'Ekimetrics', slug: 'ekimetrics', host: 'ekimetrics.com', careersPath: '/careers',
    embedHtml: '<html><body><h1>Join us</h1><a href="https://jobs.lever.co/ekimetrics">Open roles</a></body></html>',
    apiMatch: /postings\/ekimetrics/, apiJson: jobs(21),
    expectUrl: 'https://jobs.lever.co/ekimetrics', ats: 'lever',
  }),
  embedded({
    name: 'Contoso', slug: 'contoso', host: 'contoso.com', careersPath: '/jobs',
    embedHtml: '<html><body><script>fetch("https://api.smartrecruiters.com/v1/companies/Contoso/postings")</script></body></html>',
    apiMatch: /companies\/Contoso\/postings/, apiJson: { totalFound: 44 },
    expectUrl: 'https://jobs.smartrecruiters.com/Contoso', ats: 'smartrecruiters',
  }),
  embedded({
    name: 'Globex', slug: 'globex', host: 'globex.com', careersPath: '/careers',
    embedHtml: '<html><body><a href="https://globex.wd5.myworkdayjobs.com/en-US/Globex_Careers">Search jobs</a></body></html>',
    apiMatch: /wday\/cxs\/globex\/Globex_Careers\/jobs/, apiJson: { total: 57 },
    expectUrl: 'https://globex.wd5.myworkdayjobs.com/Globex_Careers', ats: 'workday',
  }),
  embedded({
    name: 'Umbrella', slug: 'umbrella', host: 'umbrella.io', careersPath: '/join-us',
    embedHtml: '<html><body><iframe src="https://apply.workable.com/umbrella/"></iframe></body></html>',
    apiMatch: /widget\/accounts\/umbrella/, apiJson: { jobs: jobs(9) },
    expectUrl: 'https://apply.workable.com/umbrella/', ats: 'workable',
  }),
  embedded({
    name: 'Initrode', slug: 'initrode', host: 'initrode.com', careersPath: '/careers',
    embedHtml: '<html><body><a href="https://initrode.recruitee.com/">Vacancies</a></body></html>',
    apiMatch: /initrode\.recruitee\.com\/api\/offers/, apiJson: { offers: jobs(5) },
    expectUrl: 'https://initrode.recruitee.com/', ats: 'recruitee',
  }),
  embedded({
    name: 'Vandelay', slug: 'vandelay', host: 'vandelay.com', careersPath: '/careers',
    embedHtml: '<html><body><a href="https://vandelay.bamboohr.com/careers">Current openings</a></body></html>',
    apiMatch: /vandelay\.bamboohr\.com\/careers\/list/, apiJson: { result: jobs(4) },
    expectUrl: 'https://vandelay.bamboohr.com/careers', ats: 'bamboohr',
  }),

  // --- Shapes that are not a simple "homepage -> careers -> embed" ---------
  custom('Northwind (self-hosted list, no ATS)', (jobId) => ({
    routes: [
      { match: new RegExp(`jobPosting/${jobId}`), body: linkedInJobPage({
          company: 'Northwind', companySlug: 'northwind', title: 'Data Scientist',
          website: 'https://www.northwind.com' }) },
      { match: 'https://www.northwind.com', body: companyHome({ name: 'Northwind', careersHref: '/careers' }) },
      { match: 'https://www.northwind.com/careers', body:
        `<html><body><h1>Open roles</h1>
         <a href="/careers/senior-backend-engineer">Senior Backend Engineer</a>
         <a href="/careers/product-designer">Product Designer</a>
         <a href="/careers/data-scientist">Data Scientist</a></body></html>` },
    ],
    expect: { jobsListUrl: 'https://www.northwind.com/careers', ats: null },
  })),

  custom('Initech (board only on careers.* subdomain)', (jobId) => ({
    routes: [
      { match: new RegExp(`jobPosting/${jobId}`), body: linkedInJobPage({
          company: 'Initech', companySlug: 'initech', title: 'SRE', website: 'https://www.initech.com' }) },
      { match: 'https://www.initech.com', body:
        '<html><head><title>Initech</title></head><body><nav><a href="/product">Product</a></nav></body></html>' },
      { match: 'https://careers.initech.com', body:
        '<html><body><a href="https://jobs.lever.co/initech">See openings</a></body></html>' },
      { match: /postings\/initech/, json: jobs(7) },
    ],
    expect: { jobsListUrl: 'https://jobs.lever.co/initech', ats: 'lever' },
  })),

  custom('Stark (jobs page only reachable via sitemap)', (jobId) => ({
    routes: [
      { match: new RegExp(`jobPosting/${jobId}`), body: linkedInJobPage({
          company: 'Stark Industries', companySlug: 'stark', title: 'Engineer',
          website: 'https://www.stark.com' }) },
      { match: 'https://www.stark.com', body:
        '<html><head><title>Stark Industries</title></head><body><p>We make things.</p></body></html>' },
      { match: 'https://www.stark.com/sitemap.xml', contentType: 'application/xml', body:
        `<urlset><url><loc>https://www.stark.com/about</loc></url>
         <url><loc>https://www.stark.com/work-here/open-roles</loc></url></urlset>` },
      { match: 'https://www.stark.com/work-here/open-roles', body:
        `<html><body><h2>Current openings</h2>
         <a href="/work-here/open-roles/mechanical-engineer">Mechanical Engineer</a>
         <a href="/work-here/open-roles/ai-researcher">AI Researcher</a></body></html>` },
    ],
    expect: { jobsListUrl: 'https://www.stark.com/work-here/open-roles', ats: null },
  })),

  custom('Cyberdyne (careers page links out to the real board)', (jobId) => ({
    routes: [
      { match: new RegExp(`jobPosting/${jobId}`), body: linkedInJobPage({
          company: 'Cyberdyne', companySlug: 'cyberdyne', title: 'ML Engineer',
          website: 'https://www.cyberdyne.com' }) },
      { match: 'https://www.cyberdyne.com', body: companyHome({ name: 'Cyberdyne', careersHref: '/careers' }) },
      { match: 'https://www.cyberdyne.com/careers', body:
        `<html><body><h1>Life at Cyberdyne</h1><p>Culture copy, no jobs here.</p>
         <a href="/careers/open-positions">View all open positions</a></body></html>` },
      { match: 'https://www.cyberdyne.com/careers/open-positions', body:
        `<html><body><div id="grnhse_app"></div>
         <script src="https://boards.greenhouse.io/embed/job_board/js?for=cyberdyne"></script></body></html>` },
      { match: /boards\/cyberdyne\/jobs/, json: { jobs: jobs(15) } },
    ],
    expect: { jobsListUrl: 'https://job-boards.greenhouse.io/cyberdyne', ats: 'greenhouse' },
  })),

  custom('Soylent (blog noise must not outrank the real careers link)', (jobId) => ({
    routes: [
      { match: new RegExp(`jobPosting/${jobId}`), body: linkedInJobPage({
          company: 'Soylent', companySlug: 'soylent', title: 'Ops Lead',
          website: 'https://www.soylent.com' }) },
      { match: 'https://www.soylent.com', body:
        `<html><head><title>Soylent</title></head><body>
         <a href="/blog/how-to-start-a-career-in-food-tech">How to start a career in food tech</a>
         <a href="/blog/jobs-of-the-future">Jobs of the future</a>
         <footer><a href="/company/join-us">Join us</a></footer></body></html>` },
      { match: 'https://www.soylent.com/company/join-us', body:
        `<html><body><h2>Open positions</h2>
         <a href="/company/join-us/warehouse-lead">Warehouse Lead</a>
         <a href="/company/join-us/ops-manager">Ops Manager</a></body></html>` },
    ],
    expect: { jobsListUrl: 'https://www.soylent.com/company/join-us', ats: null },
  })),

  custom('Hooli (LinkedIn blocked; must fail rather than guess)', () => ({
    routes: [{ match: /linkedin\.com/, status: 999, body: '' }],
    expect: { jobsListUrl: '', ats: null },
  })),
];
