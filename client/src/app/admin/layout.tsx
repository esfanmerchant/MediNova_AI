"use client";

/**
 * The administration console's front door.
 *
 * The public sign-in at `/login` offers no administrator option; an
 * administrator types `/admin`, and anybody who is not signed in finds the
 * console's own sign-in form here — on any address under it, so a link to a
 * page deep in the console asks for credentials and then opens that page.
 *
 * It is a layout rather than a redirect for a reason that matters: the pages
 * below fetch as they render. Shown before anybody had signed in, every one of
 * them asked the API for administrative data, was refused, and kept the empty
 * answer — so the console opened blank after a successful sign-in. Holding the
 * pages back until there is a session means they mount, and fetch, once.
 *
 * None of this is access control. The API refuses administrative requests from
 * any account that is not an administrator's, whichever page sent them; what
 * this decides is only what the browser shows.
 */

import { useRouter } from "next/navigation";
import { Suspense, useEffect, type ReactNode } from "react";

import { ConsoleAuthFrame } from "@/components/admin/ConsoleAuthFrame";
import { SignInForm } from "@/components/auth/SignInForm";
import { Loading } from "@/components/ui";
import { useTr } from "@/lib/lang";
import { homePathFor, useSession } from "@/lib/session";

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useSession();
  const router = useRouter();
  const tr = useTr();

  // A patient or a doctor has no console. They are taken to their own portal
  // rather than shown a page saying this one exists and is not theirs.
  const elsewhere = user && user.role !== "ADMIN" ? homePathFor(user.role) : null;
  useEffect(() => {
    if (elsewhere) router.replace(elsewhere);
  }, [elsewhere, router]);

  if (loading || elsewhere) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-16">
        <Loading label={tr("Checking your session", "Aap ka session check ho raha hai")} />
      </main>
    );
  }

  if (!user) {
    return (
      <ConsoleAuthFrame>
        <Suspense fallback={<Loading />}>
          <SignInForm portal="admin" />
        </Suspense>
      </ConsoleAuthFrame>
    );
  }

  return <>{children}</>;
}
