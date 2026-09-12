"use server";
// Selling, from the client. Like every action module here: the session is re-checked (a client can
// call these directly), and failures come back as { ok: false, error } rather than thrown.
import { revalidatePath } from "next/cache";
import { withUser, assertId } from "@/lib/action-utils";
import { sellLot, unsell, type SellInput } from "@/lib/sales";

// Route PATTERN, not a path: the action knows a lot id, and the URL is the collection's slug.
const DETAIL_ROUTE = "/collections/[slug]";

function revalidateAll() {
  revalidatePath(DETAIL_ROUTE, "page");
  revalidatePath("/collections");
  // A sale changes what you own, so set completion and the card page move with it.
  revalidatePath("/cards/[id]", "page");
  revalidatePath("/home");
}

export async function sellLotAction(input: SellInput) {
  const r = await withUser((u) => sellLot(u, { ...input, itemId: assertId(input.itemId) }));
  if (r.ok) revalidateAll();
  return r;
}

export async function unsellAction(saleId: number) {
  const r = await withUser(async (u) => {
    if (!(await unsell(u, assertId(saleId)))) throw new Error("Sale not found");
  });
  if (r.ok) revalidateAll();
  return r;
}
