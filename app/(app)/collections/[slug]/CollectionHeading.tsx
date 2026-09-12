"use client";
import { useState } from "react";
import { SectionHeading } from "@/components/ui";
import CollectionForm from "../CollectionForm";

/**
 * The collection's name, renameable in place.
 *
 * Renaming lives here as well as in the grid's overflow menu because this is where you are when you
 * decide a binder is misnamed — going back to the list to fix it is a round trip for a five-character
 * edit. Clicking the name swaps it for the field; the back arrow stays put either way.
 */
export default function CollectionHeading({ id, name, caption }: { id: number; name: string; caption: string }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <div className="flex flex-col gap-2">
        <span className="text-caption text-dim">Rename this collection</span>
        <CollectionForm mode="rename" id={id} name={name} onDone={() => setEditing(false)} />
      </div>
    );
  }

  return (
    <SectionHeading
      as="h1"
      title={name}
      caption={caption}
      back={{ href: "/collections", label: "Collections" }}
      trailing={
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-caption text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          Rename
        </button>
      }
    />
  );
}
