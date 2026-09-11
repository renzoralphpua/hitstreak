import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { tmpDb } from "./helpers/tmpdb";
const tmp = tmpDb("actions");
import { closeDb } from "@/lib/db";
import { seedMiniCatalog } from "./helpers/seed";
import { listPortfolios, createPortfolio, getPortfolio, getPortfolioHoldings } from "@/lib/portfolios";

// The session and Next's cache are the two things a server action reaches for that a plain
// node test can't provide. Importing actions.ts here is fine: "use server" is inert in vitest.
const { getSession, revalidatePath } = vi.hoisted(() => ({ getSession: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ getSession }));
vi.mock("next/cache", () => ({ revalidatePath }));

import {
  createPortfolioAction,
  renamePortfolioAction,
  deletePortfolioAction,
  addItemAction,
} from "@/app/(app)/binders/actions";

const U1 = "user_1", U2 = "user_2";
const signedIn = (id: string) => getSession.mockResolvedValue({ user: { id } });

let seed: Awaited<ReturnType<typeof seedMiniCatalog>>;
let otherPortfolioId: number;

beforeAll(async () => {
  seed = await seedMiniCatalog();
  otherPortfolioId = (await createPortfolio(U2, "Not yours")).id;
});
afterAll(() => { closeDb(); tmp.clean(); });
beforeEach(() => { getSession.mockReset(); revalidatePath.mockReset(); });

describe("portfolio server actions", () => {
  it("refuses everything when there is no session", async () => {
    getSession.mockResolvedValue(null);
    expect(await createPortfolioAction("Main")).toEqual({ ok: false, error: "Not signed in" });
    expect(await renamePortfolioAction(1, "Main")).toEqual({ ok: false, error: "Not signed in" });
    expect(await deletePortfolioAction(1)).toEqual({ ok: false, error: "Not signed in" });
    expect(await addItemAction(1, { printingId: 1, quantity: 1, condition: "NM" })).toEqual({ ok: false, error: "Not signed in" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects ids that aren't positive integers before they reach the data layer", async () => {
    signedIn(U1);
    expect(await renamePortfolioAction(NaN as never, "x")).toEqual({ ok: false, error: "Invalid id" });
    expect(await deletePortfolioAction(-1)).toEqual({ ok: false, error: "Invalid id" });
    expect(await addItemAction(1.5, { printingId: 1, quantity: 1, condition: "NM" })).toEqual({ ok: false, error: "Invalid id" });
    expect(await addItemAction(1, { printingId: "1" as never, quantity: 1, condition: "NM" })).toEqual({ ok: false, error: "Invalid id" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("creates a binder for the signed-in user and revalidates /binders", async () => {
    signedIn(U1);
    const r = await createPortfolioAction("Main");
    expect(r.ok).toBe(true);
    expect((await listPortfolios(U1)).map((p) => p.name)).toContain("Main");
    expect(revalidatePath).toHaveBeenCalledWith("/binders");
  });

  it("returns the validation error for a blank name instead of throwing", async () => {
    signedIn(U1);
    const r = await createPortfolioAction("   ");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/name/i);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("cannot add an item to someone else's binder", async () => {
    signedIn(U1);
    const r = await addItemAction(otherPortfolioId, { printingId: seed.printings.umbreonHolo, quantity: 1, condition: "NM" });
    expect(r.ok).toBe(false);
    expect(await getPortfolioHoldings(U2, otherPortfolioId)).toEqual([]);
  });

  it("adds an item to your own binder", async () => {
    signedIn(U1);
    const [p] = await listPortfolios(U1);
    const r = await addItemAction(p.id, { printingId: seed.printings.umbreonHolo, quantity: 2, condition: "NM", acquiredPrice: 1100 });
    expect(r.ok).toBe(true);
    expect((await getPortfolioHoldings(U1, p.id)).map((h) => [h.cardName, h.quantity])).toEqual([["Umbreon ex", 2]]);
    expect(revalidatePath).toHaveBeenCalledWith(`/binders/${p.id}`);
  });

  it("renames and deletes your own binder, and refuses another user's", async () => {
    signedIn(U1);
    const p = await createPortfolioAction("Temp");
    expect(p.ok).toBe(true);
    const id = p.ok ? p.data!.id : 0;

    expect(await renamePortfolioAction(id, "Renamed")).toEqual({ ok: true, data: undefined });
    expect((await getPortfolio(U1, id))?.name).toBe("Renamed");
    expect(revalidatePath).toHaveBeenCalledWith(`/binders/${id}`);

    const hijack = await renamePortfolioAction(otherPortfolioId, "hijack");
    expect(hijack.ok).toBe(false);
    if (!hijack.ok) expect(hijack.error).toBe("Portfolio not found");

    expect(await deletePortfolioAction(id)).toEqual({ ok: true, data: undefined });
    expect(await getPortfolio(U1, id)).toBeNull();
    expect(revalidatePath).toHaveBeenCalledWith("/sets");

    const steal = await deletePortfolioAction(otherPortfolioId);
    expect(steal.ok).toBe(false);
    expect(await getPortfolio(U2, otherPortfolioId)).not.toBeNull();
  });
});
