/**
 * A patient's record as a PDF a person can actually read.
 *
 * The JSON export answers a machine's question — "import this into another
 * system". This answers a person's: a doctor in a consulting room, at two in the
 * morning, who needs to know what this patient is allergic to and what they are
 * taking before prescribing anything. So the order is clinical rather than
 * structural: allergies first and boxed, then current medicines, then what each
 * consultation concluded. Invoices and file listings come last, because nobody
 * reaching for this in a hurry wants them.
 *
 * **Drawn, not screenshotted.** Rendering the page to a canvas would produce a
 * picture of a document — no selectable text, no search, four times the size,
 * and blurry when printed. Every line here is real text in the PDF.
 *
 * **Loaded on demand.** jsPDF is large, and the overwhelming majority of visits
 * to the settings page never ask for a PDF. The import is inside the handler
 * that needs it, so the cost falls on the press rather than on the page.
 */

import type { PatientExport } from "@/lib/api";

const PAGE = { width: 595.28, height: 841.89 }; // A4 in points
const MARGIN = 46;
const CONTENT = PAGE.width - MARGIN * 2;

const INK = "#12233b";
const MUTED = "#5b6b82";
const NAVY = "#0b3fa8";
const TEAL = "#0b7f7c";
const CRITICAL = "#a81f26";
const RULE = "#d9e2ee";

function day(iso: string | null | undefined): string {
  if (!iso) return "—";
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime())
    ? "—"
    : parsed.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * Builds the document and hands back a Blob.
 *
 * Separate from the download so a caller can preview or attach it, and so this
 * whole module stays testable without touching the DOM.
 */
