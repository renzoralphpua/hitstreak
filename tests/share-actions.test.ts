import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { tmpDb } from "./helpers/tmpdb";
const tmp = tmpDb("share-actions");
import { closeDb } from "@/lib/db";
import { seedMiniCatalog } from "./helpers/seed";
import { createPortfolio } from "@/lib/portfolios";
import { getShareLink, getSharedPortfolio, isShareToken } from "@/lib/share";

// Same seam as tests/actions.test.ts: the session and Next's cache are mocked, everything else is real.
const { getSession, revalidatePath } = vi.hoisted(() => ({ getSession: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ getSession }));
vi.mock("next/cache", () => ({ revalidatePath }));

import { enableShareAction, regenerateShareAction, disableShareAction } from "@/app/(app)/portfolios/actions";

const U1 = "user_1", U2 = "user_2";
const signedIn = (id: string) => getSession.mockResolvedValue({ user: { id } });

let mine: number;
let other: number;
let unshared: number;

beforeAll(async () => {
  await seedMiniCatalog();
  mine = (await createPortfolio(U1, "Main")).id;
  unshared = (await createPortfolio(U1, "Never shared")).id;
  other = (await createPortfolio(U2, "Not yours")).id;
});
afterAll(() => { closeDb(); tmp.clean(); });
beforeEach(() => { getSession.mockReset(); revalidatePath.mockReset(); });

describe("share server actions", () => {
  it("refuses everything when there is no session", async () => {
    getSession.mockResolvedValue(null);
    expect(await enableShareAction(mine)).toEqual({ ok: false, error: "Not signed in" });
    expect(await regenerateShareAction(mine)).toEqual({ ok: false, error: "Not signed in" });
    expect(await disableShareAction(mine)).toEqual({ ok: false, error: "Not signed in" });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(await getShareLink(U1, mine)).toBeNull();
  });

  it("rejects ids that aren't positive integers before they reach the data layer", async () => {
    signedIn(U1);
    expect(await enableShareAction(NaN as never)).toEqual({ ok: false, error: "Invalid id" });
    expect(await regenerateShareAction(-1)).toEqual({ ok: false, error: "Invalid id" });
    expect(await disableShareAction(1.5)).toEqual({ ok: false, error: "Invalid id" });
    expect(await enableShareAction("1" as never)).toEqual({ ok: false, error: "Invalid id" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("the owner can enable sharing and the binder page is revalidated", async () => {
    signedIn(U1);
    const r = await enableShareAction(mine);
    expect(r).toEqual({ ok: true, data: { token: expect.any(String), enabled: true, createdAt: expect.any(String) } });
    if (r.ok) {
      expect(isShareToken(r.data!.token)).toBe(true);
      expect((await getSharedPortfolio(r.data!.token))?.portfolioId).toBe(mine);
    }
    expect(revalidatePath).toHaveBeenCalledWith(`/portfolios/${mine}`);
  });

  it("regenerate hands back a fresh, enabled token and revalidates", async () => {
    signedIn(U1);
    const before = (await getShareLink(U1, mine))!;
    const r = await regenerateShareAction(mine);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data!.enabled).toBe(true);
      expect(r.data!.token).not.toBe(before.token);
    }
    expect(await getSharedPortfolio(before.token)).toBeNull();
    expect(revalidatePath).toHaveBeenCalledWith(`/portfolios/${mine}`);
  });

  it("disable turns the link off and revalidates", async () => {
    signedIn(U1);
    expect(await disableShareAction(mine)).toEqual({ ok: true, data: undefined });
    expect((await getShareLink(U1, mine))?.enabled).toBe(false);
    expect(revalidatePath).toHaveBeenCalledWith(`/portfolios/${mine}`);
  });

  it("another user gets 'Portfolio not found' for every action and nothing changes", async () => {
    signedIn(U2);
    expect(await enableShareAction(mine)).toEqual({ ok: false, error: "Portfolio not found" });
    expect(await regenerateShareAction(mine)).toEqual({ ok: false, error: "Portfolio not found" });
    expect(await disableShareAction(mine)).toEqual({ ok: false, error: "Portfolio not found" });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect((await getShareLink(U1, mine))?.enabled).toBe(false);
    expect(await getShareLink(U2, other)).toBeNull();
  });

  it("disabling a binder that was never shared is 'Portfolio not found'", async () => {
    signedIn(U1);
    expect(await disableShareAction(unshared)).toEqual({ ok: false, error: "Portfolio not found" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
