/**
 * The overview's to-do list.
 *
 * "Needs you" is worst first, and break-glass review is always the worst: the
 * post-hoc review is what makes emergency override safe to offer at all
 * (conflict C1), so an unreviewed grant must never sit below an unpaid bill.
 */

import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import AdminDashboard from "@/app/admin/page";
import * as api from "@/lib/api";
import * as session from "@/lib/session";

function signedInAsAdmin() {
  vi.spyOn(session, "useSession").mockReturnValue({
    user: {
      id: "u1",
      name: "Admin Khan",
      email: "admin@example.com",
      role: "ADMIN",
      phone: null,
      status: "ACTIVE",
      permissions: [],
      patientId: null,
      doctorId: null,
      avatarUrl: null,
    },
    loading: false,
    signOut: vi.fn(),
    showWarning: false,
    secondsRemaining: null,
    stayAlive: vi.fn(),
  } as unknown as ReturnType<typeof session.useSession>);
}

function dashboard(counts: Record<string, number>, owed = "0.00", pending = 0) {
  vi.spyOn(api.dashboard, "admin").mockResolvedValue({
    counts: { patients: 40, doctors: 6, appointmentsThisWeek: 30, ...counts },
    revenue: {
      handled: "1000.00",
      toDoctors: "800.00",
      platformFee: "150.00",
      tax: "0.00",
      lateFees: "0.00",
      earned: "150.00",
      invoices: 4,
      pharmacySales: "0.00",
      pharmacyOrders: 0,
      platformRevenue: "150.00",
      currency: "PKR",
      owedToDoctors: owed,
    } as Awaited<ReturnType<typeof api.dashboard.admin>>["revenue"],
    recentSecurityEvents: [],
    busiestDoctors: [],
  });
  vi.spyOn(api.doctorRequests, "list").mockResolvedValue({
    data: [],
    meta: { total: pending, limit: 1, offset: 0, hasMore: false, pending },
  });
  vi.spyOn(api.notifications, "list").mockResolvedValue({
    data: [],
    meta: { total: 0, limit: 30, offset: 0, hasMore: false, unread: 0 },
  });
  // The overview's other panels, empty: what is under test is the to-do list.
  vi.spyOn(api.revenue, "series").mockResolvedValue({ grain: "day", currency: "PKR", points: [], bySpeciality: [] });
  vi.spyOn(api.appointments, "list").mockResolvedValue({
    data: [],
    meta: { total: 0, limit: 100, offset: 0, hasMore: false },
  });
  vi.spyOn(api.pharmacy, "dashboard").mockRejectedValue(new Error("offline"));
  // The setup checklist's reads: refused here, which it treats as "not done".
  vi.spyOn(api.billingSettings, "read").mockRejectedValue(new Error("offline"));
  vi.spyOn(api.pharmacy, "products").mockRejectedValue(new Error("offline"));
  vi.spyOn(api.pharmacy, "settings").mockRejectedValue(new Error("offline"));
  vi.spyOn(api.account, "twoFactor").mockRejectedValue(new Error("offline"));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Needs you", () => {
  it("puts an unreviewed emergency grant above everything else", async () => {
    signedInAsAdmin();
    dashboard({ unreviewedEmergencyGrants: 1, unpaidInvoices: 3 }, "2000.00", 2);
    render(<AdminDashboard />);

    const list = await screen.findByRole("region", { name: "Needs you" });
    const items = within(list).getAllByRole("link").map((link) => link.textContent ?? "");
    expect(items[0]).toMatch(/1 emergency access to review/);
    expect(items[1]).toMatch(/2 doctors waiting to be approved/);
    expect(items[2]).toMatch(/3 unpaid invoices/);
    expect(items[3]).toMatch(/Doctors are owed PKR 2,000/);

    // And the banner's one red button says the same thing first.
    expect(screen.getByRole("link", { name: /Review 1 emergency grant/ })).toHaveAttribute("href", "/admin/emergency");
  });

  it("says so when nothing is waiting", async () => {
    signedInAsAdmin();
    dashboard({ unreviewedEmergencyGrants: 0, unpaidInvoices: 0, failedLoginsThisWeek: 2 });
    render(<AdminDashboard />);

    expect(await screen.findByText("You're all caught up")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Review .* emergency/ })).toBeNull();
  });
});
