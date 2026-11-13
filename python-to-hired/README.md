# Python to Hired 🐍➜💼

**Nic's path from zero code to an entry-level job in IT, cybersecurity or Python development.**

This isn't a list of videos to watch. **You build something in every lesson.** Each project has
tests that grade your work automatically. By the end you'll have 4 portfolio projects on GitHub,
a rewritten resume, and practice for interviews.

---

## The honest picture (read this once)

- **Timeline:** about **5 months at ~2 hrs/day, 6 days/week** to be ready to apply. Going faster
  means putting in more hours. Skipping the projects doesn't speed anything up.
- **The market in 2026:** entry-level tech is competitive. Some Tier-1 SOC work is now automated
  by AI tooling, and employers more often give **practical tests** before offering a job. What gets
  people hired: **Python + Linux + networking knowledge, real projects on GitHub, and a certification
  that gets you past resume filters** (usually CompTIA Security+).
- **The most common way in:** IT Support/Help Desk → SOC Analyst or Security/Automation Engineer.
  A help desk applicant who can write Python automation stands out. This plan aims at all three
  doors at once, so you can apply widely.
- **AI:** you know AI, and employers expect people to use AI tools on the job. But interviews and
  take-home tests check your **fundamentals without AI**. So in Phases 1–2, **you type every
  line yourself**. Use AI (me) to *explain*, not to *write*. In Phase 4 we use AI as a power
  tool, and one portfolio project uses it directly.

## Target roles

| Role | What they want | How this plan covers it |
|---|---|---|
| **IT Support / Help Desk** | Troubleshooting, OS & networking basics, scripting is a plus | Phase 1 projects are IT tasks; SysPulse portfolio project; CompTIA A+ optional |
| **SOC Analyst (Tier 1)** | Log analysis, SIEM queries, networking, Python/Bash, Security+ | Log analyzers, IOC tools, LogSentry & Phishing Triage projects, Security+ track |
| **Junior Python / Automation Dev** | Clean Python, tests, Git, SQL, an API project | Testing from day 1, FastAPI + SQL project, CI on every repo |
| **Junior Security Engineer / Security Automation** | All of the above + automation of security workflows | IOC Enricher API, scripting everywhere |

---

## The roadmap

> ✅ = built and ready to use. 🔜 = we build it together when you get there.

### Phase 0 — Setup (2–3 days) ✅
[00-setup](00-setup/README.md): Codespaces/VS Code, the terminal, running Python, running tests, Git basics.

### Phase 1 — Python Foundations (Weeks 1–4)
Every project is a small task you'd do on the job.

| # | Lesson | Project | Job connection |
|---|---|---|---|
| 01 ✅ | [Variables, types, input & math](phase-1-foundations/01-variables-and-input/README.md) | **Help Desk Ticket Intake** | IT support ticketing |
| 02 ✅ | [Strings](phase-1-foundations/02-strings/README.md) | **New-Hire Username Generator** | Active Directory onboarding |
| 03 ✅ | [Conditionals & booleans](phase-1-foundations/03-conditionals/README.md) | **Access Control Gate** | Role-based access control (RBAC) |
| 04 🔜 | Loops (`for`, `while`) | **Password Strength Checker + Login Lockout** | Auth security policy |
| 05 🔜 | Lists & dictionaries | **IT Asset Inventory** | Asset management |
| 06 🔜 | Functions | **Network Toolkit** (IP validation, private vs public, subnet math) | Networking / Network+ |
| 07 🔜 | Reading & writing files | **SSH Auth Log Analyzer** (find brute-force IPs) | SOC log analysis |
| 08 🔜 | Errors, modules, command-line args | **Log Analyzer v2: a real CLI tool** | ⭐ Phase 1 capstone |

### Phase 2 — Intermediate Python (Weeks 5–8)
| # | Lesson | Project |
|---|---|---|
| 09 🔜 | Classes & OOP | **Ticketing System** (tickets, users, queues) |
| 10 🔜 | Standard library: `pathlib`, `datetime`, `json`, `csv`, `hashlib` | **File Integrity Monitor** (detects tampered files) |
| 11 🔜 | Regular expressions | **IOC Extractor** (pull IPs, URLs, emails, hashes out of reports) |
| 12 🔜 | Testing properly with `pytest` | Add a full test suite to an earlier project |
| 13 🔜 | `venv`, `pip`, `requests`, APIs | **IP Reputation Lookup** (public threat-intel API) |
| 14 🔜 | Code quality: type hints, `ruff`, docstrings, good READMEs | Clean up & publish your Phase 1 capstone |
| 15 🔜 | Problem solving: algorithms & Big-O basics | 20 interview-style problems |

