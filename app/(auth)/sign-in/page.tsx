import Link from "next/link";
import { redirect } from "next/navigation";
import AuthForm from "../AuthForm";
import { safeNext } from "../safe-next";
import { getSession } from "@/lib/session";

export const metadata = { title: "Sign in — Hitstreak" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const { next } = await searchParams;
  const session = await getSession();
  if (session) redirect(safeNext(next));
  const signUpHref = next ? `/sign-up?next=${encodeURIComponent(safeNext(next))}` : "/sign-up";
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-ground px-6 py-12">
      <span className="font-display text-3xl text-ink">Hitstreak</span>
      <h1 className="font-display text-2xl text-ink">Welcome back</h1>
      <AuthForm mode="sign-in" next={safeNext(next)} />
      <p className="text-[13px] text-muted">
        New here? <Link href={signUpHref}>Create an account</Link>
      </p>
    </div>
  );
}
