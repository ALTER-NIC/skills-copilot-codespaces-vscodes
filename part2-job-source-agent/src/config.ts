/** Runtime configuration. Everything optional: the agent runs with zero API keys. */
export interface AgentConfig {
  /** Per-request timeout (ms). */
  timeoutMs: number;
  /** Retry attempts for transient network/5xx failures. */
  retries: number;
  /** Max pages fetched while hunting for a careers page on one company site. */
  maxCrawlPages: number;
  /** Cache fetched pages on disk so benchmark reruns are fast and reproducible. */
  cacheDir: string | null;
  cacheTtlMs: number;
  /** Use a headless browser when plain HTTP yields a JS-only shell. */
  useBrowser: boolean;
  userAgent: string;
  /** Optional third-party LinkedIn scraping providers, tried in order. */
  scrapingdogApiKey?: string;
  proxycurlApiKey?: string;
  apifyToken?: string;
  /** Optional LLM tie-breaker for ambiguous careers links. */
  llm?: { provider: 'anthropic' | 'openai'; apiKey: string; model: string };
  /** Max concurrent company resolutions in the benchmark. */
  concurrency: number;
}

const DEFAULT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export function loadConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  const env = process.env;
  const llm = buildLlmConfig(env);
  return {
    timeoutMs: num(env.TIMEOUT_MS, 20_000),
    retries: num(env.RETRIES, 2),
    maxCrawlPages: num(env.MAX_CRAWL_PAGES, 12),
    cacheDir: env.CACHE_DIR ?? '.cache',
    cacheTtlMs: num(env.CACHE_TTL_MS, 24 * 60 * 60 * 1000),
    useBrowser: env.USE_BROWSER === '1' || env.USE_BROWSER === 'true',
    userAgent: env.USER_AGENT ?? DEFAULT_UA,
    scrapingdogApiKey: env.SCRAPINGDOG_API_KEY,
    proxycurlApiKey: env.PROXYCURL_API_KEY,
    apifyToken: env.APIFY_TOKEN,
    ...(llm ? { llm } : {}),
    concurrency: num(env.CONCURRENCY, 4),
    ...overrides,
  };
}

function buildLlmConfig(env: NodeJS.ProcessEnv): AgentConfig['llm'] | undefined {
  if (env.ANTHROPIC_API_KEY) {
    return {
      provider: 'anthropic',
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.LLM_MODEL ?? 'claude-sonnet-5',
    };
  }
  if (env.OPENAI_API_KEY) {
    return { provider: 'openai', apiKey: env.OPENAI_API_KEY, model: env.LLM_MODEL ?? 'gpt-4o-mini' };
  }
  return undefined;
}

function num(v: string | undefined, d: number): number {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : d;
}
