import Link from "next/link";
import { redirect } from "next/navigation";
import AuthForm from "../AuthForm";
import { safeNext } from "../safe-next";
import { getSession } from "@/lib/session";
import { isSignupGated } from "@/lib/signup-gate";

export const metadata = { title: "Create your account — Hitstreak" };

export default async function SignUpPage({ searchParams }: PageProps<"/sign-up">) {
  const { next } = await searchParams;
  const session = await getSession();
  if (session) redirect(safeNext(next));
  const signInHref = next ? `/sign-in?next=${encodeURIComponent(safeNext(next))}` : "/sign-in";
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-ground px-6 py-12">
      <span className="font-display text-section text-ink">Hitstreak</span>
      <h1 className="font-display text-title text-ink">Create your account</h1>
      {isSignupGated() && <p className="text-caption text-muted">Sign-ups are invite-only right now.</p>}
      <AuthForm mode="sign-up" next={safeNext(next)} />
      <p className="text-caption text-muted">
        Already have an account? <Link href={signInHref}>Sign in</Link>
      </p>
    </div>
  );
}
