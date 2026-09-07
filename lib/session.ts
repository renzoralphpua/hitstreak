import { headers } from "next/headers";
import { auth } from "./auth";

/** Server Components / server actions: the real (cryptographic) session check. */
export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}
