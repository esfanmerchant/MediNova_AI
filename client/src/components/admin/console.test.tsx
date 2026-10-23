/**
 * The administration console's own pieces.
 *
 * Each test pins a decision that is easy to undo by accident: a chart that
 * quietly drops the days nothing was paid, a calendar that files an evening
 * visit under the wrong day, a temporary password shown "roughly".
 */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin",
  useRouter: () => ({ replace: vi.fn(), push, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { AppointmentWeek, localToday } from "@/components/admin/AppointmentWeek";
import { ClinicPulse } from "@/components/admin/ClinicPulse";
import { ConsoleTabBar } from "@/components/admin/ConsoleTabBar";
import { NewMenu } from "@/components/admin/NewMenu";
import { WeekBySpeciality } from "@/components/admin/OverviewSections";
import { OfflineBanner } from "@/components/OfflineBanner";
import { NeedsList, PastelTile } from "@/components/admin/console";
import { RevenueChart, RevenuePanel } from "@/components/admin/RevenueChart";
import { StaffAccountDialog } from "@/components/admin/StaffAccountDialog";
import * as api from "@/lib/api";

afterEach(() => {
  vi.restoreAllMocks();
  push.mockClear();
});

function visit(overrides: Partial<api.Appointment>): api.Appointment {
  const today = localToday();
  return {
    id: "a1",
    patientId: "p1",
    doctorId: "d1",
    status: "CONFIRMED",
    startTime: `${today}T05:00:00Z`,
    endTime: `${today}T05:30:00Z`,
    localDate: today,
    localTime: "10:00",
    durationMinutes: 30,
    reason: null,
    notes: null,
    mode: "CLINIC",
    doctorName: "Dr Sana Iqbal",
    specialization: "Paediatrics",
    patientName: "Bilal Khan",
    medicalRecordNumber: "MRN-1",
    cancelledAt: null,
    cancelReason: null,
    rescheduledFromId: null,
    completedAt: null,
    createdAt: `${today}T01:00:00Z`,
    ...overrides,
  };
}

function listOf(rows: api.Appointment[]) {
  return vi.spyOn(api.appointments, "list").mockResolvedValue({
    data: rows,
    meta: { total: rows.length, limit: 100, offset: 0, hasMore: false },
  });
}

function point(daysAgo: number, handled: string, pharmacy = "0"): api.RevenuePoint {
  const now = new Date();
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo));
  return {
    period: day.toISOString(),
    handled,
    platformFee: "0",
    tax: "0",
    toDoctors: "0",
    pharmacy,
    invoices: 1,
  };
}

describe("RevenueChart", () => {
  it("keeps a slot for every day in the window, paid or not", () => {
    // Three paid days out of thirty. Drawing three bars would squeeze the
    // month into three days and lie about its shape.
    render(<RevenueChart grain="day" currency="PKR" points={[point(0, "500"), point(3, "1200", "200"), point(20, "800")]} />);

    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(30);
    expect(rows.filter((row) => row.textContent?.endsWith("0"))).not.toHaveLength(0);
    expect(screen.getAllByRole("button")).toHaveLength(30);
  });

  it("splits each period by whose money it was", () => {
    render(<RevenueChart grain="day" currency="PKR" points={[point(2, "2400", "600")]} />);

    // Consultations are what is left once medicine is taken out.
    const row = within(screen.getByRole("table")).getAllByRole("row").at(-3)!;
    expect(row).toHaveTextContent("1,800");
    expect(row).toHaveTextContent("600");
    expect(row).toHaveTextContent("2,400");
  });

  it("leaves the partial oldest day off the chart and out of the total", () => {
    // The server's thirty days reach into a thirty-first; that day is not drawn.
    render(
      <RevenuePanel grain="day" currency="PKR" points={[point(1, "900"), point(30, "5000")]} loading={false} error={null} onRetry={() => {}} />,
    );
    expect(screen.getAllByText("PKR 900")).not.toHaveLength(0);
    expect(screen.queryByText("PKR 5,900")).not.toBeInTheDocument();
  });

  it("names the best day on the overview's panel", () => {
    render(
      <RevenuePanel grain="day" currency="PKR" points={[point(1, "900"), point(2, "2400", "600")]} loading={false} error={null} onRetry={() => {}} />,
    );
    expect(screen.getByText(/best day/)).toBeInTheDocument();
    expect(screen.getByText("PKR 2,400")).toBeInTheDocument();
  });

  it("says so when nothing was paid at all", () => {
    render(<RevenueChart grain="week" currency="PKR" points={[]} />);
    expect(screen.getByText(/Nothing has been paid in this period yet/)).toBeInTheDocument();
  });
});

