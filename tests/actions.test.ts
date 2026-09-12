import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { tmpDb } from "./helpers/tmpdb";
const tmp = tmpDb("actions");
import { closeDb } from "@/lib/db";
import { seedMiniCatalog } from "./helpers/seed";
import { listCollections, createCollection, getCollection, getCollectionHoldings } from "@/lib/collections";

// The session and Next's cache are the two things a server action reaches for that a plain
// node test can't provide. Importing actions.ts here is fine: "use server" is inert in vitest.
const { getSession, revalidatePath } = vi.hoisted(() => ({ getSession: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ getSession }));
vi.mock("next/cache", () => ({ revalidatePath }));

import {
  createCollectionAction,
  renameCollectionAction,
  deleteCollectionAction,
  addItemAction,
} from "@/app/(app)/collections/actions";

const U1 = "user_1", U2 = "user_2";
const signedIn = (id: string) => getSession.mockResolvedValue({ user: { id } });

let seed: Awaited<ReturnType<typeof seedMiniCatalog>>;
let otherCollectionId: number;

beforeAll(async () => {
  seed = await seedMiniCatalog();
  otherCollectionId = (await createCollection(U2, "Not yours")).id;
});
afterAll(() => { closeDb(); tmp.clean(); });
beforeEach(() => { getSession.mockReset(); revalidatePath.mockReset(); });

describe("collection server actions", () => {
  it("refuses everything when there is no session", async () => {
    getSession.mockResolvedValue(null);
    expect(await createCollectionAction("Main")).toEqual({ ok: false, error: "Not signed in" });
    expect(await renameCollectionAction(1, "Main")).toEqual({ ok: false, error: "Not signed in" });
    expect(await deleteCollectionAction(1)).toEqual({ ok: false, error: "Not signed in" });
    expect(await addItemAction(1, { printingId: 1, quantity: 1, condition: "NM" })).toEqual({ ok: false, error: "Not signed in" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects ids that aren't positive integers before they reach the data layer", async () => {
    signedIn(U1);
    expect(await renameCollectionAction(NaN as never, "x")).toEqual({ ok: false, error: "Invalid id" });
    expect(await deleteCollectionAction(-1)).toEqual({ ok: false, error: "Invalid id" });
    expect(await addItemAction(1.5, { printingId: 1, quantity: 1, condition: "NM" })).toEqual({ ok: false, error: "Invalid id" });
    expect(await addItemAction(1, { printingId: "1" as never, quantity: 1, condition: "NM" })).toEqual({ ok: false, error: "Invalid id" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("creates a collection for the signed-in user and revalidates /collections", async () => {
    signedIn(U1);
    const r = await createCollectionAction("Main");
    expect(r.ok).toBe(true);
    expect((await listCollections(U1)).map((p) => p.name)).toContain("Main");
    expect(revalidatePath).toHaveBeenCalledWith("/collections");
  });

  it("returns the validation error for a blank name instead of throwing", async () => {
    signedIn(U1);
    const r = await createCollectionAction("   ");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/name/i);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("cannot add an item to someone else's collection", async () => {
    signedIn(U1);
    const r = await addItemAction(otherCollectionId, { printingId: seed.printings.umbreonHolo, quantity: 1, condition: "NM" });
    expect(r.ok).toBe(false);
    expect(await getCollectionHoldings(U2, otherCollectionId)).toEqual([]);
  });

  it("adds an item to your own collection", async () => {
    signedIn(U1);
    const [p] = await listCollections(U1);
    const r = await addItemAction(p.id, { printingId: seed.printings.umbreonHolo, quantity: 2, condition: "NM", acquiredPrice: 1100 });
    expect(r.ok).toBe(true);
    expect((await getCollectionHoldings(U1, p.id)).map((h) => [h.cardName, h.quantity])).toEqual([["Umbreon ex", 2]]);
    expect(revalidatePath).toHaveBeenCalledWith("/collections/[slug]", "page");
  });

  it("renames and deletes your own collection, and refuses another user's", async () => {
    signedIn(U1);
    const p = await createCollectionAction("Temp");
    expect(p.ok).toBe(true);
    const id = p.ok ? p.data!.id : 0;

    expect(await renameCollectionAction(id, "Renamed")).toEqual({ ok: true, data: undefined });
    expect((await getCollection(U1, id))?.name).toBe("Renamed");
    expect(revalidatePath).toHaveBeenCalledWith("/collections/[slug]", "page");

    const hijack = await renameCollectionAction(otherCollectionId, "hijack");
    expect(hijack.ok).toBe(false);
    if (!hijack.ok) expect(hijack.error).toBe("Collection not found");

    expect(await deleteCollectionAction(id)).toEqual({ ok: true, data: undefined });
    expect(await getCollection(U1, id)).toBeNull();
    expect(revalidatePath).toHaveBeenCalledWith("/sets");

    const steal = await deleteCollectionAction(otherCollectionId);
    expect(steal.ok).toBe(false);
    expect(await getCollection(U2, otherCollectionId)).not.toBeNull();
  });
});
