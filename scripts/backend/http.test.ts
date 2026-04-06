import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHttpClient, HttpError, type FetchFn } from "./http.ts";

// Suppress stderr logging during tests
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("createHttpClient", () => {
  it("fetches JSON successfully", async () => {
    const data = { id: 1, name: "test" };
    const mockFetch = vi.fn<FetchFn>().mockResolvedValueOnce(jsonResponse(data));

    const client = createHttpClient({ minDelayMs: 0 }, mockFetch);
    const result = await client.getJson<typeof data>("https://api.example.com/items/1");

    expect(result).toEqual(data);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("appends query params", async () => {
    const mockFetch = vi.fn<FetchFn>().mockResolvedValueOnce(jsonResponse({}));

    const client = createHttpClient({ minDelayMs: 0 }, mockFetch);
    await client.get("https://api.example.com/search", { q: "hello", page: "2" });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    const url = new URL(calledUrl);
    expect(url.searchParams.get("q")).toBe("hello");
    expect(url.searchParams.get("page")).toBe("2");
  });

  it("sends User-Agent header", async () => {
    const mockFetch = vi.fn<FetchFn>().mockResolvedValueOnce(jsonResponse({}));

    const client = createHttpClient({ minDelayMs: 0, userAgent: "test-agent/1.0" }, mockFetch);
    await client.get("https://api.example.com/test");

    const calledOptions = mockFetch.mock.calls[0][1] as RequestInit;
    expect((calledOptions.headers as Record<string, string>)["User-Agent"]).toBe("test-agent/1.0");
  });

  it("throws HttpError on 4xx (not 429)", async () => {
    const mockFetch = vi.fn<FetchFn>().mockResolvedValueOnce(jsonResponse({}, 404));

    const client = createHttpClient({ minDelayMs: 0 }, mockFetch);

    await expect(client.get("https://api.example.com/missing")).rejects.toThrow(HttpError);
    expect(mockFetch).toHaveBeenCalledOnce(); // no retry
  });

  it("retries on 500 with backoff", async () => {
    const mockFetch = vi
      .fn<FetchFn>()
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const client = createHttpClient({ minDelayMs: 0, maxRetries: 3 }, mockFetch);
    const result = await client.get("https://api.example.com/flaky");

    expect(result).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("retries on 429 and respects Retry-After header", async () => {
    const mockFetch = vi
      .fn<FetchFn>()
      .mockResolvedValueOnce(jsonResponse({}, 429, { "Retry-After": "0" }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const client = createHttpClient({ minDelayMs: 0, maxRetries: 3 }, mockFetch);
    const result = await client.get("https://api.example.com/limited");

    expect(result).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting retries on 5xx", async () => {
    const mockFetch = vi
      .fn<FetchFn>()
      .mockResolvedValue(jsonResponse({}, 503));

    const client = createHttpClient({ minDelayMs: 0, maxRetries: 2 }, mockFetch);

    await expect(client.get("https://api.example.com/down")).rejects.toThrow(HttpError);
    expect(mockFetch).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it("retries on network errors", async () => {
    const mockFetch = vi
      .fn<FetchFn>()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(jsonResponse({ recovered: true }));

    const client = createHttpClient({ minDelayMs: 0, maxRetries: 3 }, mockFetch);
    const result = await client.get("https://api.example.com/flaky");

    expect(result).toEqual({ recovered: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("throws network error after exhausting retries", async () => {
    const mockFetch = vi
      .fn<FetchFn>()
      .mockRejectedValue(new TypeError("fetch failed"));

    const client = createHttpClient({ minDelayMs: 0, maxRetries: 1 }, mockFetch);

    await expect(client.get("https://api.example.com/dead")).rejects.toThrow(TypeError);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("applies timeout signal to requests", async () => {
    const mockFetch = vi.fn<FetchFn>().mockResolvedValueOnce(jsonResponse({}));

    const client = createHttpClient({ minDelayMs: 0, timeoutMs: 5000 }, mockFetch);
    await client.get("https://api.example.com/test");

    const calledOptions = mockFetch.mock.calls[0][1] as RequestInit;
    expect(calledOptions.signal).toBeDefined();
  });

  it("rate limits requests to the same host", async () => {
    const mockFetch = vi.fn<FetchFn>()
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({}));

    const client = createHttpClient({ minDelayMs: 50 }, mockFetch);

    const start = Date.now();
    await client.get("https://api.example.com/a");
    await client.get("https://api.example.com/b");
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(40); // allow small timing variance
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("logs requests to stderr", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mockFetch = vi.fn<FetchFn>().mockResolvedValueOnce(jsonResponse({}));

    const client = createHttpClient({ minDelayMs: 0 }, mockFetch);
    await client.get("https://api.example.com/test");

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("[http] GET https://api.example.com/test"),
    );
  });

  it("logs retry attempt number", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mockFetch = vi
      .fn<FetchFn>()
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const client = createHttpClient({ minDelayMs: 0, maxRetries: 3 }, mockFetch);
    await client.get("https://api.example.com/retry-test");

    expect(spy).toHaveBeenCalledWith(expect.stringContaining("(attempt 2)"));
  });

  it("get and getJson return the same result", async () => {
    const data = { value: 42 };
    const mockFetch = vi.fn<FetchFn>()
      .mockResolvedValueOnce(jsonResponse(data))
      .mockResolvedValueOnce(jsonResponse(data));

    const client = createHttpClient({ minDelayMs: 0 }, mockFetch);
    const r1 = await client.get("https://api.example.com/a");
    const r2 = await client.getJson("https://api.example.com/b");

    expect(r1).toEqual(data);
    expect(r2).toEqual(data);
  });
});