### Phase 3 — The Tech Stack Around Python (Weeks 9–11)
| # | Lesson | Project |
|---|---|---|
| 16 🔜 | Linux & Bash survival (+ OverTheWire Bandit 0–15) | Bash + Python automation script |
| 17 🔜 | Networking for coders: TCP/IP, DNS, HTTP, ports, sockets | **Port Scanner** (only on your own machine / `scanme.nmap.org`) |
| 18 🔜 | SQL & SQLite | **Security Events Database** + queries a SOC analyst would run |
| 19 🔜 | Web APIs with FastAPI | **Ticket API** (CRUD + database) |
| 20 🔜 | Git like a pro + GitHub Actions CI + Docker basics | CI pipeline running your tests on every push |

### Phase 4 — Portfolio Projects for GitHub (Weeks 12–18)
These go on your resume. Each one is a **real repo** with a README, screenshots, tests, CI badge,
and a license.

| Project | What it does | Shows employers |
|---|---|---|
| **1. LogSentry** | Parses Linux auth/web logs, detects brute-force & suspicious activity, outputs JSON/CSV/HTML reports, CLI with options | SOC skills, regex, file handling, testing |
| **2. IOC Enricher API** | FastAPI service: paste text → extracts IOCs → enriches with free threat-intel APIs → caches in a database. Dockerized. | Backend dev, APIs, SQL, security automation |
| **3. SysPulse** | IT automation agent: system health & inventory (CPU/disk/users/services), alert thresholds, webhook alerts, bulk user onboarding from CSV | IT/sysadmin automation |
| **4. Phishing Triage Assistant** (AI differentiator) | Parses `.eml` files, checks headers/SPF/DKIM/links, scores risk with rules, then has an LLM write an analyst summary | Security + AI, which few entry-level candidates can show |

**Definition of done for every portfolio repo:** clear README (problem → features → demo GIF →
install → usage → tests), ≥80% test coverage on core logic, GitHub Actions CI passing, type hints,
`ruff` clean, sensible commit history, MIT license, ethical-use note for security tools.

### Phase 5 — Get Hired (starts Week 14, overlaps Phase 4)
1. **GitHub profile:** profile README, pinned repos, consistent commits.
2. **Resume rewrite:** send me your current resume (paste it or upload a file). I'll rewrite it around
   your projects with quantified bullets and can export a clean `.docx`.
3. **LinkedIn:** headline, About section, featured projects.
4. **Interview prep:** Python fundamentals, ~50 easy coding problems, networking questions (OSI,
   TCP handshake, DNS), SOC scenario questions ("you see 500 failed logins from one IP…"),
   STAR stories built from your projects.
5. **Apply:** 5–10 targeted applications a week, tracked in a spreadsheet, with a cover note
   tailored to each.

### Parallel track — Certifications & hands-on practice (30 min/day from Week 5)
- **CompTIA Security+**: the most common entry filter for security jobs. Free study videos: Professor Messer.
- **TryHackMe**: *Pre Security* → *SOC Level 1* paths (great resume lines, SIEM practice).
- Optional: **CompTIA A+** if you're targeting help desk first; **Network+** or **CCNA** for networking roles.
- Later (after your first job): CySA+ for SOC careers.

---

## How we work together

1. Open a session and tell me what you're on: *"Starting lesson 01"*, or *"I'm stuck on lesson 03, here's my error"*.
2. Each lesson: read the README → do `practice.py` → build the project → run the tests → **commit**.
3. When you pass, tell me. I'll **review your code like a senior engineer would**, then build the next lesson.
4. Track progress in [PROGRESS.md](PROGRESS.md).

### Rules
- **Type every line yourself.** Don't copy-paste. Your fingers need the practice too.
- **Turn off Copilot inline suggestions during Phases 1–2** (VS Code: `Ctrl+Shift+P` → "GitHub Copilot: Disable Completions"). Asking AI to *explain* a concept or error is fine.
- **Being stuck for 20 minutes is normal.** After 20 minutes of real effort, ask for a hint (not the answer).
- **Read the error message.** The last line tells you what went wrong. The line number tells you where.
- **Commit after every project.** Your commit history is part of your portfolio.

## Free resources to use alongside this
- [Official Python Tutorial](https://docs.python.org/3/tutorial/): the reference
- [Automate the Boring Stuff with Python](https://automatetheboringstuff.com/): free online, very IT-flavored
- [CS50's Introduction to Programming with Python (CS50P)](https://cs50.harvard.edu/python/): free Harvard course, good for extra practice
- [Exercism Python track](https://exercism.org/tracks/python): small exercises with mentor feedback
- [OverTheWire Bandit](https://overthewire.org/wargames/bandit/): learn Linux by playing
- [TryHackMe](https://tryhackme.com/): hands-on security labs
- [Professor Messer](https://www.professormesser.com/): free Security+/Network+/A+ courses
