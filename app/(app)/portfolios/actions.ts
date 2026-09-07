"use server";
// Mutations for portfolios ("binders") and their items. Every action re-checks the session
// (a client can call these directly) and never throws to the client: validation and
// ownership failures come back as { ok: false, error }.
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import * as P from "@/lib/portfolios";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

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
    if (!(await P.renamePortfolio(u, id, name))) throw new Error("Portfolio not found");
  });
  if (r.ok) {
    revalidatePath("/portfolios");
    revalidatePath(`/portfolios/${id}`);
  }
  return r;
}

export async function deletePortfolioAction(id: number) {
  const r = await withUser(async (u) => {
    if (!(await P.deletePortfolio(u, id))) throw new Error("Portfolio not found");
  });
  if (r.ok) {
    revalidatePath("/portfolios");
    revalidatePath("/sets");
  }
  return r;
}

export async function addItemAction(portfolioId: number, input: P.AddItemInput) {
  const r = await withUser((u) => P.addItem(u, portfolioId, input));
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
    if (!(await P.updateItem(u, itemId, patch))) throw new Error("Item not found");
  });
  if (r.ok) {
    revalidatePath(`/portfolios/${portfolioId}`);
    revalidatePath("/portfolios");
  }
  return r;
}

export async function removeItemAction(portfolioId: number, itemId: number) {
  const r = await withUser(async (u) => {
    if (!(await P.removeItem(u, itemId))) throw new Error("Item not found");
  });
  if (r.ok) {
    revalidatePath(`/portfolios/${portfolioId}`);
    revalidatePath("/portfolios");
    revalidatePath("/sets");
  }
  return r;
}
