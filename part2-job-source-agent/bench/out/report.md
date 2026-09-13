# Offline regression corpus

**Success rate: 13/14 = 92.9%**

A run counts as a success when the agent returns a job listing page with
confidence >= 0.7. Confidence is highest when the page is a
recognised ATS board confirmed through that vendor's public API.

## Breakdown by destination

| Destination | Resolved |
| --- | ---: |
| self-hosted | 3 |
| greenhouse | 2 |
| lever | 2 |
| ashby | 1 |
| smartrecruiters | 1 |
| workday | 1 |
| workable | 1 |
| recruitee | 1 |
| bamboohr | 1 |

## Per-URL results

| # | Input | Company | Jobs list page | ATS | Open roles | Conf. | OK |
| ---: | --- | --- | --- | --- | ---: | ---: | :-: |
| 1 | Harvey (ashby embed) | Harvey | [link](https://jobs.ashbyhq.com/harvey) | ashby | 12 | 0.98 | YES |
| 2 | Acme Robotics (greenhouse embed) | Acme Robotics | [link](https://job-boards.greenhouse.io/acmerobotics) | greenhouse | 3 | 0.98 | YES |
| 3 | Ekimetrics (lever embed) | Ekimetrics | [link](https://jobs.lever.co/ekimetrics) | lever | 21 | 0.98 | YES |
| 4 | Contoso (smartrecruiters embed) | Contoso | [link](https://jobs.smartrecruiters.com/Contoso) | smartrecruiters | 44 | 0.98 | YES |
| 5 | Globex (workday embed) | Globex | [link](https://globex.wd5.myworkdayjobs.com/Globex_Careers) | workday | 57 | 0.98 | YES |
| 6 | Umbrella (workable embed) | Umbrella | [link](https://apply.workable.com/umbrella/) | workable | 9 | 0.98 | YES |
| 7 | Initrode (recruitee embed) | Initrode | [link](https://initrode.recruitee.com/) | recruitee | 5 | 0.98 | YES |
| 8 | Vandelay (bamboohr embed) | Vandelay | [link](https://vandelay.bamboohr.com/careers) | bamboohr | 4 | 0.98 | YES |
| 9 | Northwind (self-hosted list, no ATS) | Northwind | [link](https://www.northwind.com/careers) | — | 3 | 0.78 | YES |
| 10 | Initech (board only on careers.* subdomain) | Initech | [link](https://jobs.lever.co/initech) | lever | 7 | 0.98 | YES |
| 11 | Stark (jobs page only reachable via sitemap) | Stark Industries | [link](https://www.stark.com/work-here/open-roles) | — | 2 | 0.78 | YES |
| 12 | Cyberdyne (careers page links out to the real board) | Cyberdyne | [link](https://job-boards.greenhouse.io/cyberdyne) | greenhouse | 15 | 0.98 | YES |
| 13 | Soylent (blog noise must not outrank the real careers link) | Soylent | [link](https://www.soylent.com/company/join-us) | — | 2 | 0.78 | YES |
| 14 | Hooli (LinkedIn blocked; must fail rather than guess) |  | — | — | — | 0 | NO |

## Failures

- `Hooli (LinkedIn blocked; must fail rather than guess)` — LinkedIn extraction failed: no company identified. Configure SCRAPINGDOG_API_KEY or PROXYCURL_API_KEY for reliable extraction from datacenter IPs.
