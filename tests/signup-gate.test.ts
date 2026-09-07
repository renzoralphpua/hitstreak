import { describe, it, expect, afterAll } from "vitest";
import { tmpDb } from "./helpers/tmpdb";
const tmp = tmpDb("signup-gate");
process.env.BETTER_AUTH_SECRET ??= "test-secret-at-least-32-characters-long-000";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.SIGNUP_ALLOWLIST = " Renzo@Example.com, friend@example.com ,";
import { db, closeDb } from "@/lib/db";
import { parseAllowlist, signupAllowed } from "@/lib/signup-gate";

afterAll(() => { closeDb(); tmp.clean(); });

// Sign-up / sign-in hash or verify the password with scrypt, which is CPU-bound. Under the
// full suite's one-worker-per-file load that can exceed vitest's 5s default (see tests/auth.test.ts).
const SCRYPT = { timeout: 20_000 };

describe("allowlist parsing", () => {
  it("is open when unset or blank, otherwise a lowercased set", () => {
    expect(parseAllowlist(undefined)).toBeNull();
    expect(parseAllowlist("  ")).toBeNull();
    expect([...parseAllowlist(" A@x.com,b@y.com, ")!]).toEqual(["a@x.com", "b@y.com"]);
  });
  it("matches case-insensitively and rejects non-strings", () => {
    const allow = parseAllowlist("a@x.com");
    expect(signupAllowed("A@X.COM", allow)).toBe(true);
    expect(signupAllowed("b@x.com", allow)).toBe(false);
    expect(signupAllowed(42, allow)).toBe(false);
    expect(signupAllowed("anyone", null)).toBe(true);
  });
});

describe("Better Auth sign-up hook", () => {
  it("lets an allowlisted email register and refuses everyone else", SCRYPT, async () => {
    await db();
    const { auth } = await import("@/lib/auth");
    const ok = await auth.api.signUpEmail({ body: { email: "renzo@example.com", password: "correct horse battery", name: "Renzo" }, asResponse: true });
    expect(ok.status).toBe(200);

    // A hooks.before APIError is NOT converted to a Response on direct auth.api.* calls (only the
    // endpoint handler is wrapped — better-auth/dist/api/dispatch.mjs `runBeforeHooks` re-throws),
    // even with asResponse: true: the call rejects with the APIError.
    await expect(
      auth.api.signUpEmail({ body: { email: "stranger@example.com", password: "correct horse battery", name: "S" } })
    ).rejects.toMatchObject({ statusCode: 403, body: { message: expect.stringMatching(/invite/i) } });

    // The HTTP surface the app really uses (AuthForm → authClient → POST /api/auth/sign-up/email)
    // turns it into a 403 JSON response. `origin` must match BETTER_AUTH_URL for the origin check.
    const http = await auth.handler(
      new Request("http://localhost:3000/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ email: "stranger@example.com", password: "correct horse battery", name: "S" }),
      })
    );
    expect(http.status).toBe(403);
    expect((await http.json()).message).toMatch(/invite/i);

    const rows = await (await db()).execute("SELECT email FROM user ORDER BY email");
    expect(rows.rows.map((r) => r.email)).toEqual(["renzo@example.com"]);
  });
  it("still lets anyone sign in", SCRYPT, async () => {
    const { auth } = await import("@/lib/auth");
    const res = await auth.api.signInEmail({ body: { email: "renzo@example.com", password: "correct horse battery" }, asResponse: true });
    expect(res.status).toBe(200);
  });
});
