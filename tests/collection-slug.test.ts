// Readable collection URLs. Unlike a set slug this one is REGENERATED on rename — a collection is
// private, so the only link that can go stale is the owner's own, and the URL should follow the
// name the binder has now.
import { describe, it, expect, afterAll } from "vitest";
import { tmpDb } from "./helpers/tmpdb";
const tmp = tmpDb("collection-slug");
import { closeDb } from "@/lib/db";
import {
  createCollection, renameCollection, deleteCollection,
  resolveCollectionRef, resolveCollectionSlug,
} from "@/lib/collections";

const U1 = "user_1", U2 = "user_2";
afterAll(() => { closeDb(); tmp.clean(); });

describe("collection slugs", () => {
  it("slugs the name on create", async () => {
    const c = await createCollection(U1, "Main Binder");
    expect(c.slug).toBe("main-binder");
    expect(await resolveCollectionSlug(U1, "main-binder")).toBe(c.id);
  });

  it("scopes uniqueness to the owner — two users may both have a Main Binder", async () => {
    const mine = await resolveCollectionSlug(U1, "main-binder");
    const theirs = await createCollection(U2, "Main Binder");
    expect(theirs.slug).toBe("main-binder");
    expect(theirs.id).not.toBe(mine);
  });

  it("suffixes rather than collides when ONE user repeats a name", async () => {
    const second = await createCollection(U1, "Main Binder");
    expect(second.slug).toBe("main-binder-2");
    const third = await createCollection(U1, "main binder!!");
    expect(third.slug).toBe("main-binder-3");
  });

  it("gives a name that slugs to nothing a usable segment", async () => {
    expect((await createCollection(U1, "!!!")).slug).toBe("collection");
  });

  it("follows a rename, and frees the segment it left behind", async () => {
    const c = await createCollection(U1, "Slabs");
    expect(await renameCollection(U1, c.id, "Graded Cards")).toBe(true);
    expect(await resolveCollectionSlug(U1, "graded-cards")).toBe(c.id);
    expect(await resolveCollectionSlug(U1, "slabs")).toBeNull();
    // Renaming to the name it already has must not suffix itself out of its own slug.
    await renameCollection(U1, c.id, "Graded Cards");
    expect(await resolveCollectionSlug(U1, "graded-cards")).toBe(c.id);
  });

  it("never resolves another user's slug", async () => {
    const theirs = await createCollection(U2, "Their Secret");
    expect(await resolveCollectionSlug(U1, "their-secret")).toBeNull();
    expect(await resolveCollectionRef(U1, "their-secret")).toBeNull();
    // Not even by id: "not yours" and "no such thing" must look identical.
    expect(await resolveCollectionRef(U1, String(theirs.id))).toBeNull();
  });

  it("resolves a bare id too, because every link used one before slugs existed", async () => {
    const c = await createCollection(U1, "Legacy Link");
    expect((await resolveCollectionRef(U1, String(c.id)))?.id).toBe(c.id);
    expect((await resolveCollectionRef(U1, "legacy-link"))?.id).toBe(c.id);
  });

  it("treats a missing or nonsense reference as not found", async () => {
    for (const ref of [null, "", "0", "-1", "nope", String(Number.MAX_SAFE_INTEGER)]) {
      expect(await resolveCollectionRef(U1, ref), String(ref)).toBeNull();
    }
  });

  it("lets a deleted collection's slug be claimed again", async () => {
    const c = await createCollection(U1, "Temporary");
    expect(await deleteCollection(U1, c.id)).toBe(true);
    expect((await createCollection(U1, "Temporary")).slug).toBe("temporary");
  });
});
