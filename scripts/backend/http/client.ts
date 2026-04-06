export interface HttpClientOptions {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  rateLimit?: number; // minimum ms between requests
}

const defaults: Required<HttpClientOptions> = {
  timeout: 15_000,
  retries: 3,
  retryDelay: 1_000,
  rateLimit: 300,
};

export class HttpClient {
  private opts: Required<HttpClientOptions>;
  private lastRequestAt = 0;

  constructor(options?: HttpClientOptions) {
    this.opts = { ...defaults, ...options };
  }

  async get<T = unknown>(url: string, params?: Record<string, string>): Promise<T> {
    const fullUrl = params
      ? `${url}?${new URLSearchParams(params).toString()}`
      : url;

    // Rate limiting
    const now = Date.now();
    const elapsed = now - this.lastRequestAt;
    if (elapsed < this.opts.rateLimit) {
      await new Promise(r => setTimeout(r, this.opts.rateLimit - elapsed));
    }

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < this.opts.retries; attempt++) {
      if (attempt > 0) {
        await new Promise(r => setTimeout(r, this.opts.retryDelay * attempt));
      }

      try {
        this.lastRequestAt = Date.now();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.opts.timeout);

        const res = await fetch(fullUrl, { signal: controller.signal });
        clearTimeout(timer);

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        return (await res.json()) as T;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    throw lastError ?? new Error('Request failed');
  }
}
