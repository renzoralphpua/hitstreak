"use client";
// The curation flow, which is scripts/import-deck.mts with a fix-up step: paste a list → resolve it
// against the catalog → pick a card for anything ambiguous → fill in the metadata → save. The merge
// comes from lib/decks/decklist (db-free) so the client and the CLI fold lines the same way, and the
// action re-checks admin-ness, the game, every id and every quantity before anything is written.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { mergeResolved, type Candidate, type Resolution } from "@/lib/decks/decklist";
import { ZONES, ZONE_LABEL, isGameSlug } from "@/lib/decks/types";
import { Button, CardRow, Input, Pill, SearchField, Textarea } from "@/components/ui";
import { useCardSearch, type CardHit } from "@/components/ui/useCardSearch";
import { resolveDecklistAction, saveMetaDeckAction } from "./actions";
import { EDIT_EVENT, type EditDeckDetail } from "./edit-event";

const TIERS = [1, 2, 3, 4] as const;
/** resolution index → the card a human picked for it. The whole card, not just its id: a card picked
 *  through the catalog search is not in the line's candidates, so the id alone leaves the row with
 *  nothing to show but the pasted text. */
type Picks = Record<number, Candidate>;

const blank = { name: "", archetype: "", tier: "", format: "", sourceNote: "", text: "" };

