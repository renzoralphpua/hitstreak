import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getSession } from "@/lib/session";
import { TopNav, BottomTabBar, CommandPalette } from "@/components/ui";
import UserMenu from "@/components/ui/UserMenu";
import ThemeToggle from "@/components/theme/ThemeToggle";
import { CurrencyProvider } from "@/components/currency/CurrencyProvider";
import CurrencyToggle from "@/components/currency/CurrencyToggle";
import { getDisplay, availableRates } from "@/lib/display";

/** The real (cryptographic) gate. proxy.ts only does an optimistic cookie check. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) {
    const path = (await headers()).get("x-pathname") ?? "/collections";
    redirect(`/sign-in?next=${encodeURIComponent(path)}`);
  }
  // Read once per request and seeded into the client context, so the first paint is already in the
  // reader's currency and the client's first render agrees with the HTML it hydrates.
  const [display, rates] = await Promise.all([getDisplay(), availableRates()]);

  return (
    <CurrencyProvider display={display}>
    <div className="flex min-h-dvh flex-col">
      <TopNav
        search={<CommandPalette />}
        right={
          <>
            <CurrencyToggle available={[...rates.keys()]} />
            <ThemeToggle />
            <UserMenu name={session.user.name} />
          </>
        }
      />
      {/* Width is a per-screen call, so `main` only pads. A screen you READ (card detail,
          alerts) wraps its content in `max-w-read`; a screen you SCAN (collection grid, sets)
          uses `max-w-scan`, which earns the extra columns an ultrawide gives it. */}
      <main className="mx-auto w-full max-w-scan grow px-6 py-6 md:px-10">{children}</main>
      <BottomTabBar />
    </div>
    </CurrencyProvider>
  );
}
