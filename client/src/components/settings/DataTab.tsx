"use client";

/**
 * Taking your record with you.
 *
 * A portal that shows a person their history but never lets them leave with it
 * has quietly made the hospital the owner of that history. This is the screen
 * that says otherwise — and it is deliberately plain, because the whole point
 * is that exercising the right takes one press and no explanation to anybody.
 *
 * **Nothing is fetched until it is asked for.** The export is the heaviest read
 * in the patient portal; loading it on mount would make opening *settings* cost
 * a full history, for the large majority of visits that came here to change a
 * password.
 *
 * Two forms, because they answer different questions. The file is the complete
 * record, machine-readable, for another system to import. The printable summary
 * is for a human being in a consulting room — a doctor outside this platform who
 * needs to know what you are taking, not a JSON parser.
 */

import Link from "next/link";
import { useState } from "react";

import { Icon } from "@/components/Icon";
import { useToast } from "@/components/overlays";
import { Button, Card } from "@/components/ui";
import { ApiError, patients } from "@/lib/api";
import { useTr } from "@/lib/lang";
import { buildRecordPdf, recordFileName } from "@/lib/recordPdf";

/** What the bundle holds, in the order a person would look for it. */
const CONTENTS: Array<[string, string, string]> = [
  ["clinical_notes", "Consultation notes", "Consultation ke notes"],
  ["prescriptions", "Prescriptions and the times you set", "Nuskhe aur aap ke muqarrar auqaat"],
  ["event", "Appointments, past and upcoming", "Appointments, guzri hui aur aane wali"],
  ["monitor_heart", "Vital-sign readings", "Vitals ki readings"],
  ["description", "Documents you uploaded, by name", "Aap ke upload kiye documents, naam se"],
  ["receipt_long", "Invoices and what was paid", "Invoices aur kya ada hua"],
];

/** Hand the browser a file to save, and let go of the object URL. */
function save(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function DataTab() {
  const tr = useTr();
  const toast = useToast();
  const [busy, setBusy] = useState<"pdf" | "json" | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Two formats, and the PDF is the one on the main button.
   *
   * A PDF is what a person means by "my record": it opens on any device, prints,
   * and a doctor outside this platform can read it in a consulting room. The
   * JSON is for another *system* to import — complete, machine-readable, and
   * useless to a human being. Offering the JSON first was the wrong way round.
   */
  const download = async (format: "pdf" | "json") => {
    setBusy(format);
    setError(null);
    try {
      const bundle = await patients.exportRecord();
      const mrn = bundle.patient?.medicalRecordNumber;

      if (format === "pdf") {
        save(await buildRecordPdf(bundle), recordFileName(mrn));
      } else {
        // Two spaces: this is a file people open and read, not one a machine
        // parses in bulk, and the difference in size does not matter here.
        save(
          new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }),
          `medinova-record-${mrn ?? "export"}-${new Date().toISOString().slice(0, 10)}.json`,
        );
      }

      const total = Object.values(bundle.counts ?? {}).reduce((sum, n) => sum + n, 0);
      toast.show({
        tone: "success",
        title: tr("Your record has been saved", "Aap ka record save hogaya"),
        body: tr(`${total} entries in one file.`, `Ek file mein ${total} entries.`),
      });
    } catch (cause) {
      // Shown in the card, not only as a toast: a failed export is something
      // the person came here to do and will want to try again from this spot.
      setError(
        cause instanceof ApiError
          ? cause.message
          : tr("Could not build your export. Try again.", "Export nahi ban saka. Dobara koshish karein."),
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <Card
        icon="download"
        title={tr("Take your record with you", "Apna record saath le jayein")}
        description={tr(
          "Your history belongs to you. Save a copy whenever you want one — you do not need to ask anybody.",
          "Aap ki history aap ki hai. Jab chahein copy save karein — kisi se poochne ki zaroorat nahi.",
        )}
      >
        <ul className="grid gap-3 sm:grid-cols-2">
          {CONTENTS.map(([icon, en, ur]) => (
            <li key={icon} className="flex items-start gap-3 text-sm text-muted">
              <span
                aria-hidden
                className="bg-gradient-soft mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-primary"
              >
                <Icon name={icon} className="text-[18px]" />
              </span>
              <span className="min-w-0 pt-1">{tr(en, ur)}</span>
            </li>
          ))}
        </ul>

        {error && (
          <p role="alert" className="mt-5 text-sm font-medium text-critical">
            {error}
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button onClick={() => void download("pdf")} loading={busy === "pdf"} disabled={busy !== null}>
            <Icon name="download" className="text-[20px]" />
            {tr("Download my record (PDF)", "Mera record download karein (PDF)")}
          </Button>
          {/* A link, not a button, because it goes somewhere — middle-click and
              "open in new tab" should both work. */}
          <Link
            href="/patient/export"
            className="btn-outline inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-base font-semibold transition-transform duration-200 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <Icon name="print" className="text-[20px]" />
            {tr("View and print", "Dekhein aur print karein")}
          </Link>
        </div>

        {/* Quieter, and last. The JSON is complete and machine-readable, which
            is exactly why almost nobody wants it — it is for handing to another
            system, not to a person. Offering it beside the PDF at equal weight
            would make the common case a choice nobody has the context to make. */}
        <button
          type="button"
          onClick={() => void download("json")}
          disabled={busy !== null}
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted underline-offset-4 hover:text-primary hover:underline disabled:opacity-60"
        >
          <Icon name="code" className="text-[16px]" />
          {busy === "json"
            ? tr("Preparing…", "Tayyar ho raha hai…")
            : tr(
                "Or download the raw data (JSON), for another system",
                "Ya raw data (JSON) lein, kisi doosre system ke liye",
              )}
        </button>

        <p className="mt-5 text-sm text-muted">
          {tr(
            "The file lists your uploaded scans by name and size — the images themselves stay in Documents, where each one is a separate download.",
            "File mein aap ke scans naam aur size se darj hain — tasveerein khud Documents mein rehti hain, jahan har ek alag download hoti hai.",
          )}
        </p>
      </Card>

      <Card
        icon="lock"
        title={tr("Who else can see this", "Aur kaun dekh sakta hai")}
        description={tr(
          "An export is recorded, like every other time your record is opened.",
          "Har export record hota hai, waise hi jaise aap ka record har baar khulne par hota hai.",
        )}
      >
        <p className="text-sm text-muted">
          {tr(
            "Only you can export your own record — there is no version of this for staff or administrators. Each export is written to the audit log with the date and how many entries left, but never with what they said. Once the file is on your device it is yours, and nothing here can reach it.",
            "Sirf aap apna record export karsakte hain — staff ya admin ke liye iska koi version nahi hai. Har export audit log mein tareekh aur entries ki tadaad ke saath likha jata hai, lekin un mein kya likha tha wo kabhi nahi. File aap ke device par aane ke baad wo aap ki hai, aur yahan se koi us tak nahi pohanch sakta.",
          )}
        </p>
      </Card>
    </div>
  );
}
