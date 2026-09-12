// Joining TCGplayer's set names to pokemontcg.io's, which is where the era headings on /sets come from.
// Every case here is a real pair that went wrong in production: the matcher that shipped first had no
// year guard on its code fallback and filed XY Promos (2013) under the Base era (1999).
import { describe, it, expect } from "vitest";
import {
  normName, stripEraPrefix, nameVariants, eraFromName, indexUpstream, resolveSetMeta, rankSeries,
  type UpstreamSet,
} from "@/lib/set-match";

const up = (name: string, series: string, releaseDate: string, ptcgoCode?: string): UpstreamSet => ({
  id: normName(name), name, series, releaseDate, ptcgoCode,
});

const UPSTREAM = [
  up("Base", "Base", "1999/01/09", "BS"),
  up("Wizards Black Star Promos", "Base", "1999/07/01", "PR"),
  up("Team Rocket Returns", "EX", "2004/11/01", "TRR"),   // upstream drops the "EX " our name carries
  up("Evolutions", "XY", "2016/11/02", "EVO"),
  up("Rising Rivals", "Platinum", "2009/05/16", "RR"),
  up("Battle Styles", "Sword & Shield", "2021/03/19", "BST"),
  up("HeartGold & SoulSilver", "HeartGold & SoulSilver", "2010/02/10", "HS"),
  up("Guardians Rising", "Sun & Moon", "2017/05/05", "GRI"),
  up("Evolving Skies", "Sword & Shield", "2021/08/27", "EVS"),
  up("Pokémon GO", "Sword & Shield", "2022/07/01", "PGO"),
  up("Brilliant Stars", "Sword & Shield", "2022/02/25", "BRS"),
  up("Brilliant Stars Trainer Gallery", "Sword & Shield", "2022/02/25", "BRS"),
  up("Mega Evolution", "Mega Evolution", "2025/09/26", "MEG"),
];
const idx = indexUpstream(UPSTREAM);
const resolve = (name: string, code: string | null, date: string | null) => resolveSetMeta(name, code, date, idx);

describe("normName", () => {
  it("folds accents so our spelling meets theirs", () => {
    expect(normName("Pokémon GO")).toBe(normName("Pokemon GO"));
  });
  it("spells the ampersand out so punctuation cannot split a match", () => {
    expect(normName("Scarlet & Violet")).toBe(normName("Scarlet and Violet"));
    expect(normName("HeartGold & SoulSilver")).toBe("heartgoldandsoulsilver");
  });
});

describe("stripEraPrefix", () => {
  it("removes the era token TCGplayer prepends", () => {
    expect(stripEraPrefix("SM - Guardians Rising")).toBe("Guardians Rising");
    expect(stripEraPrefix("SWSH07: Evolving Skies")).toBe("Evolving Skies");
    expect(stripEraPrefix("XY - Evolutions")).toBe("Evolutions");
  });
  it("leaves a name that has no prefix alone", () => {
    expect(stripEraPrefix("Guardians Rising")).toBe("Guardians Rising");
    expect(stripEraPrefix("Battle Academy")).toBe("Battle Academy");
  });
});

describe("nameVariants", () => {
  it("drops a trailing print-run qualifier and an upstream-absent \"Set\"", () => {
    expect(nameVariants("Base Set (Shadowless)")).toEqual(["Base Set", "Base"]);
  });
  it("offers nothing for a name that needs no variant", () => {
    expect(nameVariants("Jungle")).toEqual([]);
  });
  it("does not strip a parenthetical that is not at the end", () => {
    expect(nameVariants("EX Trainer Kit 1: Latias & Latios")).toEqual([]);
  });
});

describe("eraFromName", () => {
  it("reads the token even when a set NUMBER follows it", () => {
    // There is no word boundary between "E" and "0", so a plain \b would miss both of these.
    expect(eraFromName("ME06: Delta Reign")).toBe("Mega Evolution");
    expect(eraFromName("SWSH01: Sword & Shield Base Set")).toBe("Sword & Shield");
  });
  it("prefers the longer token, so MEE is not eaten by ME", () => {
    expect(eraFromName("MEE: Mega Evolution Energies")).toBe("Mega Evolution");
    expect(eraFromName("SVE: Scarlet & Violet Energies")).toBe("Scarlet & Violet");
  });
  it("reads the spelled-out era as well as the abbreviation", () => {
    expect(eraFromName("Diamond and Pearl Promos")).toBe("Diamond & Pearl");
    expect(eraFromName("Black and White Promos")).toBe("Black & White");
  });
  it("says nothing about a name that carries no era", () => {
    for (const n of ["Jumbo Cards", "Battle Academy", "Nintendo Promos", "e-Reader Sample Cards"]) {
      expect(eraFromName(n), n).toBeUndefined();
    }
  });
  it("does not fire on a word that merely starts with the letters", () => {
    expect(eraFromName("Example Set")).toBeUndefined();  // not EX
    expect(eraFromName("Smeargle Deck")).toBeUndefined(); // not SM
  });
});

