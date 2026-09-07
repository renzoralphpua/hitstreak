"use client";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

/** Not exported from components/ui/index.ts on purpose: it pulls in auth-client. */
export default function UserMenu({ name }: { name: string }) {
  const router = useRouter();
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <button
      type="button"
      title={`${name} — sign out`}
      aria-label="Sign out"
      onClick={async () => {
        await authClient.signOut();
        router.push("/");
        router.refresh();
      }}
      className="flex h-9 w-9 items-center justify-center rounded-full bg-hairline text-sm font-semibold text-ink"
    >
      {initial}
    </button>
  );
}
