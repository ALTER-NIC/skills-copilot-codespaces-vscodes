/** Shared domain types for the LinkedIn -> company jobs-list resolution pipeline. */

/** A single decision the agent made, so every result can be explained and audited. */
export interface TraceStep {
  stage: Stage;
  /** Short machine-readable outcome, e.g. "ats-api-confirmed", "link-score-win". */
  outcome: string;
  detail?: string;
  url?: string;
  ms: number;
  /** Candidates considered at this step, best first. Useful for tuning the scorer. */
  candidates?: ScoredCandidate[];
}

export type Stage =
  | 'linkedin'
  | 'company-website'
  | 'careers-discovery'
  | 'jobs-list-resolution'
  | 'verification';

export interface ScoredCandidate {
  url: string;
  score: number;
  reasons: string[];
}

/** Identity of the hiring company, as extracted from the LinkedIn posting. */
export interface CompanyIdentity {
  name: string | null;
  /** e.g. https://www.linkedin.com/company/harvey-ai */
  linkedinCompanyUrl: string | null;
  /** Root website, normalised to origin form: https://www.harvey.ai */
  website: string | null;
  /** Which provider produced this, for reporting provider reliability. */
  source: string;
}

/** What kind of page we finally landed on. */
export type ResultKind =
  /** A recognised ATS job board, e.g. jobs.ashbyhq.com/harvey. Highest confidence. */
  | 'ats-board'
  /** A jobs list hosted on the company's own domain. */
  | 'self-hosted-list'
  /** We found a careers page but could not confirm it lists individual jobs. */
  | 'careers-page-unverified'
  | 'not-found';

export interface JobsListResult {
  input: string;
  company: CompanyIdentity;
  /** The deliverable: the company's job listing page. */
  jobsListUrl: string | null;
  kind: ResultKind;
  /** Detected ATS id, e.g. "ashby", "greenhouse". */
  ats: string | null;
  atsSlug: string | null;
  /** Number of open postings we could actually see/confirm on that page. */
  jobCount: number | null;
  /** 0..1. >=0.7 is treated as success in the benchmark. */
  confidence: number;
  trace: TraceStep[];
  errors: string[];
  totalMs: number;
}

/** A fetched document, normalised across the plain-HTTP and headless-browser fetchers. */
export interface FetchedDoc {
  url: string;
  /** URL after redirects. */
  finalUrl: string;
  status: number;
  html: string;
  contentType: string;
  /** True when rendered through a real browser (JS executed). */
  rendered: boolean;
}

export interface Logger {
  debug(msg: string, meta?: unknown): void;
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
}
