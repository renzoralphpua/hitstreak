// scripts/import-deck.mts — local curation until the admin screen ships (Task 8), and a repeatable way to
// load decklists afterwards. Usage (bash; PowerShell: set $env:TURSO_DATABASE_URL first):
//   TURSO_DATABASE_URL=file:hitstreak.local.db npx tsx scripts/import-deck.mts \
//     --game pokemon --name "Charizard ex / Pidgeot" --tier 1 --format standard --source "Regional top cuts, Aug 30" \
//     --as dev@example.com --file decks/zard.txt [--id 3]
// The --as user must have "user".isAdmin = 1 (flip it once locally: UPDATE "user" SET "isAdmin" = 1 WHERE email = '…').
// Unresolved lines are printed with candidates and nothing is written.
import { readFileSync } from "node:fs";
import { db, closeDb } from "@/lib/db";
import { parseDecklist, resolveDecklist } from "@/lib/decks/resolve";
import { upsertMetaDeck } from "@/lib/decks/data";
import { isGameSlug } from "@/lib/decks/types";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i === -1 ? undefined : process.argv[i + 1]; };
const game = arg("game"), name = arg("name"), file = arg("file"), as = arg("as");
if (!isGameSlug(game) || !name || !file || !as) {
  console.error("usage: --game <pokemon|one-piece|riftbound> --name <deck> --file <list.txt> --as <admin email> [--tier N] [--format F] [--archetype A] [--source S] [--id N]");
  process.exit(2);
}

const c = await db();
const user = (await c.execute({ sql: `SELECT id FROM "user" WHERE email = ?`, args: [as] })).rows[0];
if (!user) { console.error(`no user with email ${as}`); closeDb(); process.exit(2); }
const lines = parseDecklist(readFileSync(file, "utf8"), game);
const resolved = await resolveDecklist(game, lines);
const unresolved = resolved.filter((r) => r.cardId == null);
for (const r of unresolved) {
  const hint = r.candidates.length ? " — did you mean: " + r.candidates.map((x) => `${x.name} (${x.setName} ${x.number ?? ""})`).join(" | ") : "";
  console.error(`UNRESOLVED: "${r.line.raw}"${hint}`);
}
if (unresolved.length > 0) { closeDb(); process.exit(1); }
try {
  const id = await upsertMetaDeck(String(user.id), {
    id: arg("id") ? Number(arg("id")) : undefined, gameSlug: game, name, archetype: arg("archetype") ?? null,
    tier: arg("tier") ? Number(arg("tier")) : null, format: arg("format") ?? null, sourceNote: arg("source") ?? null,
    lines: resolved.map((r) => ({ cardId: r.cardId!, zone: r.line.zone, quantity: r.line.quantity })),
  });
  console.log(`meta deck ${id}: ${name} — ${lines.reduce((n, l) => n + l.quantity, 0)} cards in ${lines.length} lines`);
} finally {
  closeDb();
}