describe("AppointmentWeek", () => {
  it("files a visit under the clinic's date, not the browser's reading of its time", async () => {
    // 21:00 UTC is 02:00 the next morning in Karachi. The server says which
    // day that is in `localDate`; the week must believe it.
    const today = localToday();
    vi.spyOn(api.appointments, "list").mockResolvedValue({
      data: [
        {
          id: "a1",
          patientId: "p1",
          doctorId: "d1",
          status: "CONFIRMED",
          startTime: `${today}T21:00:00Z`,
          endTime: `${today}T21:30:00Z`,
          localDate: today,
          localTime: "02:00",
          durationMinutes: 30,
          reason: null,
          notes: null,
          mode: "CLINIC",
          doctorName: "Dr Sana Iqbal",
          specialization: "Paediatrics",
          patientName: "Bilal Khan",
          medicalRecordNumber: "MRN-1",
          cancelledAt: null,
          cancelReason: null,
          rescheduledFromId: null,
          completedAt: null,
          createdAt: `${today}T08:00:00Z`,
        },
      ],
      meta: { total: 1, limit: 100, offset: 0, hasMore: false },
    });
    render(<AppointmentWeek onPickDay={vi.fn()} />);

    const day = new Date(`${today}T00:00:00Z`).toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: "UTC",
    });
    const column = await screen.findByRole("listitem", { name: day });
    expect(within(column).getByText("Bilal Khan")).toBeInTheDocument();
  });
});

describe("ConsoleTabBar", () => {
  it("lights the section a page belongs to, and More for the rest", async () => {
    const onMore = vi.fn();
    const { rerender } = render(
      <ConsoleTabBar pathname="/admin/billing" pendingApplications={0} onMore={onMore} moreOpen={false} />,
    );
    expect(screen.getByRole("link", { name: /Money/ })).toHaveAttribute("aria-current", "page");

    rerender(<ConsoleTabBar pathname="/admin/audit" pendingApplications={2} onMore={onMore} moreOpen={false} />);
    expect(screen.queryByRole("link", { current: "page" })).toBeNull();
    expect(screen.getByText("2")).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: /More/ }));
    expect(onMore).toHaveBeenCalled();
  });
});

describe("StaffAccountDialog", () => {
  it("offers nurses and administrators, never doctors", () => {
    render(<StaffAccountDialog open onClose={vi.fn()} onCreated={vi.fn()} />);
    expect(screen.getByRole("tab", { name: /Nurse/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Administrator/ })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Doctor/ })).toBeNull();
  });

  it("shows the generated password exactly as the server sent it", async () => {
    // Mixed case on purpose: a password retyped "close enough" is the usual
    // way a first sign-in fails.
    vi.spyOn(api.users, "create").mockResolvedValue({
      id: "u9",
      name: "Rubina Khan",
      email: "rubina@example.com",
      role: "NURSE",
      phone: null,
      status: "ACTIVE",
      lastLoginAt: null,
      createdAt: "2026-10-23T00:00:00Z",
      doctorId: null,
      patientId: null,
      temporaryPassword: "MsAbC9xYz09",
    });
    const user = userEvent.setup();
    render(<StaffAccountDialog open onClose={vi.fn()} onCreated={vi.fn()} />);

    await user.type(screen.getByLabelText("Full name"), "Rubina Khan");
    await user.type(screen.getByLabelText(/^Email/), "rubina@example.com");
    await user.click(screen.getByRole("button", { name: "Make the account" }));

    expect(await screen.findByText("MsAbC9xYz09")).toBeInTheDocument();
    expect(api.users.create).toHaveBeenCalledWith({
      name: "Rubina Khan",
      email: "rubina@example.com",
      role: "NURSE",
      phone: undefined,
    });
  });
});

