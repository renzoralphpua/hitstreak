"use server";
// Mutations for portfolios ("binders") and their items. Every action re-checks the session
// (a client can call these directly) and never throws to the client: validation and
// ownership failures come back as { ok: false, error } — see lib/action-utils.ts.
import { revalidatePath } from "next/cache";
import { withUser, assertId } from "@/lib/action-utils";
import * as P from "@/lib/portfolios";
import * as S from "@/lib/share";

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

// Holding-level operations. `updateItemAction` and `removeItemAction` above address ONE lot by id
// (per-lot editing); these two address the whole holding, which is what the binder's row controls
// mean. There is deliberately no "add a copy" here — an addition is an acquisition with a price and
// a date, so it goes through `addItemAction`, which records it as its own lot.

export async function decrementHoldingAction(portfolioId: number, printingId: number, condition: string) {
  const r = await withUser(async (u) => {
    if (!(await P.decrementHolding(u, assertId(portfolioId), assertId(printingId), condition))) {
      throw new Error("Holding not found");
    }
  });
  if (r.ok) {
    revalidatePath(`/portfolios/${portfolioId}`);
    revalidatePath("/portfolios");
    revalidatePath("/sets");
  }
  return r;
}

export async function removeHoldingAction(portfolioId: number, printingId: number, condition: string) {
  const r = await withUser(async (u) => {
    if (!(await P.removeHolding(u, assertId(portfolioId), assertId(printingId), condition))) {
      throw new Error("Holding not found");
    }
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
