// The cache exists because the account has a hard request quota and this API makes it easy to burn:
// /api/{tcg}/sets ignores `page` and returns the whole list every time, so a "paginate until short
// page" loop re-fetches the same rows forever. These tests pin the behaviour that protects the quota.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;
let cwd: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "apitcg-"));
  cwd = process.cwd();
  process.chdir(dir);
  process.env.APITCG_API_KEY = "test-key-not-a-real-one";
  vi.resetModules();
});
afterEach(() => {
  process.chdir(cwd);
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

const load = async () => await import("@/ingest/apitcg");
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

describe("apitcgFetch", () => {
  it("spends one request, then serves the same path from disk forever", async () => {
    const { apitcgFetch, requestsSpent, isCached } = await load();
    const fetchMock = vi.fn(async () => ok({ data: [1, 2, 3] }));
    vi.stubGlobal("fetch", fetchMock);

    expect(isCached("/api/pokemon/sets")).toBe(false);
    expect(await apitcgFetch("/api/pokemon/sets")).toEqual({ data: [1, 2, 3] });
    expect(await apitcgFetch("/api/pokemon/sets")).toEqual({ data: [1, 2, 3] });
    expect(await apitcgFetch("/api/pokemon/sets")).toEqual({ data: [1, 2, 3] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestsSpent()).toBe(1); // cache hits are not requests
    expect(isCached("/api/pokemon/sets")).toBe(true);
  });

  it("sends the key as x-api-key and never in the URL", async () => {
    const { apitcgFetch } = await load();
    const fetchMock = vi.fn(async () => ok({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await apitcgFetch("/api/tcgs");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.apitcg.com/api/tcgs");
    expect(url).not.toContain("test-key");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("test-key-not-a-real-one");
  });

  it("refuses to run without a key rather than sending an unauthenticated request", async () => {
    const { apitcgFetch } = await load();
    delete process.env.APITCG_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(apitcgFetch("/api/tcgs")).rejects.toThrow(/APITCG_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("only re-fetches when explicitly told to", async () => {
    const { apitcgFetch, requestsSpent } = await load();
    const fetchMock = vi.fn(async () => ok({ data: ["fresh"] }));
    vi.stubGlobal("fetch", fetchMock);
    await apitcgFetch("/api/tcgs");
    await apitcgFetch("/api/tcgs");
    expect(requestsSpent()).toBe(1);
    await apitcgFetch("/api/tcgs", { refresh: true });
    expect(requestsSpent()).toBe(2);
  });

  it("caches nothing on failure, so a 429 does not become a permanent empty answer", async () => {
    const { apitcgFetch, isCached } = await load();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 429, json: async () => ({ error: "rate" }) })));
    await expect(apitcgFetch("/api/tcgs")).rejects.toThrow(/429/);
    expect(isCached("/api/tcgs")).toBe(false);
    expect(readdirSync(join(dir, ".cache", "apitcg"))).toHaveLength(0);
  });

  it("treats different query strings as different entries", async () => {
    const { apitcgFetch, cachedPaths } = await load();
    vi.stubGlobal("fetch", vi.fn(async () => ok({ data: [] })));
    await apitcgFetch("/api/products?tcg=pokemon&limit=1");
    await apitcgFetch("/api/products?tcg=one-piece&limit=1");
    expect(cachedPaths()).toEqual(["/api/products?tcg=one-piece&limit=1", "/api/products?tcg=pokemon&limit=1"]);
  });

  it("dryRun refuses an uncached path instead of quietly spending", async () => {
    const { apitcgFetch, requestsSpent } = await load();
    const fetchMock = vi.fn(async () => ok({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(apitcgFetch("/api/tcgs", { dryRun: true })).rejects.toThrow(/would spend a request/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(requestsSpent()).toBe(0);
  });
});

describe("listSets", () => {
  it("asks once and does NOT paginate — the endpoint ignores `page`", async () => {
    const { listSets, requestsSpent } = await load();
    // 220 rows: more than any `limit`, which is exactly the shape that fooled a pagination loop
    // into requesting the same list twelve times.
    const rows = Array.from({ length: 220 }, (_, i) => ({ _id: `set-${i}` }));
    const fetchMock = vi.fn(async () => ok({ data: rows }));
    vi.stubGlobal("fetch", fetchMock);

    const sets = await listSets("pokemon");
    expect(sets).toHaveLength(220);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("https://api.apitcg.com/api/pokemon/sets");
    expect(requestsSpent()).toBe(1);
  });

  it("maps our game slug to theirs and survives an empty body", async () => {
    const { listSets } = await load();
    const fetchMock = vi.fn(async () => ok({ success: true }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await listSets("one-piece")).toEqual([]);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toContain("/api/one-piece/sets");
  });
});
