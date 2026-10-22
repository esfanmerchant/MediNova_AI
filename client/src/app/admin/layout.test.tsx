/**
 * What `/admin` shows, by who is looking.
 *
 * Signed out, the console's sign-in — and none of the console, because its
 * pages fetch as they render and must not do so before there is a session.
 * An administrator gets the page. Anybody else is sent to their own portal.
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import AdminLayout from "@/app/admin/layout";
import type { AuthUser, Role } from "@/lib/api";
import * as session from "@/lib/session";

function as(role: Role | null) {
  const user: AuthUser | null = role && {
    id: "u1",
    name: "Test User",
    email: "test@example.com",
    role,
    phone: null,
    status: "ACTIVE",
    permissions: [],
    patientId: role === "PATIENT" ? "p1" : null,
    doctorId: role === "DOCTOR" ? "d1" : null,
    avatarUrl: null,
  };
  vi.spyOn(session, "useSession").mockReturnValue({
    user,
    loading: false,
    signIn: vi.fn(),
  } as unknown as ReturnType<typeof session.useSession>);
}

const page = <p>the console</p>;

describe("/admin", () => {
  beforeEach(() => replace.mockClear());

  it("asks a visitor who is not signed in to sign in, and shows none of the console", () => {
    as(null);
    render(<AdminLayout>{page}</AdminLayout>);

    expect(screen.getByRole("heading", { name: "Administrator sign-in" })).toBeInTheDocument();
    expect(screen.queryByText("the console")).toBeNull();
  });

  it("opens the console for an administrator", () => {
    as("ADMIN");
    render(<AdminLayout>{page}</AdminLayout>);

    expect(screen.getByText("the console")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("takes anybody else to their own portal", () => {
    as("PATIENT");
    render(<AdminLayout>{page}</AdminLayout>);

    expect(screen.queryByText("the console")).toBeNull();
    expect(replace).toHaveBeenCalledWith("/patient");
  });
});
