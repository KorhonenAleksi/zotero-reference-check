/**
 * Pure rules for the leftovers database and catalogue imports leave in fields
 * that citation styles print: database links and names, accession numbers,
 * journal names with publisher or coverage suffixes, article IDs in the pages
 * field, issues in the volume field, page counts in Extra, catalogue-style
 * titles and creator names, and short DOIs. No Zotero dependency, so everything here is unit-tested in Node
 * (test/unit/clean.test.ts).
 */

import { ChangeReason, FieldChange } from "./changes";
import { isShortDoi } from "./doi";
import { CLEANABLE_TYPES, classifyLink } from "./links";

export interface ItemSnapshot {
  itemType: string;
  url?: string;
  /** Undefined when the item type has no DOI field. */
  DOI?: string;
  /** Full form of a short DOI ("10/abc"), looked up by the caller. */
  resolvedDOI?: string;
  extra?: string;
  archive?: string;
  archiveLocation?: string;
  publicationTitle?: string;
  journalAbbreviation?: string;
  volume?: string;
  /** Undefined when the item type has no Issue field. */
  issue?: string;
  pages?: string;
  /** Undefined when the item type has no "# of Pages" field. */
  numPages?: string;
  title?: string;
  creators?: { firstName?: string; lastName?: string }[];
  /** URLs of the item's linked-URL attachments. */
  linkedUrls?: string[];
}

/** Clean-up rules that can be switched off in the settings. */
export const CLEAN_RULES = [
  "databaseLinks",
  "archiveScans",
  "databaseFields",
  "journalNames",
  "pages",
  "volumeIssue",
  "extraFields",
  "catalogueNames",
  "shortDois",
] as const;
export type CleanRule = (typeof CLEAN_RULES)[number];
/** Rules switched off; every rule runs unless set to false. */
export type RuleSettings = Partial<Record<CleanRule, boolean>>;

type SnapshotField = Exclude<
  keyof ItemSnapshot,
  "itemType" | "resolvedDOI" | "creators" | "linkedUrls"
>;

// --- Links -------------------------------------------------------------

/**
 * A book scanned on the Internet Archive ("archive.org/details/…"). Like a
 * database, it's where the book was read, not part of its reference. Wayback
 * Machine copies (web.archive.org) are not matched: people cite those on
 * purpose when the original page is gone.
 */
export function isArchiveScan(url: string | null | undefined): boolean {
  const m =
    /^\s*(?:https?:\/\/)?(?:www\.)?archive\.org\/(details|stream)\//i.exec(
      url ?? "",
    );
  return !!m;
}

/** Item types whose archive.org scan link is moved to an attachment. */
const SCAN_TYPES = new Set(["book", "bookSection"]);

/** The title of the link attachment a scan link is moved to. */
export const ARCHIVE_ATTACHMENT_TITLE = "Internet Archive";

function hasDoi(item: ItemSnapshot): boolean {
  if (item.DOI?.trim()) return true;
  // Types without a DOI field keep it in Extra ("DOI: 10.…"), which citation
  // styles read too.
  return /^\s*DOI:\s*10\.\S+/im.test(item.extra ?? "");
}

const EXTRA_DOI = /^\s*DOI:\s*(10\.\S+)\s*$/im;

// --- Database names and accession numbers ------------------------------

const DATABASE_NAMES = [
  /^business source/i,
  /^academic search/i,
  /^abi\/inform/i,
  /^proquest/i,
  /premium collection/i,
  /^jstor/i,
  /^ebsco/i,
  /^gale/i,
  /^apa psyc/i,
  /^psyc(info|articles)/i,
  /^econlit/i,
  /^web of science/i,
  /^scopus/i,
  /^factiva/i,
  /^nexis/i,
  /^emerald insight/i,
  /^sciencedirect/i,
  /^cambridge core/i,
  // EBSCO database codes, as in "db=bsh" of an EBSCO link
  /^(bsh|bth|bsu|buh|asn|a9h|ecn)$/i,
];

/** Database or platform names stored in Archive, e.g. "Business Source Ultimate". */
export function isDatabaseName(archive: string | undefined): boolean {
  const s = archive?.trim() ?? "";
  return !!s && DATABASE_NAMES.some((re) => re.test(s));
}

/**
 * Database record IDs stored in "Loc. in Archive": EBSCO/ProQuest accession
 * numbers ("174326664", "203397705; 00609030"), Web of Science IDs, PsycINFO
 * IDs. Real archive locations ("Box 12, Folder 3") don't match.
 */
