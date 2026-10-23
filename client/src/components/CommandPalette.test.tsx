/**
 * The search palette: pages for everybody, records too for the console.
 */

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin",
  useRouter: () => ({ replace: vi.fn(), push, refresh: vi.fn() }),
}));

import { CommandPalette, fuzzyScore, type PaletteItem } from "@/components/CommandPalette";

// jsdom lays nothing out, so it has no scrollIntoView for the cursor to call.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const PAGES: PaletteItem[] = [
  { href: "/admin/billing", label: "Billing", section: "Money", icon: "payments" },
  { href: "/admin/users", label: "People", section: "Hospital", icon: "group" },
];

describe("CommandPalette", () => {
  it("ranks a whole-word match above a scattered one", () => {
    expect(fuzzyScore("bill", "Billing")! > (fuzzyScore("bill", "Doctor balance list") ?? -1)).toBe(true);
    expect(fuzzyScore("zzz", "Billing")).toBeNull();
  });

  it("puts records from the server above the pages, and hands the pick over", async () => {
    const picked = vi.fn();
    const search = vi.fn(async (query: string) => [
      {
        href: "/admin/users",
        label: `Rabia ${query}`,
        detail: "Patient · rabia@example.com",
        section: "People",
        icon: "person",
        onPick: picked,
      },
    ]);
    const user = userEvent.setup();
    render(<CommandPalette open onClose={vi.fn()} items={PAGES} search={search} />);

    await user.type(screen.getByRole("combobox"), "pe");
    // The server is asked once typing pauses, not on every key.
    expect(await screen.findByText("Rabia pe", {}, { timeout: 2000 })).toBeInTheDocument();
    expect(search).toHaveBeenCalledTimes(1);

    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveTextContent("Rabia pe");
    expect(options[0]).toHaveTextContent("rabia@example.com");

    await user.keyboard("{Enter}");
    expect(picked).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/admin/users");
  });

  it("does not ask the server about a single letter", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const search = vi.fn(async () => []);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CommandPalette open onClose={vi.fn()} items={PAGES} search={search} />);

    await user.type(screen.getByRole("combobox"), "b");
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(search).not.toHaveBeenCalled();
    expect(screen.getByText("Billing")).toBeInTheDocument();
    vi.useRealTimers();
  });
});