describe("NeedsList and PastelTile", () => {
  it("keeps the order it is given", () => {
    render(
      <NeedsList
        items={[
          { key: "a", href: "/admin/emergency", icon: "policy", title: "Review the grant", detail: "", tone: "critical" },
          { key: "b", href: "/admin/billing", icon: "receipt_long", title: "Unpaid invoices", detail: "", tone: "warning" },
        ]}
      />,
    );
    const links = screen.getAllByRole("link").map((link) => link.textContent);
    expect(links[0]).toContain("Review the grant");
    expect(links[1]).toContain("Unpaid invoices");
  });

  it("is a link only when it leads somewhere", () => {
    const { rerender } = render(<PastelTile pastel="mint" icon="payments" label="Sales today" value="PKR 0" />);
    expect(screen.queryByRole("link")).toBeNull();
    rerender(<PastelTile pastel="mint" icon="payments" label="Sales today" value="PKR 0" href="/admin/pharmacy" />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/admin/pharmacy");
  });
});

describe("ClinicPulse", () => {
  it("gives each doctor a lane and each visit its clinic time", async () => {
    listOf([
      visit({ id: "a1" }),
      visit({ id: "a2", localTime: "11:30", patientName: "Ayesha Noor" }),
      visit({ id: "a3", doctorId: "d2", doctorName: "Dr Hamza Qureshi", specialization: "Cardiology", mode: "ONLINE", patientName: "Zainab Ali" }),
    ]);
    const user = userEvent.setup();
    render(<ClinicPulse />);

    expect(await screen.findByText("Dr Sana Iqbal")).toBeInTheDocument();
    expect(screen.getByText("Dr Hamza Qureshi")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /11:30 · Ayesha Noor · Dr Sana Iqbal/ })).toBeInTheDocument();

    // Video only: the clinic visits and their doctor's lane step aside.
    await user.click(screen.getByRole("button", { name: "Video" }));
    expect(screen.queryByText("Dr Sana Iqbal")).toBeNull();
    expect(screen.getByRole("link", { name: /Zainab Ali/ })).toBeInTheDocument();
  });
});

describe("WeekBySpeciality", () => {
  it("counts the week's visits per speciality per day, cancellations left out", async () => {
    listOf([
      visit({ id: "a1" }),
      visit({ id: "a2" }),
      visit({ id: "a3", status: "CANCELLED" }),
      visit({ id: "a4", specialization: "Cardiology" }),
    ]);
    render(<WeekBySpeciality />);

    const row = await screen.findByRole("row", { name: /Paediatrics/ });
    expect(within(row).getByText("2")).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /Cardiology/ })).toHaveTextContent("1");
  });
});

describe("NewMenu shortcuts", () => {
  it("opens an action with N and its letter", () => {
    render(<NewMenu />);
    fireEvent.keyDown(window, { key: "n" });
    fireEvent.keyDown(window, { key: "m" });
    expect(push).toHaveBeenCalledWith("/admin/pharmacy/catalog?new=1");
  });

  it("ignores the keys while somebody is typing", () => {
    render(
      <>
        <input aria-label="Search" />
        <NewMenu />
      </>,
    );
    const field = screen.getByLabelText("Search");
    fireEvent.keyDown(field, { key: "n" });
    fireEvent.keyDown(field, { key: "m" });
    expect(push).not.toHaveBeenCalled();
  });
});

describe("OfflineBanner", () => {
  it("appears when the connection drops and goes when it returns", () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    render(<OfflineBanner />);
    expect(screen.queryByText(/You are offline/)).toBeNull();

    online.mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByText(/You are offline/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing can be saved/)).toBeInTheDocument();

    online.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByText(/You are offline/)).toBeNull();
  });
});