export function isAccessionNumber(location: string | undefined): boolean {
  return /^(WOS:[A-Z0-9]+|\d{6,}(;\s*\d+)*|\d{4}-\d{5}-\d{3})$/i.test(
    location?.trim() ?? "",
  );
}

// --- Journal names -----------------------------------------------------

// EBSCO appends the publisher: "Journal of Management Studies (Wiley-Blackwell)"
const PUBLISHER_SUFFIX =
  /\s*\([^()]*\b(Wiley|Blackwell|Sons|INFORMS|Routledge|Taylor|Francis|Elsevier|SAGE|Springer|Emerald|Ltd|Inc|Publishing|Publications|Press)\b[^()]*\)$/i;
// EBSCO and ProQuest append coverage: "- 1980 to 2009", "(pre-1986)", "(1986-1998)"
const COVERAGE_SUFFIX =
  /\s*(-\s*\d{4} to \d{4}|\((pre-\d{4}|\d{4}\s*-\s*\d{4})\))$/i;
// ProQuest: "Academy of Management. The Academy of Management Review"
const PROQUEST_PREFIX =
  /^Academy of Management\.\s+(?=The Academy of Management)/i;
const AOM_JOURNAL =
  /^(the\s+)?academy of management\s+(journal|review|annals|perspectives|executive|discoveries|proceedings|learning (and|&) education)$/i;

function titleWord(w: string): string {
  return w === "and" || w === "&" ? "&" : w[0].toUpperCase() + w.slice(1);
}

/** A journal name without database decorations, or the name unchanged. */
export function cleanJournalName(name: string): string {
  let s = name.trim().replace(/\s{2,}/g, " ");
  let prev;
  do {
    prev = s;
    s = s
      .replace(COVERAGE_SUFFIX, "")
      .replace(PUBLISHER_SUFFIX, "")
      .replace(PROQUEST_PREFIX, "")
      .trim();
  } while (s !== prev);
  const aom = AOM_JOURNAL.exec(s);
  if (aom) {
    // The Academy's own titles have no leading "The"
    s = `Academy of Management ${aom[2].toLowerCase().split(" ").map(titleWord).join(" ")}`;
  }
  return s;
}

// --- Pages -------------------------------------------------------------

/**
 * Pages values that are not page ranges: "0", and article IDs such as SAGE's
 * "00018392251355283" or the DOI suffix ("amle.2024.0416"). Short Elsevier-style
 * article numbers ("101381") are real eLocators and kept.
 */
