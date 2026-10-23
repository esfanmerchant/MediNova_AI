"use client";

/**
 * The banner's picture, made of today's data: one bar per hour of the clinic
 * day, in the colour of where its visits stand — seen, with a doctor now,
 * still to come — and a red line at the present.
 *
 * Hours come from the server's clinic-local `localTime`, so the bars sit at
 * the clinic's hours wherever the administrator is reading from.
 */

import type { Appointment } from "@/lib/api";
import { useTr } from "@/lib/lang";

const OPEN = 9;
const CLOSE = 21;

type Stage = "done" | "room" | "coming";

function stageOf(visit: Appointment): Stage | null {
  if (visit.status === "COMPLETED") return "done";
  if (visit.status === "CHECKED_IN" || visit.status === "IN_PROGRESS") return "room";
  if (visit.status === "REQUESTED" || visit.status === "CONFIRMED") return "coming";
  return null;
}

const FILL: Record<Stage, string> = {
  done: "bg-[#5EEAD4]",
  room: "bg-white",
  coming: "bg-white/[0.32]",
};

export function TodayByHour({ visits }: { visits: Appointment[] | null }) {
  const tr = useTr();
  const held = (visits ?? []).map((visit) => ({ visit, stage: stageOf(visit) })).filter((entry) => entry.stage);
  const hours = Array.from({ length: CLOSE - OPEN }, (_, index) => OPEN + index);
  const byHour = hours.map((hour) => {
    const here = held.filter(({ visit }) => Number(visit.localTime.slice(0, 2)) === hour);
    // An hour shows its most pressing stage: somebody in a room, then to come, then done.
    const stage: Stage | null = here.some((e) => e.stage === "room")
      ? "room"
      : here.some((e) => e.stage === "coming")
        ? "coming"
        : here.length
          ? "done"
          : null;
    return { hour, count: here.length, stage };
  });
  const peak = Math.max(1, ...byHour.map((h) => h.count));
  const count = (stage: Stage) => held.filter((e) => e.stage === stage).length;
  const now = new Date();
  const nowHour = now.getHours() + now.getMinutes() / 60;
  const nowAt = ((nowHour - OPEN) / (CLOSE - OPEN)) * 100;
  // The axis names the present: the tick nearest the red line reads "now".
  const ticks = [9, 12, 15, 18, 21];
  const nearest =
    nowAt >= 0 && nowAt <= 100
      ? ticks.reduce((best, tick) => (Math.abs(tick - nowHour) < Math.abs(best - nowHour) ? tick : best))
      : null;

  return (
    <div className="flex flex-col gap-3 rounded-[20px] border border-white/10 bg-[#061230]/[0.42] p-[18px]">
      <div className="flex flex-wrap items-baseline gap-2.5">
        <span className="text-[12.5px] text-[#B9C7DD]">{tr("Visits today, by hour", "Aaj ki visits, ghante ke hisaab se")}</span>
        <span className="ml-auto font-display text-[22px] font-bold text-white">
          {visits ? tr(`${held.length} booked`, `${held.length} booked`) : "—"}
        </span>
      </div>
      <div
        role="img"
        aria-label={tr(
          `Visits today by hour: ${count("done")} done, ${count("room")} with a doctor now, ${count("coming")} still to come.`,
          `Aaj ki visits: ${count("done")} mukammal, ${count("room")} abhi doctor ke paas, ${count("coming")} baqi.`,
        )}
        className="relative grid h-[92px] grid-cols-12 items-end gap-1.5 border-b border-white/[0.18]"
      >
        {byHour.map(({ hour, count: n, stage }, index) => (
          <span
            key={hour}
            className={`bar-grow block rounded-t-[5px] ${stage ? FILL[stage] : "bg-white/[0.08]"}`}
            style={{ height: n ? `${30 + (n / peak) * 64}%` : "6%", animationDelay: `${(index * 0.03).toFixed(2)}s` }}
          />
        ))}
        {nowAt >= 0 && nowAt <= 100 && (
          <span aria-hidden className="absolute -top-1.5 -bottom-1 w-0.5 rounded-full bg-[#FF8A93]" style={{ left: `${nowAt}%` }} />
        )}
      </div>
      <div aria-hidden className="flex justify-between font-mono text-[10.5px] text-[#8EA1C2]">
        {ticks.map((tick) => (
          <span key={tick}>{tick === nearest ? tr("now", "abhi") : String(tick).padStart(2, "0")}</span>
        ))}
      </div>
      <div className="flex flex-wrap gap-3.5 text-[12.5px] text-[#D7E3F7]">
        <span className="inline-flex items-center gap-[7px]">
          <span aria-hidden className="h-2.5 w-2.5 rounded-[3px] bg-[#5EEAD4]" />
          {tr(`${count("done")} done`, `${count("done")} mukammal`)}
        </span>
        <span className="inline-flex items-center gap-[7px]">
          <span aria-hidden className="h-2.5 w-2.5 rounded-[3px] bg-white" />
          {tr(`${count("room")} with a doctor`, `${count("room")} doctor ke paas`)}
        </span>
        <span className="inline-flex items-center gap-[7px]">
          <span aria-hidden className="h-2.5 w-2.5 rounded-[3px] bg-white/[0.32]" />
          {tr(`${count("coming")} to come`, `${count("coming")} baqi`)}
        </span>
      </div>
    </div>
  );
}
