"use client";

/**
 * Sign in, for patients and doctors.
 *
 * Administrators are not offered a tab here: the console has its own sign-in
 * at `/admin`, reached by typing the address. The form itself is shared — see
 * `components/auth/SignInForm.tsx` for why the role tabs are copy rather than
 * data, and for every state a refused sign-in can land in.
 */

import { Suspense } from "react";

import { AuthPanel } from "@/components/AuthPanel";
import { SignInForm } from "@/components/auth/SignInForm";
import { Loading } from "@/components/ui";

export default function LoginPage() {
  return (
    <AuthPanel>
      <Suspense fallback={<Loading />}>
        <SignInForm portal="public" />
      </Suspense>
    </AuthPanel>
  );
}