export function isBogusPages(pages: string, doi?: string): boolean {
  const p = pages.trim();
  if (p === "0") return true;
  if (/^\d{12,}$/.test(p)) return true;
  // The whole DOI suffix, not just its last segment: "P10008" in
  // 10.1088/1742-5468/2008/10/P10008 is a real article number.
  const suffix = doi?.trim().replace(/^10\.\d+\//, "");
  return (
    !!p &&
    !!suffix &&
    suffix !== doi &&
    suffix.toLowerCase() === p.toLowerCase()
  );
}

// A page count imported into Extra ("Pages: 344 Pages"). Zotero reads
// "Pages:" in Extra as the page range, so styles print "(p. 344)".
const EXTRA_PAGE_COUNT = /^Pages:\s*(\d+)(\s*pages?)?\s*$/i;

// --- Volume and issue ------------------------------------------------

/**
 * "44(6)" or "44 (6)" in Volume: the issue imported into the wrong field,
 * printed as one italic volume. Returns [volume, issue], or null.
 */
export function splitVolumeIssue(volume: string): [string, string] | null {
  const m = /^(\d+)\s*\((\d+(?:[-–/]\d+)?)\)$/.exec(volume.trim());
  return m ? [m[1], m[2]] : null;
}

// --- Titles and creators -----------------------------------------------

/**
 * Library catalogues separate the subtitle with a semicolon:
 * "Leadership in Administration; a Sociological Interpretation".
 */
export function cleanCatalogueTitle(title: string): string {
  const m = /^([^:;]+); ([a-z])(.*)$/.exec(title);
  return m ? `${m[1]}: ${m[2].toUpperCase()}${m[3]}` : title;
}

const CREATOR_PREFIX =
  /^(with an? (introduction|foreword|preface) by|(translated|edited|introduced) by)\s+/i;

// --- Planning ----------------------------------------------------------

/**
 * Every change to make to one item, or [] to leave it alone. Rules run on a
 * working copy, so a field touched by two rules (Extra) yields one change.
 */
export function planCleanup(
  item: ItemSnapshot,
  rules: RuleSettings = {},
): FieldChange[] {
  if (!CLEANABLE_TYPES.has(item.itemType)) return [];
  const on = (rule: CleanRule) => rules[rule] !== false;

  const cur: Partial<Record<SnapshotField, string>> = { ...item };
  const reasons = new Map<SnapshotField, ChangeReason>();
  const set = (field: SnapshotField, value: string, reason: ChangeReason) => {
    if ((cur[field] ?? "") === value) return;
    cur[field] = value;
    if (!reasons.has(field)) reasons.set(field, reason);
  };

  if (on("shortDois") && item.resolvedDOI && isShortDoi(item.DOI)) {
    set("DOI", item.resolvedDOI, "short DOI");
  }

  // Older Zotero versions had no DOI field for some types (book sections),
  // so imports put it in Extra. Move it to the field now that there is one.
  const extraDoi = EXTRA_DOI.exec(cur.extra ?? "");
  if (
    on("extraFields") &&
    extraDoi &&
    item.DOI !== undefined &&
    !cur.DOI?.trim()
  ) {
    set("DOI", extraDoi[1], "DOI in Extra");
    set(
      "extra",
      (cur.extra ?? "")
        .split("\n")
        .filter((l) => !EXTRA_DOI.test(l))
        .join("\n"),
      "DOI in Extra",
    );
  }

  // Links only reach the reference list when there is no DOI.
  let attachLink: string | undefined;
  if (!hasDoi(item) && cur.url) {
    const url = cur.url.trim();
    if (
      on("archiveScans") &&
      SCAN_TYPES.has(item.itemType) &&
      isArchiveScan(url)
    ) {
      // Kept as a link attachment, which no citation style prints
      if (!item.linkedUrls?.includes(url)) attachLink = url;
      set("url", "", "archive link");
    } else if (on("databaseLinks") && classifyLink(url)) {
      set("url", "", "database link");
    }
  }

  const databaseArchive = on("databaseFields") && isDatabaseName(cur.archive);
  if (databaseArchive) set("archive", "", "database name");
  if (
    on("databaseFields") &&
    cur.archiveLocation &&
    (databaseArchive || isAccessionNumber(cur.archiveLocation))
  ) {
    set("archiveLocation", "", "accession number");
  }

  for (const field of ["publicationTitle", "journalAbbreviation"] as const) {
    if (on("journalNames") && cur[field])
      set(field, cleanJournalName(cur[field]), "journal name");
  }

  const split =
    on("volumeIssue") && cur.volume ? splitVolumeIssue(cur.volume) : null;
  if (split && item.issue !== undefined && !cur.issue?.trim()) {
    set("volume", split[0], "volume and issue");
    set("issue", split[1], "volume and issue");
  }

  if (on("pages") && cur.pages && isBogusPages(cur.pages, cur.DOI)) {
    set("pages", "", "article ID");
  }

  if (on("extraFields") && cur.extra) {
    const lines = cur.extra.split("\n");
    const count = lines.map((l) => EXTRA_PAGE_COUNT.exec(l.trim()));
    const found = count.find(Boolean);
    if (found) {
      set("extra", lines.filter((_, i) => !count[i]).join("\n"), "page count");
      if (item.numPages !== undefined && !cur.numPages?.trim()) {
        set("numPages", found[1], "page count");
      }
    }
  }

  if (on("catalogueNames") && item.itemType === "book" && cur.title) {
    set("title", cleanCatalogueTitle(cur.title), "catalogue title");
  }

  const changes: FieldChange[] = [...reasons].map(([field, reason]) => ({
    field,
    from: item[field] ?? "",
    to: cur[field] ?? "",
    reason,
    ...(field === "url" && attachLink ? { attachLink } : {}),
  }));

  if (!on("catalogueNames")) return changes;
  item.creators?.forEach((creator, creatorIndex) => {
    for (const field of ["firstName", "lastName"] as const) {
      const from = creator[field];
      if (from && CREATOR_PREFIX.test(from)) {
        changes.push({
          field,
          creatorIndex,
          from,
          to: from.replace(CREATOR_PREFIX, ""),
          reason: "creator name",
        });
      }
    }
  });

  return changes;
}
