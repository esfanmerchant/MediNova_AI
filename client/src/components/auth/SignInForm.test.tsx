/**
 * The two sign-in doors.
 *
 * `/login` is for patients and doctors and says so; the administration
 * console's sign-in lives at `/admin` and is not advertised anywhere on the
 * public one. What is asserted is what each door *shows* — the server decides
 * what an account is, whichever form it came through.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { SignInForm } from "@/components/auth/SignInForm";
import * as session from "@/lib/session";

function signedOut() {
  vi.spyOn(session, "useSession").mockReturnValue({
    user: null,
    loading: false,
    signIn: vi.fn(),
  } as unknown as ReturnType<typeof session.useSession>);
}

describe("the public sign-in", () => {
  it("offers patients and doctors, and no administrator option", () => {
    signedOut();
    render(<SignInForm portal="public" />);

    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getByRole("tab", { name: /Patient/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Doctor/ })).toBeInTheDocument();
    expect(screen.queryByText(/admin/i)).toBeNull();
    expect(screen.getByRole("link", { name: "Create an account" })).toBeInTheDocument();
  });
});

describe("the console's sign-in", () => {
  it("asks for an email and a password, with no role tabs and no registration", () => {
    signedOut();
    render(<SignInForm portal="admin" />);

    expect(screen.getByRole("heading", { name: "Administrator sign-in" })).toBeInTheDocument();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.getByLabelText("Work email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Create an account" })).toBeNull();
    // Somebody who is not an administrator is pointed to their own door.
    expect(screen.getByRole("link", { name: "the main site" })).toHaveAttribute("href", "/login");
  });
});