export async function buildRecordPdf(bundle: PatientExport): Promise<Blob> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  let y = MARGIN;

  /** Move down, starting a new page when the next block would not fit. */
  const need = (height: number) => {
    if (y + height > PAGE.height - MARGIN - 24) {
      doc.addPage();
      y = MARGIN;
    }
  };

  const heading = (text: string, count?: number) => {
    // Room for the heading *and* the start of what follows. Reserving only the
    // heading's own height leaves it stranded at the foot of a page with its
    // content overleaf, which reads as a section that has nothing in it.
    need(120);
    y += 14;
    doc.setFont("helvetica", "bold").setFontSize(12).setTextColor(INK);
    doc.text(count === undefined ? text : `${text}  (${count})`, MARGIN, y);
    y += 7;
    doc.setDrawColor(RULE).setLineWidth(1).line(MARGIN, y, PAGE.width - MARGIN, y);
    y += 14;
  };

  /** Wrapped body text. Returns nothing; advances `y`. */
  const paragraph = (text: string, options: { bold?: string; colour?: string } = {}) => {
    // The font has to be set to bold *before* the label is measured. Measuring
    // in whatever face happened to be current under-reports the width — bold is
    // wider — and the body text then starts on top of the label: "Plan:Metformin"
    // instead of "Plan: Metformin". It is only visible once rendered, which is
    // why this is a comment and not a lesson to relearn.
    let indent = 0;
    if (options.bold) {
      doc.setFont("helvetica", "bold").setFontSize(9.5).setTextColor(INK);
      indent = doc.getTextWidth(`${options.bold} `);
    }
    const lines = doc.splitTextToSize(text, CONTENT - indent) as string[];
    need(lines.length * 13 + 4);
    if (options.bold) {
      doc.setFont("helvetica", "bold").setFontSize(9.5).setTextColor(INK);
      doc.text(options.bold, MARGIN, y);
    }
    doc.setFont("helvetica", "normal").setFontSize(9.5).setTextColor(options.colour ?? MUTED);
    doc.text(lines, MARGIN + indent, y);
    y += lines.length * 13;
  };

  const table = (head: string[], body: (string | number)[][]) => {
    if (body.length === 0) return;
    // Enough room for the header and one row, or start the table on the next
    // page. A column header alone at the foot of a page, with its first row
    // overleaf, reads as a table that lost its contents.
    need(70);
    autoTable(doc, {
      startY: y,
      head: [head],
      body,
      margin: { left: MARGIN, right: MARGIN },
      styles: { font: "helvetica", fontSize: 8.5, cellPadding: 5, textColor: INK, lineColor: RULE },
      headStyles: { fillColor: [11, 63, 168], textColor: 255, fontStyle: "bold", fontSize: 8 },
      alternateRowStyles: { fillColor: [246, 249, 253] },
      theme: "grid",
    });
    // @ts-expect-error — autoTable stores the finished position on the document.
    y = (doc.lastAutoTable?.finalY ?? y) + 6;
  };

  // --- letterhead ---------------------------------------------------------
  doc.setFont("helvetica", "bold").setFontSize(18).setTextColor(NAVY);
  doc.text("MediNova", MARGIN, y + 4);
  doc.setTextColor(TEAL);
  doc.text(" AI", MARGIN + doc.getTextWidth("MediNova"), y + 4);

  doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(MUTED);
  doc.text(`Prepared ${day(bundle.exportedAt)}`, PAGE.width - MARGIN, y, { align: "right" });
  doc.text(bundle.source?.timezone ?? "", PAGE.width - MARGIN, y + 11, { align: "right" });

  y += 22;
  doc.setFont("helvetica", "bold").setFontSize(13).setTextColor(INK);
  doc.text("Patient record summary", MARGIN, y);
  y += 10;
  doc.setDrawColor(INK).setLineWidth(1.5).line(MARGIN, y, PAGE.width - MARGIN, y);
  y += 18;

  // --- who this is --------------------------------------------------------
  const p = bundle.patient;
  const facts: [string, string][] = [
    ["Name", p.name ?? "—"],
    ["Record number", p.medicalRecordNumber ?? "—"],
    ["Date of birth", day(p.dateOfBirth)],
    ["Blood group", p.bloodGroup || "—"],
    ["Phone", p.phone || "—"],
    ["CNIC", p.cnic || "—"],
  ];
  const columns = 3;
  const columnWidth = CONTENT / columns;
  facts.forEach(([label, value], index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = MARGIN + column * columnWidth;
    const top = y + row * 30;
    doc.setFont("helvetica", "bold").setFontSize(7).setTextColor(MUTED);
    doc.text(label.toUpperCase(), x, top);
    doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(INK);
    doc.text(doc.splitTextToSize(value, columnWidth - 8)[0], x, top + 12);
  });
  y += Math.ceil(facts.length / columns) * 30 + 6;

  // --- allergies, boxed ---------------------------------------------------
  // First and framed on purpose. If a reader takes one thing off this page
  // under pressure, this has to be it.
  const allergies = p.allergies || "None recorded";
  const conditions = p.chronicConditions || "None recorded";
  const boxLines = doc.splitTextToSize(`${allergies}`, CONTENT - 24) as string[];
  const conditionLines = doc.splitTextToSize(conditions, CONTENT - 24) as string[];
  const boxHeight = 34 + boxLines.length * 12 + 18 + conditionLines.length * 12;
  need(boxHeight);
  doc.setDrawColor(CRITICAL).setLineWidth(1.2);
  doc.setFillColor(253, 236, 237);
  doc.roundedRect(MARGIN, y, CONTENT, boxHeight, 5, 5, "FD");
  let boxY = y + 17;
  doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(CRITICAL);
  doc.text("ALLERGIES", MARGIN + 12, boxY);
  boxY += 13;
  doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(INK);
  doc.text(boxLines, MARGIN + 12, boxY);
  boxY += boxLines.length * 12 + 12;
  doc.setFont("helvetica", "bold").setFontSize(7).setTextColor(MUTED);
  doc.text("ONGOING CONDITIONS", MARGIN + 12, boxY);
  boxY += 11;
  doc.setFont("helvetica", "normal").setFontSize(9.5).setTextColor(INK);
  doc.text(conditionLines, MARGIN + 12, boxY);
  y += boxHeight;

  // --- current medicines --------------------------------------------------
  const active = (bundle.prescriptions ?? []).filter((rx) => rx.active);
  heading("Current medicines", active.length);
  if (active.length === 0) {
    paragraph("None active.");
  } else {
    table(
      ["Medicine", "Dose", "How often", "For", "Notes"],
      active.map((rx) => [
        rx.medication,
        rx.dosage,
        rx.frequency,
        rx.duration,
        rx.instructions || "—",
      ]),
    );
  }

  // --- consultations ------------------------------------------------------
  const records = bundle.medicalRecords ?? [];
  heading("Consultations", records.length);
  if (records.length === 0) {
    paragraph("None recorded.");
  } else {
    records.forEach((record) => {
      need(60);
      const who = [record.doctorName, record.specialization].filter(Boolean).join(" · ");
      doc.setFont("helvetica", "bold").setFontSize(9.5).setTextColor(INK);
      doc.text(`${day(record.createdAt)}${who ? `   ${who}` : ""}`, MARGIN, y);
      y += 13;
      if (record.diagnosis) paragraph(record.diagnosis, { bold: "Diagnosis:", colour: INK });
      if (record.symptoms) paragraph(record.symptoms, { bold: "Symptoms:" });
      if (record.treatmentPlan) paragraph(record.treatmentPlan, { bold: "Plan:" });
      if (record.followUpDate) {
        paragraph(
          `${day(record.followUpDate)}${record.followUpNotes ? ` — ${record.followUpNotes}` : ""}`,
          { bold: "Follow-up:" },
        );
      }
      y += 8;
    });
  }

  // --- readings -----------------------------------------------------------
  const vitals = (bundle.vitals ?? []).slice(0, 30);
  if (vitals.length > 0) {
    heading("Recent readings", vitals.length);
    // Units on every value. A column of bare numbers on a page a stranger reads
    // is how a reading gets misread.
    table(
      ["Date", "Pulse", "Blood pressure", "Oxygen", "Temperature"],
      vitals.map((v) => [
        day(v.recordedAt),
        v.heartRate ? `${v.heartRate} bpm` : "—",
        v.systolicBp && v.diastolicBp ? `${v.systolicBp}/${v.diastolicBp} mmHg` : "—",
        v.oxygenSaturation ? `${v.oxygenSaturation}%` : "—",
        v.temperature ? `${v.temperature} C` : "—",
      ]),
    );
  }

  // --- appointments -------------------------------------------------------
  const appointments = bundle.appointments ?? [];
  if (appointments.length > 0) {
    heading("Appointments", appointments.length);
    table(
      ["Date", "Time", "Doctor", "Status", "Reason"],
      appointments
        .slice(0, 40)
        .map((a) => [
          a.localDate ?? day(a.startTime),
          a.localTime ?? "—",
          [a.doctorName, a.specialization].filter(Boolean).join(" · ") || "—",
          a.status,
          a.reason || "—",
        ]),
    );
  }

  // --- documents and bills ------------------------------------------------
  const documents = bundle.documents ?? [];
  if (documents.length > 0) {
    heading("Documents on file", documents.length);
    paragraph(
      "Listed by name. The files themselves stay in the portal — open each one there to download it.",
    );
    table(
      ["Uploaded", "Type", "File"],
      documents.map((d) => [day(d.createdAt), String(d.documentType), d.fileName]),
    );
  }

  const invoices = bundle.invoices ?? [];
  if (invoices.length > 0) {
    heading("Invoices", invoices.length);
    table(
      ["Invoice", "Issued", "Status", "Total"],
      invoices.map((i) => [
        i.invoiceNumber,
        day(i.issuedAt),
        i.status,
        `${i.currency} ${i.totalAmount}`,
      ]),
    );
  }

  if ((bundle.truncated ?? []).length > 0) {
    heading("Not everything fitted");
    paragraph(
      `These lists reached their per-export ceiling and hold only the most recent entries: ${bundle.truncated.join(", ")}. Ask the hospital for the remainder.`,
    );
  }

  // --- footer on every page ----------------------------------------------
  // Added last, because the page count is not known until the document is.
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(RULE).setLineWidth(0.7);
    doc.line(MARGIN, PAGE.height - 40, PAGE.width - MARGIN, PAGE.height - 40);
    doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(MUTED);
    doc.text(
      `${p.name ?? ""}  ·  ${p.medicalRecordNumber ?? ""}  ·  prepared ${day(bundle.exportedAt)}`,
      MARGIN,
      PAGE.height - 28,
    );
    doc.text(`Page ${page} of ${pages}`, PAGE.width - MARGIN, PAGE.height - 28, {
      align: "right",
    });
  }

  return doc.output("blob");
}

/** The file name a person will see in their Downloads folder. */
export function recordFileName(mrn: string | undefined): string {
  return `medinova-record-${mrn ?? "export"}-${new Date().toISOString().slice(0, 10)}.pdf`;
}
