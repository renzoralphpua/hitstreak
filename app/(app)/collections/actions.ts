"use server";
// Mutations for collections ("collections") and their items. Every action re-checks the session
// (a client can call these directly) and never throws to the client: validation and
// ownership failures come back as { ok: false, error } — see lib/action-utils.ts.
import { revalidatePath } from "next/cache";
import { withUser, assertId } from "@/lib/action-utils";
import * as P from "@/lib/collections";
import * as S from "@/lib/share";

export async function createCollectionAction(name: string) {
  const r = await withUser((u) => P.createCollection(u, name));
  if (r.ok) revalidatePath("/collections");
  return r;
}

export async function renameCollectionAction(id: number, name: string) {
  const r = await withUser(async (u) => {
    if (!(await P.renameCollection(u, assertId(id), name))) throw new Error("Collection not found");
  });
  if (r.ok) {
    revalidatePath("/collections");
    revalidatePath(`/collections/${id}`);
  }
  return r;
}

export async function deleteCollectionAction(id: number) {
  const r = await withUser(async (u) => {
    if (!(await P.deleteCollection(u, assertId(id)))) throw new Error("Collection not found");
  });
  if (r.ok) {
    revalidatePath("/collections");
    revalidatePath("/sets");
  }
  return r;
}

export async function addItemAction(collectionId: number, input: P.AddItemInput) {
  const r = await withUser((u) =>
    P.addItem(u, assertId(collectionId), { ...input, printingId: assertId(input.printingId) })
  );
  if (r.ok) {
    revalidatePath(`/collections/${collectionId}`);
    revalidatePath("/collections");
    revalidatePath("/sets");
  }
  return r;
}

export async function updateItemAction(
  collectionId: number,
  itemId: number,
  patch: { quantity?: number; acquiredPrice?: number | null }
) {
  const r = await withUser(async (u) => {
    assertId(collectionId);
    if (!(await P.updateItem(u, assertId(itemId), patch))) throw new Error("Item not found");
  });
  if (r.ok) {
    revalidatePath(`/collections/${collectionId}`);
    revalidatePath("/collections");
  }
  return r;
}

export async function removeItemAction(collectionId: number, itemId: number) {
  const r = await withUser(async (u) => {
    assertId(collectionId);
    if (!(await P.removeItem(u, assertId(itemId)))) throw new Error("Item not found");
  });
  if (r.ok) {
    revalidatePath(`/collections/${collectionId}`);
    revalidatePath("/collections");
    revalidatePath("/sets");
  }
  return r;
}

// Holding-level operations. `updateItemAction` and `removeItemAction` above address ONE lot by id
// (per-lot editing); these two address the whole holding, which is what the collection's row controls
// mean. There is deliberately no "add a copy" here — an addition is an acquisition with a price and
// a date, so it goes through `addItemAction`, which records it as its own lot.

export async function decrementHoldingAction(collectionId: number, printingId: number, condition: string) {
  const r = await withUser(async (u) => {
    if (!(await P.decrementHolding(u, assertId(collectionId), assertId(printingId), condition))) {
      throw new Error("Holding not found");
    }
  });
  if (r.ok) {
    revalidatePath(`/collections/${collectionId}`);
    revalidatePath("/collections");
    revalidatePath("/sets");
  }
  return r;
}

export async function removeHoldingAction(collectionId: number, printingId: number, condition: string) {
  const r = await withUser(async (u) => {
    if (!(await P.removeHolding(u, assertId(collectionId), assertId(printingId), condition))) {
      throw new Error("Holding not found");
    }
  });
  if (r.ok) {
    revalidatePath(`/collections/${collectionId}`);
    revalidatePath("/collections");
    revalidatePath("/sets");
  }
  return r;
}

// Share links (lib/share.ts). Only the collection page shows the link, so that is all that revalidates.
export async function enableShareAction(collectionId: number) {
  const r = await withUser((u) => S.enableShare(u, assertId(collectionId)));
  if (r.ok) revalidatePath(`/collections/${collectionId}`);
  return r;
}
export async function regenerateShareAction(collectionId: number) {
  const r = await withUser((u) => S.regenerateShare(u, assertId(collectionId)));
  if (r.ok) revalidatePath(`/collections/${collectionId}`);
  return r;
}
export async function disableShareAction(collectionId: number) {
  const r = await withUser(async (u) => {
    if (!(await S.disableShare(u, assertId(collectionId)))) throw new Error("Collection not found");
  });
  if (r.ok) revalidatePath(`/collections/${collectionId}`);
  return r;
}
