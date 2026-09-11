"use server";
// Mutations for email price alerts. Same contract as the collection actions: the session is
// re-checked, ids are validated before SQL, and failures come back as { ok: false, error }.
import { revalidatePath } from "next/cache";
import { withUser, assertId } from "@/lib/action-utils";
import * as A from "@/lib/alerts";

export async function createAlertAction(input: A.CreateAlertInput) {
  const r = await withUser((u) => A.createAlert(u, { ...input, printingId: assertId(input.printingId) }));
  if (r.ok) revalidatePath("/alerts");
  return r;
}

export async function deleteAlertAction(id: number) {
  const r = await withUser(async (u) => {
    if (!(await A.deleteAlert(u, assertId(id)))) throw new Error("Alert not found");
  });
  if (r.ok) revalidatePath("/alerts");
  return r;
}