describe("resolveSetMeta", () => {
  it("recovers a print run that no other tier can reach", () => {
    // "Base Set (Shadowless)" matched nothing and rendered under "Promos & products" — the most
    // recognisable set in the game. Its code BSS has no upstream counterpart either.
    const r = resolve("Base Set (Shadowless)", "BSS", "1999-01-09");
    expect([r.how, r.series]).toEqual(["variant", "Base"]);
    expect(r.upstream?.name).toBe("Base");
  });

  it("takes an exact name match first, with art", () => {
    const r = resolve("Base", "BS", "1999-01-09");
    expect([r.how, r.series, r.upstream?.name]).toEqual(["name", "Base", "Base"]);
  });

  it("strips the era prefix to reach the upstream set, keeping art", () => {
    const r = resolve("SM - Guardians Rising", "GRI", "2017-05-05");
    expect([r.how, r.series]).toEqual(["stripped", "Sun & Moon"]);
    expect(r.upstream?.name).toBe("Guardians Rising");
  });

  it("accepts a code match only when the release years corroborate it", () => {
    // Our "HS" and theirs agree on 2010 — a real match the names miss on punctuation alone.
    const good = resolve("HeartGold SoulSilver", "HS", "2010-02-10");
    expect([good.how, good.series]).toEqual(["code", "HeartGold & SoulSilver"]);
  });

  it("strips a SPACE-separated era token when the upstream series agrees", () => {
    // We say "EX Team Rocket Returns"; upstream says "Team Rocket Returns". The bare-word strip is
    // only allowed because the upstream series ("EX") matches the token we removed.
    const r = resolve("EX Team Rocket Returns", "RR", "2004-11-01");
    expect([r.how, r.series]).toEqual(["stripped", "EX"]);
    expect(r.upstream?.name).toBe("Team Rocket Returns");
  });

  it("will not strip a bare word whose upstream series disagrees with the token", () => {
    // "SM Base Set" must not become the 1999 "Base": the token says Sun & Moon, the candidate says
    // Base, and the disagreement is the signal that this is a different product entirely.
    const r = resolve("SM Base Set", "SM01", "2017-02-03");
    expect(r.series).toBe("Sun & Moon");
    expect(r.upstream).toBeUndefined();
  });

  it("REFUSES a code match five years out — this filed a 2004 set under Platinum", () => {
    // Code "RR" is Rising Rivals (2009) upstream. With no name to fall back on, the year guard is
    // all that stands between a 2004 product and the Platinum era.
    const r = resolve("EX Some Lost Product", "RR", "2004-11-01");
    expect(r.how).toBe("token");
    expect(r.series).toBe("EX");
    expect(r.upstream).toBeUndefined();
  });

  it("REFUSES a code match seventeen years out — this filed EX Battle Stadium under Sword & Shield", () => {
    const r = resolve("EX Battle Stadium", "BST", "2004-10-18");
    expect(r.series).toBe("EX");
    expect(r.how).toBe("token");
  });

  it("does not let the generic promo code drag every era into Base", () => {
    // "PR" is our code for 22 unrelated product groups; upstream it is Wizards Black Star Promos.
    const xy = resolve("XY Promos", "PR", "2013-12-16");
    expect([xy.how, xy.series]).toEqual(["token", "XY"]);
    const hgss = resolve("HGSS Promos", "PR", "2010-02-01");
    expect(hgss.series).toBe("HeartGold & SoulSilver");
    // But a promo set that really IS from that era still matches, because the years agree.
    const wotc = resolve("WoTC Promo", "PR", "1999-06-01");
    expect([wotc.how, wotc.series]).toEqual(["code", "Base"]);
  });

  it("rejects an ambiguous code rather than taking whichever came first", () => {
    // "BRS" is both Brilliant Stars and its Trainer Gallery upstream.
    const r = resolve("Some Unknown Product", "BRS", "2022-02-25");
    expect(r.how).toBe("none");
    expect(r.series).toBeNull();
  });

  it("fails the year guard rather than matching wrongly when our date is the ingest date", () => {
    // ~19 sets carry the ingest date instead of a real release; failing closed is the safe direction.
    const r = resolve("Alternate Art Promos", "PR", "2026-09-06");
    expect(r.series).toBeNull();
  });

  it("gives the token tier an era but NO art — we know the era, not the set", () => {
    const r = resolve("ME: 30th Celebration", "30C", "2026-09-16");
    expect([r.how, r.series, r.upstream]).toEqual(["token", "Mega Evolution", undefined]);
  });

  it("never invents a heading the upstream vocabulary does not have", () => {
    const narrow = indexUpstream([up("Base", "Base", "1999/01/09", "BS")]);
    // "XY Promos" yields the token "XY", but this upstream has no XY series, so it stays ungrouped.
    expect(resolveSetMeta("XY Promos", "PR", "2013-12-16", narrow).series).toBeNull();
  });

  it("leaves a cross-era product group with no era at all", () => {
    for (const n of ["Battle Academy", "Jumbo Cards", "World Championship Decks"]) {
      expect(resolve(n, "XXX", "2019-01-01").series, n).toBeNull();
    }
  });
});

describe("rankSeries", () => {
  it("orders eras by when each STARTED, so a late reprint cannot move one", () => {
    const rank = rankSeries(UPSTREAM);
    expect(rank.get("Base")).toBeLessThan(rank.get("EX")!);
    expect(rank.get("EX")).toBeLessThan(rank.get("Platinum")!);
    expect(rank.get("Sword & Shield")).toBeLessThan(rank.get("Mega Evolution")!);
  });
});
