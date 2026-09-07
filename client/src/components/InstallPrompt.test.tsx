/**
 * Offering to install the app.
 *
 * The thing worth pinning down is *when it appears*, because both mistakes are
 * invisible in ordinary use. Never appearing is what was already happening — a
 * fully installable app that nobody could tell was installable. Appearing too
 * eagerly is worse: a bar over the login form of an app somebody already
 * installed, or one they have already refused, on every visit.
 *
 * The Chromium event is fired by hand here. It cannot be triggered any other
 * way in a test, and waiting for a real browser to decide a site is installable
 * would make this a test of Chrome's heuristics rather than of this component.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InstallPrompt } from "@/components/InstallPrompt";

const DISMISSED = "medinova:install-dismissed";

/**
 * A real one, because this environment does not have one.
 *
 * Under this Node/jsdom combination the global `localStorage` is Node's own
 * experimental shim, whose methods throw without a backing file — see
 * `vitest.setup.ts`. The component survives that by design (every access is
 * wrapped, and a browser that refuses storage should still be offered the
 * install). But "remembers a refusal" cannot be tested against storage that
 * remembers nothing, so these tests supply one that works.
 */
const stored = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => void stored.set(k, String(v)),
    removeItem: (k: string) => void stored.delete(k),
    clear: () => stored.clear(),
  },
});

/** Chromium's event, with the two things the component uses. */
function offerInstall(outcome: "accepted" | "dismissed" = "accepted") {
  const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
    prompt: vi.fn().mockResolvedValue(undefined),
    userChoice: Promise.resolve({ outcome }),
  });
  window.dispatchEvent(event);
  return event;
}

function setEnvironment({ standalone = false, ios = false } = {}) {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: query.includes("display-mode: standalone") ? standalone : false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }) as unknown as MediaQueryList,
  );
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
    ios ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" : "Mozilla/5.0 (Linux; Android 13)",
  );
}

beforeEach(() => {
  localStorage.clear();
  setEnvironment();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function installButton() {
  return screen.queryByRole("button", { name: /^install$/i });
}

describe("when the browser has said nothing", () => {
  it("shows nothing at all", () => {
    render(<InstallPrompt />);
    // Chrome only fires the event on a site it considers installable. Offering
    // before then would be offering something the browser may refuse to do.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("when the browser offers an install", () => {
  it("brings out the offer", async () => {
    render(<InstallPrompt />);
    offerInstall();
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(installButton()).toBeInTheDocument();
  });

  it("asks the browser to install when pressed", async () => {
    render(<InstallPrompt />);
    const event = offerInstall();
    await screen.findByRole("dialog");

    await userEvent.click(installButton()!);
    // The whole point: the button must reach the browser's own install flow,
    // not merely close a bar and look like it worked.
    expect(event.prompt).toHaveBeenCalledOnce();
  });

  it("does not ask again after the offer is accepted", async () => {
    render(<InstallPrompt />);
    offerInstall("accepted");
    await screen.findByRole("dialog");

    await userEvent.click(installButton()!);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // Accepting is not remembered as a refusal — `appinstalled` covers the
    // installed case, and a cancelled system dialog must not become a permanent no.
    expect(localStorage.getItem(DISMISSED)).toBeNull();
  });

  it("remembers a refusal", async () => {
    render(<InstallPrompt />);
    offerInstall();
    await screen.findByRole("dialog");

    await userEvent.click(screen.getByRole("button", { name: /not now/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(localStorage.getItem(DISMISSED)).toBe("1");
  });

  it("stays away on a later visit once refused", async () => {
    localStorage.setItem(DISMISSED, "1");
    render(<InstallPrompt />);
    offerInstall();
    // A person who said no is not asked again on every page load. That is the
    // difference between an offer and nagging.
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("goes away when the app is installed by any other route", async () => {
    render(<InstallPrompt />);
    offerInstall();
    await screen.findByRole("dialog");

    // The browser's own menu also installs, and fires this.
    window.dispatchEvent(new Event("appinstalled"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("when it is already installed", () => {
  it("never offers", async () => {
    setEnvironment({ standalone: true });
    render(<InstallPrompt />);
    offerInstall();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("on iOS", () => {
  it("shows the instruction without waiting for an event", async () => {
    setEnvironment({ ios: true });
    render(<InstallPrompt />);
    // Safari never fires `beforeinstallprompt`, so a component that waited for
    // one would offer nothing on the platform where the manual route is the
    // only route.
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/add to home screen/i)).toBeInTheDocument();
  });

  it("offers no install button, because there is nothing to press", async () => {
    setEnvironment({ ios: true });
    render(<InstallPrompt />);
    await screen.findByRole("dialog");
    // A button that cannot install is worse than no button: it is a promise
    // the platform will not keep.
    expect(installButton()).not.toBeInTheDocument();
  });
});
