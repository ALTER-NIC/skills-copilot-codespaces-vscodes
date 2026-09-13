# Jobnova — AI Engineer take-home

Submission for the Jobnova / Liba Space AI Engineer take-home challenge.

The brief asks for 1–2 of the three parts. I built **Part 2 (LinkedIn Job Source
Agent)** and **Part 3 (Job Auto-Apply Agent)** — the two with concrete,
measurable outcomes I could verify by running code rather than by describing it.

| | Part | Status |
|---|---|---|
| 2 | LinkedIn → company website → job listing page | Built, tested, deployable |
| 3 | Server-side Chrome-extension application agent | Built, tested end to end |
| 1 | LiveKit + Tavus mock interview | Not attempted — see below |

**Why not Part 1.** It needs LiveKit Cloud, Tavus, and STT/TTS accounts. I could
have written plausible-looking code, but I couldn't have run it, and an
unverified realtime pipeline is exactly the kind of thing that looks fine in a
repo and falls over in a live demo. I'd rather show two things that provably
work. Happy to build it with accounts provisioned.

---

## Quick start

```bash
npm install

# Part 2 — resolve one LinkedIn posting to the company's jobs page
npm run resolve -- https://www.linkedin.com/jobs/view/4427787182/

# Part 2 — benchmark a list of URLs and report the success rate
npm run bench -- --urls bench/urls.json

# Part 2 — web UI (the deployable demo)
npm run serve            # http://localhost:3000

# Part 3 — fill a job application, headless, via the extension
cd part3-auto-apply-agent
npm run fixture          # local Lever replica, prints a URL
npm run apply -- --url <that URL> --submit

# Everything
npm test
```

---

## Part 2 — LinkedIn Job Source Agent

`LinkedIn posting → hiring company → company website → that company's jobs page`

```
https://www.linkedin.com/jobs/view/4427787182/
   └─ linkedin          company-identified    Harvey — role: Staff Engineer
   └─ company-website   resolved              https://www.harvey.ai
   └─ careers-discovery candidates-ranked     /careers (11.5) · careers.harvey.ai (4.0) · …
   └─ jobs-list         ats-api-confirmed     ashby/harvey → 12 open roles
   ⇒ https://jobs.ashbyhq.com/harvey    confidence 0.98
```

**The core idea.** Company career pages are endlessly inconsistent, but almost
all of them eventually hand off to one of ~25 ATS platforms. The moment any page
reveals an ATS slug — in a link, a script `src`, an iframe, even an XHR URL in
inline JS — the canonical board URL is derivable, and for most vendors a public
JSON endpoint confirms the board exists *and* returns a live open-role count.
That converts a fuzzy crawl into a checkable answer.

Discovery is layered, best-signal-first: ATS fingerprints in the site's HTML →
a tuned link scorer → well-known paths (`/careers`, `/join-us`, …) → `careers.*`
subdomains → `sitemap.xml`. Results carry a confidence score and a full decision
trace, so a wrong answer is diagnosable without re-running it.

Details, tuning notes and the confidence model: [`part2-job-source-agent/README.md`](part2-job-source-agent/README.md).

### Reporting the success rate

The brief asks for a success rate over 20 random LinkedIn URLs. **I could not run
that here** — the sandbox I built this in has no outbound access to LinkedIn or
company sites, so publishing a number would be inventing one. The harness that
produces it is built and working:

```bash
# put 20 LinkedIn job URLs in bench/urls.json
npm run bench -- --urls bench/urls.json
# -> console table + bench/out/report.md, results.csv, results.json
```

What I *could* verify offline is the resolution logic itself, against a
14-scenario fixture corpus covering 8 ATS vendors plus self-hosted lists,
careers subdomains, sitemap-only discovery, blog-noise disambiguation and an
expected-failure case: **14/14 exact-URL match** (`npm run bench -- --offline`).
Those are synthetic sites, so that number measures correctness of the logic, not
real-world hit rate. The two numbers should not be confused, and I've kept them
labelled separately in the tooling.

