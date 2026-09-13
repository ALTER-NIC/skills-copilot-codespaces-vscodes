# Part 3 — Job Auto-Apply Agent

A Chrome extension that fills ATS job applications, running headless on a
server. No Playwright, no CDP driver attached to the browser.

## Architecture

```
┌─ server (EC2) ──────────────────────────────────────────────┐
│                                                             │
│   control plane  ──── GET /api/next-job ────▶  headless     │
│   (Node, no deps)                              Chrome       │
│     · job queue      ◀─── POST /api/result ──  --headless=new│
│     · artifacts      ◀─── POST /api/artifact   --load-extension
│     · audit log      ◀─── POST /api/log        │            │
│                                                │            │
│                        ┌───────────────────────┴──────────┐ │
│                        │  MV3 extension                   │ │
│                        │   background.js  orchestrator    │ │
│                        │   content.js     fill engine     │ │
│                        └──────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

The extension is the agent. The control plane only owns the queue and the audit
trail, so it never speaks CDP and the queue can be swapped for SQS/Redis without
touching the agent.

**Why an extension rather than driving from outside:**

- Multi-step flows survive navigation. Workday is 5+ pages; an external script
  re-attaches and re-derives state on every hop, the extension just continues.
- DOM changes are observed natively instead of polled on a timer.
- A persistent Chrome profile keeps account-gated ATSes logged in across runs.
- The same code runs headless on the server and headful on a person's machine —
  which is what makes the human-handoff path below actually work.

> **Binary requirement:** must be a full Chrome/Chromium build. Playwright's
> default `headless_shell` **cannot load extensions**. `--headless=new` on a
> real Chrome binary can. `server/launch.js` finds a suitable binary, or set
> `CHROME_PATH`.

## Running it

```bash
npm run fixture                                   # local Lever replica
npm run apply -- --url <printed URL>              # fill only (safe default)
npm run apply -- --url <printed URL> --submit     # fill and submit
npm run apply -- --url <...> --headful --keep-open   # watch it work
npm test
```

`--submit` is opt-in on purpose. **Don't point it at a real company's board for
a demo** — that sends a real application to a real recruiter. The replica in
`fixtures/` mirrors Lever's field names, the posting→`/apply` hop, the
`cards[...]` custom-question shape, the consent checkbox and the confirmation
copy, so demos exercise the same code paths without bothering anyone.

Sample run against the replica:

```
Status  SUBMITTED
        Confirmed: "thank you for applying"
Adapter: lever
  ✓ input[name="name"]              Nicolas Webb Lopez            (adapter)
  ✓ input[name="email"]             ni***om                       (adapter)
  ✓ input[name="urls[LinkedIn]"]    https://linkedin.com/in/...   (adapter)
  ✓ resume                          Nicolas_Webb_Lopez_Resume.pdf (file)
  ✓ How many years of experience…   5                             (inferred)
  ✓ Are you legally authorized…     Yes                           (choice)
  ✓ I consent to … personal data.   checked                       (consent)
```

## How filling works

**Four passes.** (1) Adapter-declared fields keyed by stable `name` attributes.
(2) Resume upload. (3) Every remaining control, matched by its question text.
(4) Radio/checkbox groups and consent boxes.

**Framework-safe writes.** React and Vue track input state internally, so
`el.value = x` is silently discarded on re-render. The engine goes through
`HTMLInputElement.prototype`'s native setter and then dispatches the same
`focus/input/change/blur` sequence a real edit produces.

**File upload.** Resume bytes arrive base64 from the control plane and are
attached through a `DataTransfer`, the supported way to populate `input.files`.

**Label inference is what generalises.** `labelTextFor()` walks `label[for]`,
wrapping labels, `aria-label`, `aria-labelledby`, then the enclosing question
block. `valueForLabel()` maps that text to the profile, ordered most-specific
first so "current company" beats bare "company" and "first name" beats "name".
Booleans become Yes/No for authorization questions; unmatched questions fall
back to `answers` keyed by slugified label.

This is why a Greenhouse-shaped form with no adapter entry still fills — there's
a test for exactly that, including splitting `fullName` into first/last.

**PII stays out of the logs.** Emails and phones are redacted in the run report;
the real values still go into the form.

## Human verification

The agent detects challenge widgets (reCAPTCHA, hCaptcha, Turnstile,
`[data-sitekey]`) and challenge copy, then **stops**: it screenshots the page and
reports `needs_human` so a person can complete that one step. A test asserts
nothing can be submitted past a challenge.

This is a deliberate boundary. Defeating a bot check on a third-party site is
circumventing an access control on someone else's service; building it into a
product invites exactly the response you don't want from the ATS vendors you
need to work with.

**The supported alternative is better anyway.** Lever (Postings + Apply API) and
Greenhouse (Job Board API) both let an authorised partner submit applications
programmatically — no bot check, no headless fleet, no breakage when a form
changes. For an infrastructure company that's the right v1; the browser agent
earns its place on the long tail of ATSes with no API, where the handoff is a
few seconds of human time per application rather than the whole form.

The handoff is practical because the extension is the same in both places:
a queued `needs_human` run can be resumed by a human opening the same profile
headfully, with every field already filled.

## The profile

`profiles/example-profile.json`, schema in `profiles/profile.schema.json`:
identity, links, resume path, work authorization, EEO answers, and a free-form
`answers` map keyed by slugified question text for posting-specific questions.
Nothing in it is transmitted anywhere except the ATS form being applied to.

## Deploying on EC2

```bash
sudo apt-get install -y google-chrome-stable xvfb   # full Chrome, not headless_shell
node server/cli.js --url "<application url>" --profile profiles/me.json
```

For a fleet: run the control plane once, back the queue with SQS/Redis, and run
N Chrome instances each with its own `--user-data-dir`. The extension needs no
changes — it already polls, and it is the unit of concurrency.

Artifacts (before-fill / after-fill / after-submit / verification screenshots)
land in `run-artifacts/<runId>/` and double as the audit trail for what was
submitted on a user's behalf.

## Tests

```
✓ fills and submits a Lever-shaped application end to end
✓ dry run fills the form but does not submit
✓ stops and hands off when a human-verification challenge is present
✓ generic adapter fills a Greenhouse-shaped form it has no mapping for
```

All four run real headless Chrome with the real extension against real forms,
and assert on the payload the form actually POSTed — an agent that reports
success while submitting an empty form is the failure mode that matters.

## Limitations

- **Workday's multi-page flow** (account creation, then 5 steps) isn't
  implemented; the adapter layer is shaped for it but it needs its own state
  machine and a real tenant to build against.
- **Resume parsing** isn't included — the profile is authored by hand. Deriving
  it from a CV is the obvious next step.
- **No answer generation.** Free-text questions come from `answers`; an LLM
  could draft per-posting answers, which is where the `ANTHROPIC_API_KEY` hook
  in Part 2's config would be reused.