export default function CurationForm({ games }: { games: Array<{ slug: string; name: string }> }) {
  const router = useRouter();
  const [gameSlug, setGameSlug] = useState(games[0]?.slug ?? "pokemon");
  const [fields, setFields] = useState(blank);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [resolutions, setResolutions] = useState<Resolution[] | null>(null);
  const [picks, setPicks] = useState<Picks>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const set = (k: keyof typeof blank, v: string) => setFields((f) => ({ ...f, [k]: v }));
  const clearResolved = useCallback(() => { setResolutions(null); setPicks({}); }, []);

  // "Edit" on a row hands the deck over on a window event (the row is a sibling island, not a child),
  // so this listener is the only place editing state is set — never during render.
  useEffect(() => {
    const onEdit = (e: Event) => {
      const d = (e as CustomEvent<EditDeckDetail>).detail;
      if (!d) return;
      setEditingId(d.id);
      if (isGameSlug(d.gameSlug)) setGameSlug(d.gameSlug);
      setFields({
        name: d.name, archetype: d.archetype ?? "", tier: d.tier == null ? "" : String(d.tier),
        format: d.format ?? "", sourceNote: d.sourceNote ?? "", text: d.decklist,
      });
      clearResolved();
      setError(null);
      setNotice(null);
    };
    window.addEventListener(EDIT_EVENT, onEdit);
    return () => window.removeEventListener(EDIT_EVENT, onEdit);
  }, [clearResolved]);

  function stopEditing() {
    setEditingId(null);
    setFields(blank);
    clearResolved();
    setError(null);
    setNotice(null);
  }

  async function resolve() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await resolveDecklistAction(gameSlug, fields.text);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResolutions(res.data ?? []);
      setPicks({});
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  /** A resolution's card: its own match, or the one a human picked for it. */
  const cardIdOf = (r: Resolution, i: number) => picks[i]?.cardId ?? r.cardId;
  const ready = resolutions !== null && resolutions.length > 0 && resolutions.every((r, i) => cardIdOf(r, i) != null);

  async function save() {
    if (!resolutions) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const lines = mergeResolved(resolutions.map((r, i) => ({ ...r, cardId: cardIdOf(r, i) })));
      const tier = fields.tier === "" ? null : Number(fields.tier);
      const res = await saveMetaDeckAction({
        id: editingId ?? undefined, gameSlug, name: fields.name.trim(),
        archetype: fields.archetype.trim() || null, tier, format: fields.format.trim() || null,
        sourceNote: fields.sourceNote.trim() || null, lines,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotice("Saved");
      // Editing keeps the deck loaded so a second pass is one more Resolve away; a new deck clears out.
      if (editingId == null) { setFields(blank); clearResolved(); }
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const multiZone = isGameSlug(gameSlug) && ZONES[gameSlug].length > 1;

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-ink">{editingId == null ? "Curate a deck" : `Editing deck #${editingId}`}</span>
        {editingId != null && (
          <Button variant="secondary" size="sm" onClick={stopEditing}>
            Stop editing
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {games.map((g) => (
          <Pill
            key={g.slug}
            selected={g.slug === gameSlug}
            // Switching game abandons an edit in progress: the loaded deck belongs to the old game, so
            // Save would post a mismatched {id, gameSlug} and the server could only answer the
            // misleading "Meta deck not found".
            onClick={() => {
              if (editingId != null && g.slug !== gameSlug) stopEditing();
              else clearResolved();
              setGameSlug(g.slug);
            }}
          >
            {g.name}
          </Pill>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Input label="Name" value={fields.name} maxLength={80} onChange={(e) => set("name", e.target.value)} />
        <Input label="Archetype" value={fields.archetype} onChange={(e) => set("archetype", e.target.value)} />
        <Input label="Format" value={fields.format} onChange={(e) => set("format", e.target.value)} />
        <Input label="Source" value={fields.sourceNote} onChange={(e) => set("sourceNote", e.target.value)} />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-caption text-muted">Tier</span>
        <Pill selected={fields.tier === ""} onClick={() => set("tier", "")} aria-label="No tier">
          —
        </Pill>
        {TIERS.map((t) => (
          <Pill key={t} selected={fields.tier === String(t)} onClick={() => set("tier", String(t))}>
            {`Tier ${t}`}
          </Pill>
        ))}
      </div>

      <Textarea
        label="Decklist"
        value={fields.text}
        placeholder={"4 Charmander MEW 4\n3 Charizard ex\nTrainer:\n4 Rare Candy"}
        onChange={(e) => set("text", e.target.value)}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy || fields.text.trim() === ""} onClick={resolve}>
          Resolve
        </Button>
        <Button size="sm" disabled={busy || !ready || fields.name.trim() === ""} onClick={save}>
          {editingId == null ? "Save deck" : "Save changes"}
        </Button>
        {notice && <span className="text-base text-gain">{notice}</span>}
      </div>

      {error && (
        <p role="alert" className="text-base text-accent">
          {error}
        </p>
      )}

      {resolutions !== null && resolutions.length === 0 && (
        <p className="text-base text-dim">Nothing to resolve — that list has no card lines.</p>
      )}

      {resolutions !== null && resolutions.length > 0 && (
        <ul className="flex flex-col divide-y divide-hairline-soft rounded-panel border border-hairline bg-surface">
          {resolutions.map((r, i) => (
            <ResolutionRow
              key={`${i}-${r.line.raw}`}
              resolution={r}
              cardId={cardIdOf(r, i)}
              pick={picks[i] ?? null}
              gameSlug={gameSlug}
              showZone={multiZone}
              onPick={(card) => setPicks((p) => ({ ...p, [i]: card }))}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** One parsed line: resolved lines read back as `×qty name · set · number`, unresolved ones offer their
 *  candidates and, failing those, a catalog search. A resolved row keeps a "Change" button — this screen
 *  exists for human review, so a mis-pick has to be correctable without re-Resolving the whole list
 *  (which would throw away every other pick). */
function ResolutionRow({
  resolution, cardId, pick, gameSlug, showZone, onPick,
}: {
  resolution: Resolution; cardId: number | null; pick: Candidate | null; gameSlug: string; showZone: boolean;
  onPick: (card: Candidate) => void;
}) {
  const { line, candidates } = resolution;
  const [changing, setChanging] = useState(false);
  // A search pick is not in `candidates`, so it has to carry its own name/set/number.
  const chosen = pick ?? (cardId == null ? null : candidates.find((c) => c.cardId === cardId) ?? null);
  const zone = showZone && isGameSlug(gameSlug) ? ZONE_LABEL[line.zone] : null;
  const picking = cardId == null || changing;
  const choose = (c: Candidate) => { onPick(c); setChanging(false); };

  return (
    <li className="flex flex-col gap-2 px-3 py-2.5" data-resolved={cardId != null}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="num text-base font-semibold text-ink">×{line.quantity}</span>
        <span className="min-w-0 grow text-ink">{chosen ? chosen.name : line.text}</span>
        {zone && <span className="text-caption text-dim">{zone}</span>}
        <span className={`text-caption ${cardId == null ? "text-accent" : "text-gain"}`}>
          {cardId == null ? "needs a card" : chosen ? `${chosen.setName} · ${chosen.number ?? "—"}` : "resolved"}
        </span>
        {cardId != null && (
          <Button variant="secondary" size="sm" onClick={() => setChanging((v) => !v)}>
            {changing ? "Keep this card" : "Change"}
          </Button>
        )}
      </div>
      {picking && (
        <>
          {candidates.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {candidates.map((c) => (
                <Pill key={c.cardId} selected={c.cardId === cardId} onClick={() => choose(c)}>
                  {`${c.name} · ${c.setName} · ${c.number ?? "—"}`}
                </Pill>
              ))}
            </div>
          )}
          <CardPicker gameSlug={gameSlug} initialQuery={line.text} onPick={choose} />
        </>
      )}
    </li>
  );
}

/** Catalog search for a line no candidate fits. Its own component so each open row owns one search. */
function CardPicker({ gameSlug, initialQuery, onPick }: { gameSlug: string; initialQuery: string; onPick: (card: Candidate) => void }) {
  const [q, setQ] = useState("");
  const { hits, settled, error } = useCardSearch(q, true, gameSlug);
  return (
    <div className="flex flex-col gap-2">
      <SearchField value={q} onChange={setQ} placeholder={`Search for “${initialQuery}”…`} />
      {hits.length > 0 && (
        <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
          {hits.map((h: CardHit) => (
            <li key={h.cardId}>
              <CardRow
                name={h.name}
                subtitle={h.subtitle}
                imageUrl={h.imageUrl}
                onClick={() => onPick({ cardId: h.cardId, name: h.name, setName: h.setName, number: h.number })}
              />
            </li>
          ))}
        </ul>
      )}
      {settled && hits.length === 0 && <p className="text-base text-dim">No cards match “{q.trim()}”.</p>}
      {error && (
        <p role="alert" className="text-base text-accent">
          {error}
        </p>
      )}
    </div>
  );
}
