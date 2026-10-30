/**
 * Pure rules for the fill-in: which details a reference needs, whether a
 * Crossref record is the same work as an item, and which empty fields the
 * record can fill. Existing values are never overwritten, except import
 * leftovers (see isBlank). No Zotero
 * dependency, so everything here is unit-tested in Node
 * (test/unit/crossref.test.ts).
 */

import { FieldChange, fieldLabel, NewCreator, shorten } from "./changes";
import { cleanJournalName, isBogusPages, splitVolumeIssue } from "./clean";

export interface CrossrefName {
  given?: string;
  family?: string;
  name?: string;
}

interface CrossrefDate {
  "date-parts"?: (number | null)[][];
}

/** The subset of a Crossref work record (api.crossref.org/works) used here. */
export interface CrossrefWork {
  DOI: string;
  type?: string;
  title?: string[];
  subtitle?: string[];
  "container-title"?: string[];
  volume?: string;
  issue?: string;
  page?: string;
  "article-number"?: string;
  publisher?: string;
  "publisher-location"?: string;
  ISBN?: string[];
  author?: CrossrefName[];
  editor?: CrossrefName[];
  issued?: CrossrefDate;
  "published-print"?: CrossrefDate;
  "published-online"?: CrossrefDate;
}

/** The fields Crossref is asked for, to keep responses small. */
export const CROSSREF_SELECT = [
  "DOI",
  "type",
  "title",
  "subtitle",
  "container-title",
  "volume",
  "issue",
  "page",
  "article-number",
  "publisher",
  "publisher-location",
  "ISBN",
  "author",
  "editor",
  "issued",
  "published-print",
  "published-online",
].join(",");

export interface FillSnapshot {
  itemType: string;
  /** Every field valid for the item type, "" when empty. */
  fields: Record<string, string>;
  creators: { firstName?: string; lastName?: string; creatorType: string }[];
  /** The DOI from the DOI field or Extra, already in full form. */
  doi?: string;
}

// --- What a reference needs -------------------------------------------

/** The reference style whose requirements the check follows. */
export type Style = "apa" | "chicago";

// What APA 7 prints for each type. "author"/"editor" are creator types;
// "a|b" means either will do.
const REQUIRED: Record<string, string[]> = {
  journalArticle: [
    "author",
    "date",
    "title",
    "publicationTitle",
    "volume",
    "pages",
  ],
  bookSection: [
    "author",
    "date",
    "title",
    "bookTitle",
    "editor",
    "pages",
    "publisher",
  ],
  book: ["author|editor", "date", "title", "publisher"],
  conferencePaper: [
    "author",
    "date",
    "title",
    "proceedingsTitle|conferenceName",
  ],
  report: ["author", "date", "title", "institution"],
  thesis: ["author", "date", "title", "university"],
  magazineArticle: ["author", "date", "title", "publicationTitle"],
  newspaperArticle: ["date", "title", "publicationTitle"],
};

// What Chicago (17th ed., author-date and notes-bibliography) prints on top
// of APA: the place of publication. (The 18th edition made it optional.)
const CHICAGO_EXTRA: Record<string, string[]> = {
  book: ["place"],
  bookSection: ["place"],
  report: ["place"],
};

/** Types that usually have a DOI, so a missing one is worth looking up. */
export const DOI_TYPES = new Set([
  "journalArticle",
  "bookSection",
  "conferencePaper",
]);

const CREATOR_TYPES = new Set(["author", "editor"]);

/**
 * Empty, or holding an import leftover the clean-up would remove: page "0",
 * an article ID as pages, or "44(6)" as the volume. Such values are filled
 * over, so the fill-in works whether or not the clean-up ran first.
 */
export function isBlank(item: FillSnapshot, field: string): boolean {
  const value = item.fields[field]?.trim() ?? "";
  if (!value) return true;
  if (field === "pages") return isBogusPages(value, item.doi);
  if (field === "volume") return splitVolumeIssue(value) !== null;
  return false;
}

function present(item: FillSnapshot, name: string): boolean {
  if (CREATOR_TYPES.has(name)) {
    return item.creators.some((c) => c.creatorType === name);
  }
  // A field the type doesn't have can't be missing
  return !(name in item.fields) || !isBlank(item, name);
}

