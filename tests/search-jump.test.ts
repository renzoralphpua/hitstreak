// The palette's "Go to" group, run against a REAL SQLite database.
//
// This file exists because two bugs shipped in one function with no test behind it, and neither was
// the kind a typecheck can see:
//
//   1. `ESCAPE '\'` inside a template literal collapses to `ESCAPE ''`, which SQLite rejects at
//      execution time with "ESCAPE expression must be a single character". The TypeScript is
//      perfectly valid; only running the query finds it.
//   2. The set href was built as /sets/<slug>, missing the game segment the route has needed since
//      set URLs moved to /sets/<game>/<slug>. Every jump to a set 404'd.
//
// So: no mocked database here. The query has to actually execute.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { tmpDb } from "./helpers/tmpdb";
const tmp = tmpDb("search-jump");
import { db, closeDb } from "@/lib/db";
import { seedMiniCatalog } from "./helpers/seed";
import { searchJumpTargets } from "@/lib/catalog";

const ME = "user_1", THEM = "user_2";

beforeAll(async () => {
  await seedMiniCatalog();
  const c = await db();
  await c.execute({ sql: "UPDATE sets SET slug = ? WHERE id = 1", args: ["prismatic-evolutions"] });
  // Set 2 deliberately keeps a NULL slug: the id must still produce a reachable URL.
  await c.batch(
    [
      { sql: `INSERT INTO decks (game_id, owner_user_id, name, format) VALUES (1, ?, 'Charizard Turbo', 'standard')`, args: [ME] },
      { sql: `INSERT INTO decks (game_id, owner_user_id, name, tier, format) VALUES (1, NULL, 'Charizard ex Meta', 1, 'standard')`, args: [] },
      { sql: `INSERT INTO decks (game_id, owner_user_id, name, format) VALUES (1, ?, 'Charizard Secret Build', 'standard')`, args: [THEM] },
    ],
    "write"
  );
});
afterAll(() => { closeDb(); tmp.clean(); });

describe("searchJumpTargets", () => {
  it("executes at all — the ESCAPE clause has to survive into SQLite", async () => {
    // The regression: this threw "ESCAPE expression must be a single character" and the palette 500'd.
    await expect(searchJumpTargets(ME, "prismatic")).resolves.toBeInstanceOf(Array);
  });

  it("finds a set by name and links it with its GAME in the path", async () => {
    const [hit] = await searchJumpTargets(ME, "prismatic");
    expect(hit.kind).toBe("set");
    expect(hit.href).toBe("/sets/pokemon/prismatic-evolutions");
    expect(hit.caption).toContain("Pokémon");
    expect(hit.caption).toContain("PRE");
  });

  it("finds a set by its code too, because that is how sets get referred to", async () => {
    const hits = await searchJumpTargets(ME, "OP08");
    expect(hits.some((h) => h.name === "Two Legends")).toBe(true);
  });

  it("falls back to the id for a set with no slug, rather than to a broken URL", async () => {
    const [hit] = await searchJumpTargets(ME, "Two Legends");
    // /sets/<game>/<id> is accepted and redirects to the slug, so this stays reachable.
    expect(hit.href).toBe("/sets/one-piece/2");
  });

  it("returns your decks and the meta ones, but never someone else's", async () => {
    const names = (await searchJumpTargets(ME, "charizard")).map((h) => h.name);
    expect(names).toContain("Charizard Turbo");
    expect(names).toContain("Charizard ex Meta");
    expect(names).not.toContain("Charizard Secret Build");
  });

  it("says which kind of deck a row is", async () => {
    const decks = (await searchJumpTargets(ME, "charizard")).filter((h) => h.kind === "deck");
    expect(decks.find((d) => d.name === "Charizard Turbo")?.caption).toContain("your deck");
    expect(decks.find((d) => d.name === "Charizard ex Meta")?.caption).toContain("meta deck");
  });

  it("treats a LIKE wildcard as a literal rather than a match-everything", async () => {
    // This is what the ESCAPE clause is FOR: "%" typed by a person means a percent sign.
    expect(await searchJumpTargets(ME, "%%")).toEqual([]);
    expect(await searchJumpTargets(ME, "_r")).toEqual([]);
  });

  it("does not choke on a backslash, which is the escape character itself", async () => {
    await expect(searchJumpTargets(ME, "a\\b")).resolves.toEqual([]);
    await expect(searchJumpTargets(ME, "\\")).resolves.toBeInstanceOf(Array);
  });

  it("says nothing for a query too short to be meant", async () => {
    expect(await searchJumpTargets(ME, "p")).toEqual([]);
    expect(await searchJumpTargets(ME, "  ")).toEqual([]);
  });

  it("honours the limit on each kind", async () => {
    const hits = await searchJumpTargets(ME, "charizard", 1);
    expect(hits.filter((h) => h.kind === "deck")).toHaveLength(1);
  });
});
