import { describe, it, expect, afterAll } from "vitest";
import { tmpDb } from "./helpers/tmpdb";

const tmp = tmpDb("auth");
process.env.BETTER_AUTH_SECRET ??= "test-secret-at-least-32-characters-long-000";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";

import { db, closeDb } from "@/lib/db";

afterAll(() => {
  closeDb();
  tmp.clean();
});

describe("Better Auth on libSQL", () => {
  it("creates the auth tables via the self-initializing schema", async () => {
    const c = await db();
    const r = await c.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
    const names = r.rows.map((x) => String(x.name));
    for (const t of ["user", "session", "account", "verification"]) expect(names).toContain(t);
  });

  it("signs up, signs in, and resolves the session from the cookie", async () => {
    await db(); // schema first — lib/auth creates its own client against the same file
    const { auth } = await import("@/lib/auth");
    const email = "renzo@example.com";
    const signUp = await auth.api.signUpEmail({
      body: { email, password: "correct horse battery", name: "Renzo" },
      asResponse: true,
    });
    expect(signUp.status).toBe(200);

    const signIn = await auth.api.signInEmail({
      body: { email, password: "correct horse battery" },
      asResponse: true,
    });
    expect(signIn.status).toBe(200);
    const cookie = signIn.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/session_token/);

    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(session?.user.email).toBe(email);
    // stored as INTEGER 0 in SQLite; the kysely adapter maps it back to a real boolean
    expect((session?.user as { isAdmin?: boolean }).isAdmin).toBe(false);
  });

  it("rejects a wrong password", async () => {
    const { auth } = await import("@/lib/auth");
    const res = await auth.api.signInEmail({
      body: { email: "renzo@example.com", password: "nope" },
      asResponse: true,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