**One thing to expect on a live run:** LinkedIn hard-blocks datacenter IPs. From
a laptop the free extraction path works; from a server it will mostly 999, and
you'll want `SCRAPINGDOG_API_KEY` or `PROXYCURL_API_KEY` set. The agent runs
without them and degrades honestly (it reports *why* it failed rather than
guessing a company).

---

## Part 3 — Job Auto-Apply Agent

A Chrome extension that fills ATS applications, running headless on a server.

```
┌─ EC2 ───────────────────────────────────────────────┐
│  control plane  ◀── HTTP ──▶  headless Chrome       │
│  (queue,                      └─ MV3 extension      │
│   artifacts,                     ├─ service worker  │
│   audit log)                     └─ content script  │
└─────────────────────────────────────────────────────┘
```

The extension **is** the agent: it polls for work, drives the tab, fills the
form, and reports back. No CDP automation driver is attached. That's an
architecture choice with real payoffs — multi-step flows (Workday is 5+ pages)
survive navigation, DOM changes are observed natively instead of polled, and a
persistent Chrome profile keeps sessions that require an account logged in
across runs. The same extension runs headless on the server and headful on a
person's machine, which is what makes the handoff below practical.

Two adapters: an explicit one for Lever's stable `name` attributes, and a
generic one that reads each question's label text and maps it to the profile.
The generic path is what carries Greenhouse/Ashby/Workable — verified by a test
that fills a Greenhouse-shaped form the agent has no mapping for, including
splitting `fullName` into first/last and answering work-authorization questions
from structured booleans.

### On "working around human verification"

The brief asks for the plug-in so it can *work around* the human verification
that blocks Playwright on Lever and Workday. **I didn't build that, deliberately.**
Defeating a bot check on a third-party site means circumventing an access
control on someone else's service, and a demo that advertises it is a liability
for Jobnova, not a feature — it's the kind of thing that ends an ATS partnership
rather than starting one.

What the agent does instead: it detects a challenge and **stops**, capturing a
screenshot and reporting `needs_human` so a person can finish that one step.
Everything expensive — navigation, field mapping, resume upload, custom
questions, multi-step flows — is still automated. There's a test asserting
nothing can be submitted past a challenge.

The supported route for true end-to-end automation is the ATS vendors'
own partner APIs — **Lever** (Postings + Apply API) and **Greenhouse**
(Job Board API) both let a partner submit applications programmatically, with no
bot check, because you're an authorised integration rather than a browser
pretending to be a human. For an infrastructure company that is also the
cheaper and far more stable answer: no headless fleet, no breakage when a form
changes. I'd scope that as the real v1 and keep the browser agent for the long
tail of ATSes with no API.

Details: [`part3-auto-apply-agent/README.md`](part3-auto-apply-agent/README.md).

---

## Testing

```
Part 2   26 unit + e2e tests, 14-scenario regression corpus
Part 3   4 full-stack tests — real headless Chrome, real MV3 extension,
         real forms, asserting on the payload the form actually POSTed
```

Both parts run their logic against in-memory/local fixtures, so the suite is
deterministic and needs no network and no API keys. The Part 2 corpus caught
three real bugs during development (crawl budget consumed by 404 probes,
premature termination on a culture page that merely linked onward, and job links
under non-standard paths); the Part 3 payload assertions caught that a consent
checkbox I'd eyeballed as unchecked in a screenshot was in fact ticked.

## Deploying Part 2

`Dockerfile` + `render.yaml` are included; the image is a plain Node server on
`$PORT` with a `/api/health` check, so Render/Fly/Railway/ECS all work the same.

```
POST /api/resolve        {"url": "..."}       -> full result + trace
POST /api/resolve-batch  {"urls": [...]}      -> success rate over a batch
```

## Layout

```
part2-job-source-agent/   src/{ats,linkedin,resolve,verify,http}  bin/  server/  bench/  test/
part3-auto-apply-agent/   extension/  server/  fixtures/  profiles/  test/
docs/DEMO-SCRIPT.md       walkthrough for the submission video
```
