// tests/helpers/tmpdb.ts
// Points lib/db at a throwaway file: libSQL database for one test file and
// removes stale copies both before and after the run (Windows can keep the
// handle open past close(), leaving a file that breaks the next run).
import { rmSync } from "node:fs";

export function useTmpDb(name: string) {
  const file = `.tmp-${name}-${process.pid}-test.db`;
  const clean = () => {
    for (const f of [file, `${file}-shm`, `${file}-wal`]) {
      try { rmSync(f); } catch { /* not present, or handle still held — ignore */ }
    }
  };
  clean();
  process.env.TURSO_DATABASE_URL = `file:${file}`;
  delete process.env.TURSO_AUTH_TOKEN;
  return { file, clean };
}
