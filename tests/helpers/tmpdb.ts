// tests/helpers/tmpdb.ts
// Points lib/db at a throwaway file: libSQL database for one test file and
// removes stale copies both before and after the run (Windows can keep the
// handle open past close(), leaving a file that breaks the next run).
import { readdirSync, rmSync } from "node:fs";

export function tmpDb(name: string) {
  // pid-scoped so parallel vitest workers can never share a file even if a name is reused
  const prefix = `.tmp-${name}-`;
  const file = `${prefix}${process.pid}-test.db`;
  const clean = () => {
    // sweep this run's file AND leftovers from earlier runs (different pids) for this name
    let stale: string[] = [];
    try {
      stale = readdirSync(".").filter((f) => f.startsWith(prefix) && f.includes("-test.db"));
    } catch { /* cwd unreadable — nothing to sweep */ }
    for (const f of new Set([file, `${file}-shm`, `${file}-wal`, ...stale])) {
      try { rmSync(f); } catch { /* not present, or handle still held — ignore */ }
    }
  };
  clean();
  process.env.TURSO_DATABASE_URL = `file:${file}`;
  delete process.env.TURSO_AUTH_TOKEN;
  return { file, clean };
}
