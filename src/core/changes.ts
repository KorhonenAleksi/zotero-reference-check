/**
 * The change list both commands produce: what the confirmation dialog shows
 * and what the log records. No Zotero dependency; unit-tested in Node.
 */

import { displayLink } from "./links";

export type ChangeReason =
  | "database link"
  | "archive link"
  | "database name"
  | "accession number"
  | "journal name"
  | "article ID"
  | "page count"
  | "catalogue title"
  | "creator name"
  | "volume and issue"
  | "short DOI"
  | "DOI in Extra"
  | "Crossref"
  | "Open Library";

export interface NewCreator {
  firstName: string;
  lastName: string;
  creatorType: string;
}

export interface FieldChange {
  /**
   * Zotero field name; "firstName"/"lastName" with `creatorIndex`; or
   * "creators" with `addCreators`, whose `to` is the display text.
   */
  field: string;
  creatorIndex?: number;
  addCreators?: NewCreator[];
  /** A URL to keep as a link attachment before the field is cleared. */
  attachLink?: string;
  from: string;
  to: string;
  reason: ChangeReason;
}

export interface PlannedItem {
  /** e.g. "Langley (1999)" */
  citation: string;
  title: string;
  changes: FieldChange[];
}

const FIELD_LABELS: Record<string, string> = {
  url: "URL",
  DOI: "DOI",
  extra: "Extra",
  archive: "Archive",
  archiveLocation: "Loc. in Archive",
  publicationTitle: "Publication",
  journalAbbreviation: "Journal Abbr",
  pages: "Pages",
  numPages: "# of Pages",
  title: "Title",
  volume: "Volume",
  issue: "Issue",
  date: "Date",
  bookTitle: "Book Title",
  proceedingsTitle: "Proceedings Title",
  publisher: "Publisher",
  place: "Place",
  institution: "Institution",
  university: "University",
  firstName: "Creator",
  lastName: "Creator",
  creators: "Creators",
  conferenceName: "Conference Name",
  author: "Author",
  editor: "Editor",
};

/** The label Zotero shows for a field, e.g. "Book Title". */
export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

export function shorten(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

function show(field: string, value: string): string {
  return field === "url" ? displayLink(value, 60) : shorten(value, 60);
}

/** One or more display lines for a change. */
export function describeChange(c: FieldChange): string[] {
  const label = fieldLabel(c.field);
  if (c.field === "extra") {
    // Show only the lines that differ
    const before = c.from.split("\n").filter((l) => l.trim());
    const after = c.to.split("\n").filter((l) => l.trim());
    return [
      ...before
        .filter((l) => !after.includes(l))
        .map((l) => `✕ ${label}: ${shorten(l, 60)}`),
      ...after
        .filter((l) => !before.includes(l))
        .map((l) => `+ ${label}: ${shorten(l, 60)}`),
    ];
  }
  if (c.field === "url" && c.reason === "archive link") {
    return c.attachLink
      ? [`→ ${label} moved to a link attachment: ${show(c.field, c.from)}`]
      : [`✕ ${label} (already attached): ${show(c.field, c.from)}`];
  }
  if (!c.to) return [`✕ ${label}: ${show(c.field, c.from)}`];
  if (!c.from) return [`+ ${label}: ${show(c.field, c.to)}`];
  return [`${label}: ${show(c.field, c.from)} → ${show(c.field, c.to)}`];
}

/**
 * The item, then one indented line per change, capped at `limit` items with
 * a final "…and N more".
 */
export function formatPlan(items: PlannedItem[], limit = 10): string {
  const lines: string[] = [];
  for (const item of items.slice(0, limit)) {
    lines.push(`• ${item.citation} — ${shorten(item.title, 60)}`);
    for (const c of item.changes) {
      for (const l of describeChange(c)) lines.push(`    ${l}`);
    }
  }
  if (items.length > limit) lines.push(`…and ${items.length - limit} more`);
  return lines.join("\n");
}

/** Items per reason, e.g. "database name 174, accession number 150". */
export function summarizeReasons(items: PlannedItem[]): string {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const reason of new Set(item.changes.map((c) => c.reason))) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, n]) => `${reason} ${n}`)
    .join(", ");
}

export const LOG_HEADER =
  "changed_at,library_key,item_type,reason,field,old_value,new_value";

function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** One CSV line for the change log, so any change can be undone. */
export function logRow(
  changedAt: string,
  libraryKey: string,
  itemType: string,
  change: FieldChange,
): string {
  const field =
    change.creatorIndex === undefined
      ? change.field
      : `creator${change.creatorIndex + 1}.${change.field}`;
  return [
    changedAt,
    libraryKey,
    itemType,
    change.reason,
    field,
    change.from,
    change.to,
  ]
    .map(csvField)
    .join(",");
}
