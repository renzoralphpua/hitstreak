import { describe, it, expect, vi } from "vitest";
import { createTcgcsvClient } from "@/ingest/tcgcsv";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("tcgcsv client", () => {
  it("fetches groups for a category and unwraps results", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ results: [{ groupId: 604, name: "Scarlet & Violet", publishedOn: "2023-03-31T00:00:00" }] })
    );
    const c = createTcgcsvClient({ fetchImpl, delayMs: 0 });
    const groups = await c.fetchGroups(3);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://tcgcsv.com/tcgplayer/3/groups",
      expect.objectContaining({ headers: expect.objectContaining({ "User-Agent": expect.stringContaining("hitstreak") }) })
    );
    expect(groups).toEqual([{ groupId: 604, name: "Scarlet & Violet", publishedOn: "2023-03-31T00:00:00" }]);
  });

  it("fetches products and prices for a group", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ results: [{ productId: 1, name: "Pikachu" }] }))
      .mockResolvedValueOnce(jsonResponse({ results: [{ productId: 1, subTypeName: "Holofoil", marketPrice: 2.5 }] }));
    const c = createTcgcsvClient({ fetchImpl, delayMs: 0 });
    expect(await c.fetchProducts(3, 604)).toEqual([{ productId: 1, name: "Pikachu" }]);
    expect(await c.fetchPrices(3, 604)).toEqual([{ productId: 1, subTypeName: "Holofoil", marketPrice: 2.5 }]);
    expect(fetchImpl).toHaveBeenNthCalledWith(1, "https://tcgcsv.com/tcgplayer/3/604/products", expect.anything());
    expect(fetchImpl).toHaveBeenNthCalledWith(2, "https://tcgcsv.com/tcgplayer/3/604/prices", expect.anything());
  });

  it("retries once on a 5xx then succeeds", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: "boom" }, 503))
      .mockResolvedValueOnce(jsonResponse({ results: [] }));
    const c = createTcgcsvClient({ fetchImpl, delayMs: 0 });
    expect(await c.fetchGroups(68)).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws after retries are exhausted", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: "down" }, 500));
    const c = createTcgcsvClient({ fetchImpl, delayMs: 0, maxRetries: 2 });
    await expect(c.fetchGroups(89)).rejects.toThrow(/500/);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("retries a thrown network error then succeeds", async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(jsonResponse({ results: [{ groupId: 1, name: "x" }] }));
    const c = createTcgcsvClient({ fetchImpl, delayMs: 0 });
    expect(await c.fetchGroups(3)).toEqual([{ groupId: 1, name: "x" }]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 404 and throws immediately", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: "nope" }, 404));
    const c = createTcgcsvClient({ fetchImpl, delayMs: 0, maxRetries: 3 });
    await expect(c.fetchPrices(3, 999)).rejects.toThrow(/404/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns [] when a 200 body has no results key", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
    const c = createTcgcsvClient({ fetchImpl, delayMs: 0 });
    expect(await c.fetchGroups(3)).toEqual([]);
  });

  it("passes an abort signal for the per-request timeout", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ results: [] }));
    const c = createTcgcsvClient({ fetchImpl, delayMs: 0, timeoutMs: 1234 });
    await c.fetchGroups(3);
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
