# Benchmark

## Live run (this is the number the submission reports)

Put 20 LinkedIn job posting URLs in `urls.json` — pick them at random from a
LinkedIn job search so the sample isn't cherry-picked — then:

```bash
npm run bench -- --urls bench/urls.json
```

Writes `out/report.md` (paste-ready), `out/results.csv` and `out/results.json`.
A row counts as a success when a job listing page comes back with confidence
≥ 0.70.

Expect LinkedIn to block datacenter IPs. Run it from a laptop, or set
`SCRAPINGDOG_API_KEY` / `PROXYCURL_API_KEY`.

## Offline corpus (a regression gate, NOT a real-world success rate)

```bash
npm run bench -- --offline
```

14 synthetic sites covering 8 ATS vendors, self-hosted lists, careers
subdomains, sitemap-only discovery, blog-noise disambiguation and one case that
must fail rather than guess. These are fixtures, so this measures whether the
resolution logic is correct — not how often it works on the real internet. Any
ground-truth miss exits non-zero, so it works as a CI gate.
