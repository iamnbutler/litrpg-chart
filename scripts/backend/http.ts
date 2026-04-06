/**
 * Shared HTTP client with timeout, retry, rate limiting, and request logging.
 *
 * Used by all data fetchers to handle the realities of hitting
 * undocumented/flaky APIs from CI environments.
 */

export interface HttpClientOptions {
  timeoutMs?: number; // default 15000
  maxRetries?: number; // default 3
  minDelayMs?: number; // default 300 (between requests to same host)
  userAgent?: string; // default 'litrpg-chart/1.0'
}

export interface HttpClient {
  get<T>(url: string, params?: Record<string, string>): Promise<T>;
  getJson<T>(url: string, params?: Record<string, string>): Promise<T>;
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly url: string,
  ) {
    super(`HTTP ${status} ${statusText} for ${url}`);
    this.name = "HttpError";
  }
}

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

const DEFAULTS = {
  timeoutMs: 15_000,
  maxRetries: 3,
  minDelayMs: 300,
  userAgent: "litrpg-chart/1.0",
} as const;

/** Millisecond sleep with optional jitter */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Add random jitter (0–50% of base delay) to avoid thundering herd */
function withJitter(ms: number): number {
  return ms + Math.random() * ms * 0.5;
}

/** Parse Retry-After header: supports seconds (integer) or HTTP-date */
function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isNaN(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    return Math.max(0, date - Date.now());
  }
  return null;
}

export type FetchFn = typeof globalThis.fetch;

export function createHttpClient(
  options?: HttpClientOptions,
  /** Injectable fetch for testing */
  fetchFn?: FetchFn,
): HttpClient {
  const config = { ...DEFAULTS, ...options };
  const fetchImpl = fetchFn ?? globalThis.fetch;

  // Track last request time per host for rate limiting
  const lastRequestByHost = new Map<string, number>();

  async function rateLimitDelay(host: string): Promise<void> {
    const last = lastRequestByHost.get(host);
    if (last != null) {
      const elapsed = Date.now() - last;
      const remaining = config.minDelayMs - elapsed;
      if (remaining > 0) {
        await sleep(remaining);
      }
    }
  }

  function recordRequest(host: string): void {
    lastRequestByHost.set(host, Date.now());
  }

  function log(
    method: string,
    url: string,
    status: number | string,
    durationMs: number,
    attempt: number,
  ): void {
    const attemptStr = attempt > 1 ? ` (attempt ${attempt})` : "";
    console.error(
      `[http] ${method} ${url} → ${status} (${durationMs}ms)${attemptStr}`,
    );
  }

  async function request<T>(url: string): Promise<T> {
    const parsedUrl = new URL(url);
    const host = parsedUrl.host;

    for (let attempt = 1; attempt <= config.maxRetries + 1; attempt++) {
      await rateLimitDelay(host);

      const start = Date.now();
      let response: Response;

      try {
        response = await fetchImpl(url, {
          headers: { "User-Agent": config.userAgent },
          signal: AbortSignal.timeout(config.timeoutMs),
        });
      } catch (err: unknown) {
        const durationMs = Date.now() - start;
        recordRequest(host);

        const isTimeout =
          err instanceof DOMException && err.name === "TimeoutError";
        const label = isTimeout ? "TIMEOUT" : "NETWORK_ERROR";
        log("GET", url, label, durationMs, attempt);

        if (attempt <= config.maxRetries) {
          const backoff = withJitter(1000 * 2 ** (attempt - 1));
          await sleep(backoff);
          continue;
        }
        throw err;
      }

      const durationMs = Date.now() - start;
      recordRequest(host);
      log("GET", url, response.status, durationMs, attempt);

      if (response.ok) {
        return (await response.json()) as T;
      }

      // Non-retryable client error
      if (
        response.status >= 400 &&
        response.status < 500 &&
        !RETRYABLE_STATUS_CODES.has(response.status)
      ) {
        throw new HttpError(response.status, response.statusText, url);
      }

      // Retryable error
      if (
        RETRYABLE_STATUS_CODES.has(response.status) &&
        attempt <= config.maxRetries
      ) {
        let backoff: number;
        if (response.status === 429) {
          const retryAfter = parseRetryAfter(
            response.headers.get("Retry-After"),
          );
          backoff = retryAfter ?? withJitter(1000 * 2 ** (attempt - 1));
        } else {
          backoff = withJitter(1000 * 2 ** (attempt - 1));
        }
        await sleep(backoff);
        continue;
      }

      // Out of retries
      throw new HttpError(response.status, response.statusText, url);
    }

    // Should be unreachable, but TypeScript needs it
    throw new Error(`Unreachable: exhausted retries for ${url}`);
  }

  function buildUrl(
    base: string,
    params?: Record<string, string>,
  ): string {
    if (!params || Object.keys(params).length === 0) return base;
    const url = new URL(base);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  return {
    get<T>(url: string, params?: Record<string, string>): Promise<T> {
      return request<T>(buildUrl(url, params));
    },
    getJson<T>(url: string, params?: Record<string, string>): Promise<T> {
      return request<T>(buildUrl(url, params));
    },
  };
}
