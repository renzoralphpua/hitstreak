"use server";
// Mutations for portfolios ("binders") and their items. Every action re-checks the session
// (a client can call these directly) and never throws to the client: validation and
// ownership failures come back as { ok: false, error }.
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import * as P from "@/lib/portfolios";
import * as S from "@/lib/share";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

/** Row ids arrive from the client, so they are only trustworthy as far as this check: anything
 *  that isn't a positive integer (NaN, a string, a float, null) is rejected before it reaches SQL. */
function assertId(n: unknown): number {
  if (typeof n !== "number" || !Number.isInteger(n) || n <= 0) throw new Error("Invalid id");
  return n;
}

async function withUser<T>(fn: (userId: string) => Promise<T>): Promise<ActionResult<T>> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in" };
  try {
    return { ok: true, data: await fn(session.user.id) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" };
  }
}

export async function createPortfolioAction(name: string) {
  const r = await withUser((u) => P.createPortfolio(u, name));
  if (r.ok) revalidatePath("/portfolios");
  return r;
}

export async function renamePortfolioAction(id: number, name: string) {
  const r = await withUser(async (u) => {
    if (!(await P.renamePortfolio(u, assertId(id), name))) throw new Error("Portfolio not found");
  });
  if (r.ok) {
    revalidatePath("/portfolios");
    revalidatePath(`/portfolios/${id}`);
  }
  return r;
}

export async function deletePortfolioAction(id: number) {
  const r = await withUser(async (u) => {
    if (!(await P.deletePortfolio(u, assertId(id)))) throw new Error("Portfolio not found");
  });
  if (r.ok) {
    revalidatePath("/portfolios");
    revalidatePath("/sets");
  }
  return r;
}

export async function addItemAction(portfolioId: number, input: P.AddItemInput) {
  const r = await withUser((u) =>
    P.addItem(u, assertId(portfolioId), { ...input, printingId: assertId(input.printingId) })
  );
  if (r.ok) {
    revalidatePath(`/portfolios/${portfolioId}`);
    revalidatePath("/portfolios");
    revalidatePath("/sets");
  }
  return r;
}

export async function updateItemAction(
  portfolioId: number,
  itemId: number,
  patch: { quantity?: number; acquiredPrice?: number | null }
) {
  const r = await withUser(async (u) => {
    assertId(portfolioId);
    if (!(await P.updateItem(u, assertId(itemId), patch))) throw new Error("Item not found");
  });
  if (r.ok) {
    revalidatePath(`/portfolios/${portfolioId}`);
    revalidatePath("/portfolios");
  }
  return r;
}

export async function removeItemAction(portfolioId: number, itemId: number) {
  const r = await withUser(async (u) => {
    assertId(portfolioId);
    if (!(await P.removeItem(u, assertId(itemId)))) throw new Error("Item not found");
  });
  if (r.ok) {
    revalidatePath(`/portfolios/${portfolioId}`);
    revalidatePath("/portfolios");
    revalidatePath("/sets");
  }
  return r;
}

// Share links (lib/share.ts). Only the binder page shows the link, so that is all that revalidates.
export async function enableShareAction(portfolioId: number) {
  const r = await withUser((u) => S.enableShare(u, assertId(portfolioId)));
  if (r.ok) revalidatePath(`/portfolios/${portfolioId}`);
  return r;
}
export async function regenerateShareAction(portfolioId: number) {
  const r = await withUser((u) => S.regenerateShare(u, assertId(portfolioId)));
  if (r.ok) revalidatePath(`/portfolios/${portfolioId}`);
  return r;
}
export async function disableShareAction(portfolioId: number) {
  const r = await withUser(async (u) => {
    if (!(await S.disableShare(u, assertId(portfolioId)))) throw new Error("Portfolio not found");
  });
  if (r.ok) revalidatePath(`/portfolios/${portfolioId}`);
  return r;
}
