import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { listCollections, getCollectionSummary } from "@/lib/collections";
import { getShareLink } from "@/lib/share";
import { SectionHeading, EmptyState } from "@/components/ui";
import CollectionForm from "./CollectionForm";
import CollectionTile from "./CollectionTile";

export const metadata = { title: "Collections — Hitstreak" };
// Per-user data valued from latest_prices: never prerender or cache across users.
export const dynamic = "force-dynamic";

export default async function CollectionsPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in"); // the layout already gates; this is for the user id
  const userId = session.user.id;

  const collections = await listCollections(userId);
  // One round of queries per collection, in parallel. A person has a handful of these, not a page of
  // them — if that stops being true, this is the spot to batch.
  const rows = await Promise.all(
    collections.map(async (collection) => ({
      collection,
      summary: await getCollectionSummary(userId, collection.id),
      shareLink: await getShareLink(userId, collection.id),
    }))
  );
  const n = collections.length;

  return (
    <div className="flex flex-col gap-5">
      <SectionHeading
        as="h1"
        title="Your collections"
        caption={`${n} collection${n === 1 ? "" : "s"}`}
        trailing={<CollectionForm mode="create" variant="button" />}
      />

      {n === 0 ? (
        <EmptyState
          title="No collections yet"
          body="Create one to start tracking the cards you own."
          action={<CollectionForm mode="create" />}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rows.map((r) => (
            <CollectionTile key={r.collection.id} {...r} />
          ))}
        </div>
      )}
    </div>
  );
}
