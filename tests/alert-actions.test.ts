import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { tmpDb } from "./helpers/tmpdb";
const tmp = tmpDb("alert-actions");
import { closeDb } from "@/lib/db";
import { seedMiniCatalog } from "./helpers/seed";
import { listAlerts } from "@/lib/alerts";

// Same seam as tests/actions.test.ts: the session and Next's cache are mocked, everything else is real.
const { getSession, revalidatePath } = vi.hoisted(() => ({ getSession: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ getSession }));
vi.mock("next/cache", () => ({ revalidatePath }));

import { createAlertAction, deleteAlertAction } from "@/app/(app)/alerts/actions";

const U1 = "user_1", U2 = "user_2";
const signedIn = (id: string) => getSession.mockResolvedValue({ user: { id } });

let seed: Awaited<ReturnType<typeof seedMiniCatalog>>;
beforeAll(async () => { seed = await seedMiniCatalog(); });
afterAll(() => { closeDb(); tmp.clean(); });
beforeEach(() => { getSession.mockReset(); revalidatePath.mockReset(); });

describe("alert server actions", () => {
  it("refuses everything when there is no session", async () => {
    getSession.mockResolvedValue(null);
    expect(await createAlertAction({ printingId: seed.printings.umbreonHolo, direction: "above", threshold: 1450 })).toEqual({ ok: false, error: "Not signed in" });
    expect(await deleteAlertAction(1)).toEqual({ ok: false, error: "Not signed in" });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(await listAlerts(U1)).toEqual([]);
  });

  it("rejects ids that aren't positive integers before they reach the data layer", async () => {
    signedIn(U1);
    expect(await createAlertAction({ printingId: NaN, direction: "above", threshold: 1 })).toEqual({ ok: false, error: "Invalid id" });
    expect(await createAlertAction({ printingId: "1" as never, direction: "above", threshold: 1 })).toEqual({ ok: false, error: "Invalid id" });
    expect(await deleteAlertAction(-1)).toEqual({ ok: false, error: "Invalid id" });
    expect(await deleteAlertAction(1.5)).toEqual({ ok: false, error: "Invalid id" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("creates an alert for the signed-in user, returns its id and revalidates /alerts", async () => {
    signedIn(U1);
    const r = await createAlertAction({ printingId: seed.printings.umbreonHolo, direction: "above", threshold: 1450 });
    expect(r).toEqual({ ok: true, data: expect.any(Number) });
    const list = await listAlerts(U1);
    expect(list).toHaveLength(1);
    if (r.ok) expect(list[0].id).toBe(r.data);
    expect(list[0]).toMatchObject({ printingId: seed.printings.umbreonHolo, direction: "above", threshold: 1450, armed: true });
    expect(revalidatePath).toHaveBeenCalledWith("/alerts");
  });

  it("surfaces a validation error as { ok: false, error } instead of throwing", async () => {
    signedIn(U1);
    const dir = await createAlertAction({ printingId: seed.printings.umbreonHolo, direction: "sideways", threshold: 1 });
    expect(dir.ok).toBe(false);
    if (!dir.ok) expect(dir.error).toMatch(/direction/i);
    const thr = await createAlertAction({ printingId: seed.printings.umbreonHolo, direction: "below", threshold: 0 });
    expect(thr.ok).toBe(false);
    if (!thr.ok) expect(thr.error).toMatch(/threshold/i);
    const missing = await createAlertAction({ printingId: 99999, direction: "below", threshold: 1 });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toMatch(/printing/i);
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(await listAlerts(U1)).toHaveLength(1);
  });

  it("another user cannot delete your alert, but you can", async () => {
    const [mine] = await listAlerts(U1);

    signedIn(U2);
    expect(await deleteAlertAction(mine.id)).toEqual({ ok: false, error: "Alert not found" });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(await listAlerts(U1)).toHaveLength(1);

    signedIn(U1);
    expect(await deleteAlertAction(mine.id)).toEqual({ ok: true, data: undefined });
    expect(revalidatePath).toHaveBeenCalledWith("/alerts");
    expect(await listAlerts(U1)).toEqual([]);

    // Deleting it again is the same "not found" — nothing to re-check ownership of.
    revalidatePath.mockReset();
    expect(await deleteAlertAction(mine.id)).toEqual({ ok: false, error: "Alert not found" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
