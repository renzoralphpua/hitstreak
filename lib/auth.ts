import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { LibsqlDialect } from "@libsql/kysely-libsql";
import { createClient } from "@libsql/client";
import { db } from "./db";

// Better Auth gets its own libSQL client on the same database. Its tables are created by
// our self-initializing schema (lib/schema.ts AUTH_SCHEMA_SQL), so there is no migrate step.
const url = process.env.TURSO_DATABASE_URL;
if (!url) throw new Error("TURSO_DATABASE_URL is not set");
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

/**
 * Kysely calls `Driver.init()` once, lazily, before the first connection is acquired.
 * Hooking it makes our self-initializing schema (lib/db.ts) run before Better Auth's
 * first query, so the auth tables exist even when an auth request is the very first
 * thing to touch a brand-new database.
 */
class EnsuredLibsqlDialect extends LibsqlDialect {
  createDriver() {
    const driver = super.createDriver();
    const init = driver.init.bind(driver);
    driver.init = async (...args: Parameters<typeof init>) => {
      await db();
      await init(...args);
    };
    return driver;
  }
}

export const auth = betterAuth({
  database: { dialect: new EnsuredLibsqlDialect({ client }), type: "sqlite" },
  emailAndPassword: { enabled: true },
  user: {
    additionalFields: {
      isAdmin: { type: "boolean", required: false, defaultValue: false, input: false },
    },
  },
  // Better Auth's origin check rejects POSTs from origins other than baseURL; preview
  // deploys have their own hostnames.
  trustedOrigins: [
    ...(process.env.BETTER_AUTH_URL ? [process.env.BETTER_AUTH_URL] : []),
    ...(process.env.VERCEL_URL ? [`https://${process.env.VERCEL_URL}`] : []),
    ...(process.env.VERCEL_BRANCH_URL ? [`https://${process.env.VERCEL_BRANCH_URL}`] : []),
  ],
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
