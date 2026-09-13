# Part 2 — LinkedIn Job Source Agent

Takes a LinkedIn job posting URL and returns the hiring company's own job
listing page.

```
input   https://www.linkedin.com/jobs/view/4427787182/
output  https://jobs.ashbyhq.com/harvey          (ats=ashby, 12 open roles, conf 0.98)
```

## Pipeline

```
LinkedIn posting
  │  Stage 1  provider chain: guest fragment API → public page JSON-LD
  │           → ScrapingDog → Proxycurl → Apify        (merged, cheapest first)
  ▼
company identity  { name, linkedinCompanyUrl, website? }
  │  Stage 2  declared website → LinkedIn company page → validated domain
  │           guess → web search                       (each result validated)
  ▼
company website
  │  Stage 3  ATS fingerprints in HTML → ranked links → well-known paths
  │           → careers.* subdomains → sitemap.xml
  ▼
careers area
  │  Stage 4  canonical board URL, confirmed via the ATS vendor's public API
  ▼
job listing page  + confidence + full decision trace
```

## Why the ATS registry is the backbone

`src/ats/registry.ts` knows 25 platforms. Each entry can (a) recognise a direct
board URL and extract the company slug, (b) recognise the same ATS *embedded* in
a company's own page — script `src`, iframe, mount div, or an XHR endpoint in
inline JS — and (c) confirm the board through a public JSON API that also
returns a live open-role count.

That last point is what makes results checkable rather than plausible. When
`boards-api.greenhouse.io/v1/boards/acme/jobs` returns 14 jobs, the answer isn't
a guess — hence `confidence 0.98`. Vendors with a public count API:
Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Workable, Recruitee,
BambooHR. The rest fall back to loading the board and verifying it looks like a
list.

Adding a vendor is one object literal — no other file changes.

## Confidence model

| Situation | Conf. | Kind |
|---|---:|---|
| ATS board confirmed by vendor API, ≥1 open role | 0.98 | `ats-board` |
| ATS board confirmed by vendor API, 0 open roles | 0.90 | `ats-board` |
| ATS board confirmed by loading the page | 0.88 | `ats-board` |
| Self-hosted list, JSON-LD or ATS DOM markup | 0.85 | `self-hosted-list` |
| Self-hosted list, ≥2 job detail links | 0.78 | `self-hosted-list` |
| Board that explicitly says it has no openings | 0.72 | `self-hosted-list` |
| Listing headline but only one job link | 0.55 | `self-hosted-list` |
| Careers page found, no job links on it | 0.35 | `careers-page-unverified` |

The benchmark counts ≥ 0.70 as a success. A board with zero open roles still
counts — it *is* the company's jobs page, which is what was asked for.

## Design notes

**Verification is the hard part, not crawling.** Any scraper can return a URL.
`src/verify/jobListPage.ts` decides whether a page actually lists jobs, using
JSON-LD `JobPosting` counts, rendered ATS row markup, job-detail link patterns,
and — because companies invent their own URL schemes — links sitting directly
underneath the current page, but only once the page has announced itself as a
listing. Without that last guard, docs sites false-positive.

**Failing honestly beats guessing.** Every candidate company website is
validated against the company name before it's accepted; an unvalidated guess
poisons every later stage, so no answer is better than a wrong one. When
LinkedIn blocks extraction the agent says so and names the fix.

**The scorer is a pure function.** `src/resolve/score.ts` takes links and
returns ranked candidates with reasons, so ranking behaviour on a weird site is
unit-testable without network access. Negative rules matter as much as positive
ones: `/blog/career-advice-for-engineers` must lose to a footer `/careers`.

**Budget counts parsed pages, not requests.** An early version spent its whole
crawl budget on 404 probes and never reached the sitemap fallback. Cheap misses
shouldn't cost budget; a separate hard request cap prevents runaway crawls.

## Configuration

All optional — the agent runs with zero keys.

| Env var | Default | Purpose |
|---|---|---|
| `SCRAPINGDOG_API_KEY` / `PROXYCURL_API_KEY` / `APIFY_TOKEN` | — | Reliable LinkedIn extraction from datacenter IPs |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | — | Reserved for an LLM tie-breaker on ambiguous pages |
| `USE_BROWSER` | `0` | Render JS-only career pages with Playwright |
| `MAX_CRAWL_PAGES` | `12` | Pages parsed per company |
| `CACHE_DIR` | `.cache` | Disk cache; makes benchmark reruns fast and reproducible |
| `CONCURRENCY` | `4` | Parallel resolutions in the benchmark |
| `TIMEOUT_MS` / `RETRIES` | `20000` / `2` | Per-request budget |

## Commands

```bash
npm run resolve -- <url> [--json] [--verbose] [--browser] [--no-cache]
npm run bench   -- --urls bench/urls.json     # live: writes bench/out/report.md
npm run bench   -- --offline                  # fixture corpus; CI regression gate
npm run serve                                 # web UI on :3000
npm test
```

## Known limitations

- **LinkedIn blocks datacenter IPs.** Unavoidable without a paid provider; the
  provider chain exists precisely for this.
- **Workday tenants are guessable but not always countable** — the jobs endpoint
  is a POST whose shape varies by tenant; failures degrade to page verification.
- **Very large enterprises** often run several boards (per region or per
  division). The agent returns one; returning a ranked set would be the fix.
- **`--browser` roughly triples runtime.** Worth it for Workday and SPA career
  pages, wasteful otherwise; it only engages when plain HTTP returns a JS shell.
