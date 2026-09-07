import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { tmpDb } from "./helpers/tmpdb";
const tmp = tmpDb("share");
import { closeDb } from "@/lib/db";
import { seedMiniCatalog } from "./helpers/seed";
import { createPortfolio, addItem } from "@/lib/portfolios";
import { isShareToken, getShareLink, enableShare, regenerateShare, disableShare, getSharedPortfolio } from "@/lib/share";

let seed: Awaited<ReturnType<typeof seedMiniCatalog>>;
let mine: number;
beforeAll(async () => {
  seed = await seedMiniCatalog();
  mine = (await createPortfolio("u1", "Main")).id;
  await addItem("u1", mine, { printingId: seed.printings.umbreonHolo, quantity: 2, condition: "NM", acquiredPrice: 1000 });
});
afterAll(() => { closeDb(); tmp.clean(); });

describe("share links", () => {
  it("starts with no link", async () => {
    expect(await getShareLink("u1", mine)).toBeNull();
    expect(await getSharedPortfolio("nope")).toBeNull();
  });
  it("enable creates a 22-char base64url token that resolves to exactly that binder, cost basis stripped", async () => {
    const link = await enableShare("u1", mine);
    expect(link.enabled).toBe(true);
    expect(isShareToken(link.token)).toBe(true);
    const shared = await getSharedPortfolio(link.token);
    expect(shared).toMatchObject({ portfolioId: mine, ownerId: "u1", name: "Main", cards: 2, value: 2930 });
    expect(shared!.holdings).toHaveLength(1);
    expect(shared!.holdings[0]).toMatchObject({ cardName: "Umbreon ex", quantity: 2, value: 2930 });
    expect(shared!.holdings[0]).not.toHaveProperty("acquiredPrice");
    expect(shared!.holdings[0]).not.toHaveProperty("cost");
    expect(shared).not.toHaveProperty("gain");
  });
  it("enable again keeps the same token; regenerate replaces it and kills the old URL", async () => {
    const a = await enableShare("u1", mine);
    expect((await enableShare("u1", mine)).token).toBe(a.token);
    const b = await regenerateShare("u1", mine);
    expect(b.token).not.toBe(a.token);
    expect(b.enabled).toBe(true);
    expect(await getSharedPortfolio(a.token)).toBeNull();
    expect((await getSharedPortfolio(b.token))?.portfolioId).toBe(mine);
  });
  it("disable 404s the token but keeps it for re-enable", async () => {
    const before = (await getShareLink("u1", mine))!;
    expect(await disableShare("u1", mine)).toBe(true);
    expect(await getSharedPortfolio(before.token)).toBeNull();
    expect((await getShareLink("u1", mine))?.enabled).toBe(false);
    expect((await enableShare("u1", mine)).token).toBe(before.token);
  });
  it("another user cannot see or toggle the link", async () => {
    expect(await getShareLink("u2", mine)).toBeNull();
    await expect(enableShare("u2", mine)).rejects.toThrow(/not found/i);
    await expect(regenerateShare("u2", mine)).rejects.toThrow(/not found/i);
    expect(await disableShare("u2", mine)).toBe(false);
    expect((await getShareLink("u1", mine))?.enabled).toBe(true);
  });
  it("rejects malformed tokens without touching the database", async () => {
    for (const t of ["", "short", "x".repeat(23), "has space here-------", "../../etc/passwd-------"]) expect(isShareToken(t)).toBe(false);
    expect(await getSharedPortfolio("x".repeat(23))).toBeNull();
  });
});