/** Required details the item lacks, e.g. ["volume", "pages"]. */
export function missingFields(
  item: FillSnapshot,
  style: Style = "apa",
): string[] {
  const required = [
    ...(REQUIRED[item.itemType] ?? []),
    ...(style === "chicago" ? (CHICAGO_EXTRA[item.itemType] ?? []) : []),
  ];
  return required.filter(
    (req) => !req.split("|").some((name) => present(item, name)),
  );
}

/** Whether the item is worth a Crossref request at all. */
export function needsLookup(item: FillSnapshot, style: Style = "apa"): boolean {
  return (
    missingFields(item, style).length > 0 ||
    (!item.doi && DOI_TYPES.has(item.itemType))
  );
}

// --- Matching a search result -----------------------------------------

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lower-case words without accents or punctuation, for comparing titles. */
export function normalizeTitle(s: string): string {
  return stripTags(s)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’‘`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function mainTitle(s: string): string {
  return stripTags(s).split(/[:?!.]\s/)[0];
}

function workTitle(work: CrossrefWork): string {
  const title = stripTags(work.title?.[0] ?? "");
  const subtitle = stripTags(work.subtitle?.[0] ?? "");
  return subtitle && !title.includes(":") ? `${title}: ${subtitle}` : title;
}

/**
 * Same title, or the same main title (before the colon) of two or more
 * words: Crossref often drops subtitles ("Clio’s Toolkit").
 */
export function titlesMatch(itemTitle: string, work: CrossrefWork): boolean {
  const a = normalizeTitle(itemTitle);
  if (!a) return false;
  const full = normalizeTitle(workTitle(work));
  if (a === full || a === normalizeTitle(work.title?.[0] ?? "")) return true;
  const mainA = normalizeTitle(mainTitle(itemTitle));
  const mainB = normalizeTitle(mainTitle(workTitle(work)));
  return mainA === mainB && mainA.split(" ").length >= 2;
}

function years(work: CrossrefWork): number[] {
  return [work["published-print"], work["published-online"], work.issued]
    .map((d) => d?.["date-parts"]?.[0]?.[0])
    .filter((y): y is number => typeof y === "number");
}

function itemYear(item: FillSnapshot): number | null {
  const m = /\b(\d{4})\b/.exec(item.fields.date ?? "");
  return m ? Number(m[1]) : null;
}

const COMPATIBLE_TYPES: Record<string, string[]> = {
  journalArticle: ["journal-article"],
  bookSection: ["book-chapter", "book-section", "book-part", "reference-entry"],
  book: ["book", "monograph", "edited-book", "reference-book"],
  conferencePaper: ["proceedings-article"],
  report: ["report", "report-component"],
  thesis: ["dissertation"],
};

function familyName(c: { lastName?: string }): string {
  return normalizeTitle(c.lastName ?? "");
}

/**
 * Whether a search result is this item: compatible type, matching title,
 * a shared author surname when the item has authors, and the year within
 * one (online-first vs print) when the item has a year.
 */
export function isSameWork(item: FillSnapshot, work: CrossrefWork): boolean {
  const types = COMPATIBLE_TYPES[item.itemType];
  if (types && work.type && !types.includes(work.type)) return false;
  if (!titlesMatch(item.fields.title ?? "", work)) return false;

  const authors = item.creators.filter((c) => c.creatorType === "author");
  if (authors.length) {
    const families = new Set(
      [...(work.author ?? []), ...(work.editor ?? [])].map((a) =>
        normalizeTitle(a.family ?? a.name ?? ""),
      ),
    );
    if (!authors.some((a) => families.has(familyName(a)))) return false;
  }

  const year = itemYear(item);
  if (year !== null) {
    const ys = years(work);
    if (ys.length && !ys.some((y) => Math.abs(y - year) <= 1)) return false;
  }
  return true;
}

/** The first search result that is this item, or null. */
export function pickMatch(
  item: FillSnapshot,
  results: CrossrefWork[],
): CrossrefWork | null {
  return results.find((work) => isSameWork(item, work)) ?? null;
}

/** query.bibliographic text for a Crossref search, or null without a title. */
export function searchQuery(item: FillSnapshot): string | null {
  const title = item.fields.title?.trim();
  if (!title) return null;
  const author = item.creators.find((c) => c.lastName)?.lastName;
  const year = itemYear(item);
  return [title, author, year].filter(Boolean).join(" ");
}

// --- Filling -----------------------------------------------------------

/** Crossref date-parts as a Zotero date: "2023-06", "2013-12-12", "1957". */
export function formatDate(date: CrossrefDate | undefined): string {
  const parts = date?.["date-parts"]?.[0] ?? [];
  const [y, m, d] = parts;
  if (!y) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return [String(y), m ? pad(m) : null, m && d ? pad(d) : null]
    .filter(Boolean)
    .join("-");
}

function toCreators(names: CrossrefName[] | undefined, creatorType: string) {
  return (names ?? [])
    .filter((n) => n.family || n.name)
    .map((n): NewCreator => ({
      firstName: n.family ? (n.given ?? "") : "",
      lastName: n.family ?? n.name ?? "",
      creatorType,
    }));
}

const CONTAINER_FIELD: Record<string, string> = {
  journalArticle: "publicationTitle",
  magazineArticle: "publicationTitle",
  newspaperArticle: "publicationTitle",
  bookSection: "bookTitle",
  conferencePaper: "proceedingsTitle",
};

const PUBLISHER_FIELD: Record<string, string> = {
  book: "publisher",
  bookSection: "publisher",
  conferencePaper: "publisher",
  report: "institution",
};

/**
 * Changes that fill the item's empty fields from a Crossref record. `book`
 * is the record of the book a chapter belongs to, which carries the editors
 * and the full book title that chapter records lack.
 */
export function planFill(
  item: FillSnapshot,
  work: CrossrefWork,
  book?: CrossrefWork | null,
): FieldChange[] {
  const changes: FieldChange[] = [];
  const fill = (field: string, value: string | undefined) => {
    const to = stripTags(value ?? "");
    if (!to || !(field in item.fields) || !isBlank(item, field)) return;
    // SAGE gives its OnlineFirst ID as the article number
    if (field === "pages" && isBogusPages(to, work.DOI)) return;
    if (changes.some((c) => c.field === field)) return;
    changes.push({ field, from: item.fields[field], to, reason: "Crossref" });
  };

  fill("title", workTitle(work));
  const container = CONTAINER_FIELD[item.itemType];
  if (container) {
    const name =
      item.itemType === "bookSection" && book
        ? workTitle(book)
        : work["container-title"]?.[0];
    fill(container, name && cleanJournalName(stripTags(name)));
  }
  fill("volume", work.volume);
  fill("issue", work.issue);
  fill("pages", work.page ?? work["article-number"]);
  fill(
    "date",
    formatDate(
      work["published-print"] ?? work["published-online"] ?? work.issued,
    ),
  );
  const publisherField = PUBLISHER_FIELD[item.itemType];
  if (publisherField) fill(publisherField, (book ?? work).publisher);
  // Chicago prints the place, APA doesn't; filling it does no harm in APA
  if (publisherField) {
    fill("place", cleanPlace((book ?? work)["publisher-location"] ?? ""));
  }

  if (!item.doi && work.DOI) {
    const doi = work.DOI.toLowerCase();
    if ("DOI" in item.fields) {
      fill("DOI", doi);
    } else {
      // Types without a DOI field keep it in Extra, which styles read too
      const extra = item.fields.extra ?? "";
      changes.push({
        field: "extra",
        from: extra,
        to: extra ? `${extra}\nDOI: ${doi}` : `DOI: ${doi}`,
        reason: "Crossref",
      });
    }
  }

  const has = (type: string) =>
    item.creators.some((c) => c.creatorType === type);
  const add = (creators: NewCreator[]) => {
    if (!creators.length) return;
    changes.push({
      field: "creators",
      from: "",
      to: creators
        .map(
          (c) =>
            `${c.creatorType}: ${c.lastName}${c.firstName ? `, ${c.firstName}` : ""}`,
        )
        .join("; "),
      addCreators: creators,
      reason: "Crossref",
    });
  };
  const newCreators: NewCreator[] = [];
  if (!has("author")) newCreators.push(...toCreators(work.author, "author"));
  if (
    !has("editor") &&
    (item.itemType === "bookSection" || item.itemType === "book")
  ) {
    newCreators.push(
      ...toCreators(work.editor?.length ? work.editor : book?.editor, "editor"),
    );
  }
  add(newCreators);

  return changes;
}

// --- Places ------------------------------------------------------------

/**
 * A place of publication from catalogue-style data: "New York" from
 * "1 Edition. | New York : Routledge, [2017]", "Abingdon, Oxon" from
 * "Abingdon, Oxon; New York, NY: Routledge, 2021.", "Helena, MT" from
 * "[Helena, MT?". Returns "" when nothing usable is left.
 */
export function cleanPlace(raw: string): string {
  const parts = raw
    .split("|")
    .map((p) => p.trim())
    .filter(Boolean);
  const part = parts.find((p) => p.includes(":")) ?? parts[0] ?? "";
  const place = part
    .split(":")[0]
    .split(";")[0]
    .replace(/[[\]?]/g, "")
    .replace(/[\s.,]+$/, "")
    .trim();
  // Years, editions and long strings are not a place
  return /\d/.test(place) || place.length > 60 ? "" : place;
}

// --- Open Library ------------------------------------------------------

/** The subset of an Open Library edition (openlibrary.org/isbn/…) used here. */
export interface OpenLibraryEdition {
  publishers?: string[];
  publish_places?: string[];
}

/** The ISBN to look a book up by, digits only, or null. */
export function bookIsbn(item: FillSnapshot): string | null {
  const isbn = (item.fields.ISBN ?? "")
    .split(/[\s,;]+/)[0]
    .replace(/[^0-9X]/gi, "");
  return isbn.length === 10 || isbn.length === 13 ? isbn : null;
}

/** Whether an Open Library lookup could add a book's publisher or place. */
export function wantsBookDetails(
  item: FillSnapshot,
  style: Style = "apa",
): boolean {
  if (item.itemType !== "book" && item.itemType !== "bookSection") return false;
  const missing = missingFields(item, style);
  return missing.includes("publisher") || missing.includes("place");
}

/**
 * Changes that fill a book's (or chapter's book's) empty publisher and place
 * from its Open Library edition, found by ISBN, so it is the same book.
 */
export function planBookFill(
  item: FillSnapshot,
  edition: OpenLibraryEdition,
): FieldChange[] {
  const changes: FieldChange[] = [];
  const fill = (field: string, value: string | undefined) => {
    const to = (value ?? "").trim();
    if (!to || !(field in item.fields) || !isBlank(item, field)) return;
    changes.push({
      field,
      from: item.fields[field],
      to,
      reason: "Open Library",
    });
  };
  fill("publisher", edition.publishers?.[0]);
  fill("place", cleanPlace(edition.publish_places?.[0] ?? ""));
  return changes;
}

/** The item as it would be after the changes, to report what's still missing. */
export function withChanges(
  item: FillSnapshot,
  changes: FieldChange[],
): FillSnapshot {
  const fields = { ...item.fields };
  const creators = [...item.creators];
  for (const c of changes) {
    if (c.addCreators) creators.push(...c.addCreators);
    else if (c.field in fields) fields[c.field] = c.to;
  }
  return { ...item, fields, creators };
}

// --- Report ------------------------------------------------------------

export interface IncompleteItem {
  citation: string;
  title: string;
  missing: string[];
  /** No Crossref record was found for the item. */
  notFound: boolean;
}

/** "volume, pages" for ["volume", "pages"]; "a|b" shows as "A or B". */
export function describeMissing(missing: string[]): string {
  return missing
    .map((req) => req.split("|").map(fieldLabel).join(" or "))
    .join(", ");
}

/** One line per item that will still lack required details, capped. */
export function formatIncomplete(
  items: IncompleteItem[],
  limit = 10,
  notFoundNote = "not found in Crossref",
): string {
  const lines = items
    .slice(0, limit)
    .map(
      (i) =>
        `• ${i.citation} — ${shorten(i.title, 40)}: ${describeMissing(i.missing)}${i.notFound ? ` (${notFoundNote})` : ""}`,
    );
  if (items.length > limit) lines.push(`…and ${items.length - limit} more`);
  return lines.join("\n");
}
