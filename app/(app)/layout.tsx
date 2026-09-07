import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getSession } from "@/lib/session";
import { TopNav, BottomTabBar } from "@/components/ui";
import UserMenu from "@/components/ui/UserMenu";
import ThemeToggle from "@/components/theme/ThemeToggle";

/** The real (cryptographic) gate. proxy.ts only does an optimistic cookie check. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) {
    const path = (await headers()).get("x-pathname") ?? "/portfolios";
    redirect(`/sign-in?next=${encodeURIComponent(path)}`);
  }
  return (
    <div className="flex min-h-dvh flex-col">
      <TopNav
        right={
          <>
            <ThemeToggle />
            <UserMenu name={session.user.name} />
          </>
        }
      />
      <main className="grow px-6 py-6 md:px-10">{children}</main>
      <BottomTabBar />
    </div>
  );
}
