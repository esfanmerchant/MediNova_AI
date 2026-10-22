"use client";

/**
 * Mounted fresh on every navigation between top-level sections, which is
 * exactly what makes it the page transition for the public pages: the
 * entrance replays because the node is new.
 *
 * 350ms and a 16px rise — enough that moving between screens feels placed
 * rather than swapped, not enough to make a clinician wait for it. Around the
 * portal shell it stands down (see `.page-enter` in globals.css): the shell
 * animates the page inside it and keeps its own navigation still. The global
 * reduced-motion override collapses it to nothing.
 */
import type { ReactNode } from "react";

export default function Template({ children }: { children: ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
