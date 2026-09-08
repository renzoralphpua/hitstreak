// lib/signup-gate.ts
// SIGNUP_ALLOWLIST gates registration (spec §13: gate sign-up before the app is public). Unset or
// blank = open sign-up (local dev, the very first deploy). Set = a comma-separated list of the only
// addresses that may register; everyone else gets 403 from the Better Auth hook in lib/auth.ts.
export function parseAllowlist(raw: string | undefined): Set<string> | null {
  const list = (raw ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.length === 0 ? null : new Set(list);
}

export function signupAllowed(email: unknown, allow: Set<string> | null): boolean {
  if (allow === null) return true;
  return typeof email === "string" && allow.has(email.trim().toLowerCase());
}

export const isSignupGated = () => parseAllowlist(process.env.SIGNUP_ALLOWLIST) !== null;
