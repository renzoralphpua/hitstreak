import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { LibsqlDialect } from "@libsql/kysely-libsql";
import { createClient } from "@libsql/client";

// Better Auth gets its own libSQL client on the same database. Its tables are created by
// our self-initializing schema (lib/schema.ts AUTH_SCHEMA_SQL), so there is no migrate step.
const url = process.env.TURSO_DATABASE_URL;
if (!url) throw new Error("TURSO_DATABASE_URL is not set");
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

export const auth = betterAuth({
  database: { dialect: new LibsqlDialect({ client }), type: "sqlite" },
  emailAndPassword: { enabled: true },
  user: {
    additionalFields: {
      isAdmin: { type: "boolean", required: false, defaultValue: false, input: false },
    },
  },
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
