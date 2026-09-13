# Demo video script

Target: **8–11 minutes**. Kevin asked for the thought process, not just the
output — so the reasoning beats are the point, and the two places where a test
caught a bug are the most valuable 60 seconds in the whole video.

Record with the terminal at a large font. Have these ready in tabs:
the repo, `bench/out/report.md`, the deployed URL, `run-artifacts/`.

---

## 0 · Framing (45s)

> "Brief says pick one or two of three. I picked 2 and 3 — the two where I could
> produce a number and prove it, rather than describe an architecture. I'll say
> up front what I didn't do and why, because one of those is a judgement call
> rather than a gap."

Name the Part 1 decision (no LiveKit/Tavus accounts → couldn't verify it →
would rather show two working things than three claimed ones).

---

## 1 · Part 2, the idea before the code (1m30)

Don't open an editor yet. Draw the problem:

> "Every company's careers page is different, so a generic crawler sounds like
> the hard part. It isn't. Almost every company eventually hands off to one of
> about 25 ATS platforms — Greenhouse, Lever, Ashby, Workday. So I don't need to
> understand the career page. I need to find the fingerprint of whichever ATS
> it's using."

Then the part that makes it verifiable:

> "And once I have the slug, most of these vendors expose a public JSON endpoint.
> So I don't just *guess* a URL — I call Greenhouse's API, it tells me the board
> exists and there are 14 open roles. That's the difference between a scraper
> that returns a plausible link and one that returns a checked answer."

## 2 · Part 2 live (2m)

```bash
npm run resolve -- https://www.linkedin.com/jobs/view/4427787182/
```

Walk the trace line by line — company identified → website → ranked candidates →
`ats-api-confirmed`. Point at the scores:

> "`/careers` scored 11.5, the blog post about career advice scored negative.
> That scorer is a pure function, so I can unit-test ranking on weird sites
> without touching the network."

Then the deployed URL — paste 3–4 LinkedIn URLs, let them resolve live, expand
one "How it got there".

> "Same engine behind the API. You can throw ten URLs at it yourself."

## 3 · The number, honestly (1m30) ← *the credibility beat*

Show `bench/out/report.md`.

> "Here's the success rate over my 20 URLs: **N/20**. Here's where the failures
> came from…"

Then be explicit about the two different numbers:

> "There's a second number in the repo and I want to be clear it's not the same
> thing. `--offline` runs 14 synthetic sites — 8 ATS vendors, self-hosted lists,
> careers subdomains, sitemap-only discovery. It's 14/14, but those are fixtures
> I wrote. It measures whether the logic is correct, not real-world hit rate.
> The live number is the one that answers your question."

Then the bit worth the whole video:

> "That corpus earned its keep. It caught three real bugs. The best one: my
> crawl budget counted *requests*, so on a site with no careers link, twenty
> 404 probes ate the entire budget and the sitemap fallback never ran. Now
> budget counts pages I actually parse. I'd never have found that by hand —
> it only shows up on a site shaped a particular way."

## 4 · Part 3, and the judgement call (2m) ← *the other credibility beat*

State the boundary before demoing, plainly and without apology:

> "The brief says build the extension so it can work around the human
> verification that blocks Playwright on Lever and Workday. I didn't build that,
> and I want to explain why rather than quietly skip it.
>
> Defeating a bot check on someone else's site is circumventing an access
> control. If Jobnova ships that, the risk isn't technical — it's that you're
> one blog post away from every ATS vendor blocking you, and those are the
> companies you need to integrate with.
>
> So the agent automates everything expensive — navigation, field mapping,
> resume upload, custom questions — and stops at the challenge, screenshots it,
> and hands off. A human spends three seconds instead of three minutes.
>
> And the real answer for a company building this as infrastructure is the
> vendors' own APIs. Lever and Greenhouse both let an authorised partner submit
> applications programmatically — no bot check, no headless fleet, nothing
> breaking when a form changes. I'd scope that as v1 and keep the browser agent
> for the long tail with no API."

Then the architecture in one line:

> "No Playwright here. The extension *is* the agent — it polls a local queue,
> drives the tab from inside, reports back. That's what makes Workday's five-page
> flow tractable: navigation doesn't kill your state."

## 5 · Part 3 live (2m)

```bash
npm run fixture
npm run apply -- --url <printed URL> --submit
```

> "I'm running against a local replica of Lever's form, not the real Ekimetrics
> posting — pointing an auto-submitting agent at a live board sends a real
> application to a real recruiter. The replica has the same field names, the same
> posting→apply hop, the same custom-question shape."

Show the per-field report and the screenshots in `run-artifacts/`.

Then genericity:

```bash
node --test test/e2e.test.mjs
```

> "Four tests, real headless Chrome, real extension, real forms. The fourth fills
> a *Greenhouse*-shaped form the agent has no mapping for — it splits my full
> name into first/last from the label text alone, and answers both
> work-authorization questions from a boolean in my profile. That's the generic
> path, and it's why this isn't Lever-only.
>
> Third test asserts the handoff: with a captcha on the page, nothing gets
> submitted. The boundary is enforced, not just documented."

Worth 20 seconds:

> "These assert on the payload the form actually POSTed, not on what the agent
> says it did. An agent that reports success while submitting an empty form is
> the failure that would actually hurt you — and that assertion already caught
> me misreading a screenshot."

## 6 · Close (45s)

What I'd do next, concretely:
- **Part 2** — ranked multi-board results for large enterprises; an LLM
  tie-breaker on genuinely ambiguous pages (the hook is already in config).
- **Part 3** — Workday's multi-page state machine; resume parsing to build the
  profile; LLM-drafted answers for free-text questions.
- **Part 1** — happy to build it with LiveKit and Tavus accounts provisioned.

---

## Checklist

- [ ] `npm test` green on camera
- [ ] `bench/out/report.md` filled from a real 20-URL run
- [ ] Deployed URL live, tested from a phone hotspot (not just localhost)
- [ ] Live number and offline corpus number clearly distinguished
- [ ] Part 3 demo runs against the replica, never a real board
- [ ] The verification boundary explained as a decision, not an omission
