// A brand-new database where the FIRST thing to touch it is an auth request.
// lib/auth builds its own libSQL client, so without the driver-init hook in
// lib/auth.ts the Better Auth tables would not exist yet and sign-up would 500.
import { describe, it, expect, afterAll } from "vitest";
import { tmpDb } from "./helpers/tmpdb";

const tmp = tmpDb("auth-fresh");
process.env.BETTER_AUTH_SECRET ??= "test-secret-at-least-32-characters-long-000";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";

import { db, closeDb } from "@/lib/db";

afterAll(() => {
  closeDb();
  tmp.clean();
});

describe("Better Auth on a cold database", () => {
  it("signs up without any prior db() call", async () => {
    const { auth } = await import("@/lib/auth"); // no db() first — on purpose
    const res = await auth.api.signUpEmail({
      body: { email: "cold@example.com", password: "correct horse battery", name: "Cold" },
      asResponse: true,
    });
    expect(res.status).toBe(200);

    const c = await db();
    const rows = await c.execute("SELECT COUNT(*) AS n FROM user");
    expect(Number(rows.rows[0].n)).toBe(1);
  });
});
