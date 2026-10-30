import { FieldChange, formatPlan, PlannedItem } from "../core/changes";
import {
  bookIsbn,
  CROSSREF_SELECT,
  CrossrefWork,
  FillSnapshot,
  formatIncomplete,
  IncompleteItem,
  missingFields,
  needsLookup,
  OpenLibraryEdition,
  pickMatch,
  planBookFill,
  planFill,
  searchQuery,
  wantsBookDetails,
  withChanges,
} from "../core/crossref";
import { getString } from "../utils/locale";
import { cleanRules, referenceStyle } from "../utils/prefs";
import {
  alert,
  applyPlans,
  citationLabel,
  confirm,
  editableReferences,
  field,
  progressWindow,
  resolveShortDois,
  showResult,
} from "./zotero";

const CROSSREF = "https://api.crossref.org";

function snapshot(item: Zotero.Item, resolvedDOI?: string): FillSnapshot {
  const fields: Record<string, string> = {};
  for (const id of Zotero.ItemFields.getItemTypeFields(item.itemTypeID)) {
    const name = Zotero.ItemFields.getName(id) as string;
    fields[name] = field(item, name);
  }
  const extraDoi = /^\s*DOI:\s*(10\.\S+)/im.exec(fields.extra ?? "")?.[1];
  return {
    itemType: item.itemType,
    fields,
    creators: item.getCreators().map((c) => ({
      firstName: c.firstName,
      lastName: c.lastName,
      creatorType: Zotero.CreatorTypes.getName(c.creatorTypeID) as string,
    })),
    doi: resolvedDOI || fields.DOI?.trim() || extraDoi || undefined,
  };
}

/** GET from the Crossref REST API; the response's message, or null. */
async function crossref<T>(path: string): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const xhr = await Zotero.HTTP.request("GET", `${CROSSREF}${path}`, {
        responseType: "json",
        successCodes: [200, 404],
        timeout: 20000,
      });
      return xhr.status === 200 ? (xhr.response?.message ?? null) : null;
    } catch (e) {
      // Crossref answers 429 when we go too fast: wait once, then give up
      if ((e as { status?: number }).status === 429 && attempt === 0) {
        await Zotero.Promise.delay(3000);
        continue;
      }
      Zotero.debug(`Reference Check: Crossref ${path} failed: ${e}`);
      return null;
    }
  }
  return null;
}

async function findWork(item: FillSnapshot): Promise<CrossrefWork | null> {
  if (item.doi) {
    return crossref<CrossrefWork>(`/works/${encodeURIComponent(item.doi)}`);
  }
  const query = searchQuery(item);
  if (!query) return null;
  const result = await crossref<{ items: CrossrefWork[] }>(
    `/works?rows=5&select=${CROSSREF_SELECT}&query.bibliographic=${encodeURIComponent(query)}`,
  );
  return pickMatch(item, result?.items ?? []);
}

/** The book a chapter belongs to, found by ISBN: it lists the editors. */
async function findBook(
  item: FillSnapshot,
  work: CrossrefWork,
): Promise<CrossrefWork | null> {
  const isbn = (
    work.ISBN?.[0] ??
    item.fields.ISBN?.split(/\s/)[0] ??
    ""
  ).replace(/[^0-9X]/gi, "");
  if (!isbn) return null;
  const types = ["book", "edited-book", "monograph", "reference-book"]
    .map((t) => `type:${t}`)
    .join(",");
  const result = await crossref<{ items: CrossrefWork[] }>(
    `/works?rows=1&select=${CROSSREF_SELECT}&filter=isbn:${isbn},${types}`,
  );
  return result?.items?.[0] ?? null;
}

/** A book's Open Library edition by ISBN, or null. */
async function findEdition(isbn: string): Promise<OpenLibraryEdition | null> {
  try {
    const xhr = await Zotero.HTTP.request(
      "GET",
      `https://openlibrary.org/isbn/${isbn}.json`,
      { responseType: "json", successCodes: [200, 404], timeout: 20000 },
    );
    return xhr.status === 200 ? xhr.response : null;
  } catch (e) {
    Zotero.debug(`Reference Check: Open Library ${isbn} failed: ${e}`);
    return null;
  }
}

export async function fillItems(selected: Zotero.Item[]) {
  const style = referenceStyle();
  const candidates = editableReferences(selected);
  const resolvedDois = await resolveShortDois(candidates, (count) =>
    getString("resolving-dois", { args: { count } }),
  );
  const toCheck = candidates
    .map((item) => ({
      item,
      snap: snapshot(item, resolvedDois.get(item.id)),
    }))
    .filter(({ snap }) => needsLookup(snap, style));

  if (!toCheck.length) {
    showResult(
      getString("fill-complete", { args: { count: selected.length } }),
    );
    return;
  }

  const planned: { item: Zotero.Item; plan: PlannedItem }[] = [];
  const incomplete: IncompleteItem[] = [];
  const progress = progressWindow(
    getString("fill-checking", { args: { count: toCheck.length } }),
  );
  // One request at a time, as Crossref asks of clients without an API key
  for (const [i, { item, snap }] of toCheck.entries()) {
    const work = await findWork(snap);
    let book: CrossrefWork | null = null;
    if (
      work &&
      snap.itemType === "bookSection" &&
      missingFields(snap, style).some((m) =>
        ["editor", "bookTitle", "publisher", "place"].includes(m),
      )
    ) {
      book = await findBook(snap, work);
    }

    const changes: FieldChange[] = work ? planFill(snap, work, book) : [];
    // Crossref rarely has a book's publisher or place; Open Library often
    // does, and an ISBN lookup can't pick the wrong book.
    const filled = withChanges(snap, changes);
    const isbn = bookIsbn(filled) || work?.ISBN?.[0]?.replace(/[^0-9X]/gi, "");
    if (isbn && wantsBookDetails(filled, style)) {
      const edition = await findEdition(isbn);
      if (edition) changes.push(...planBookFill(filled, edition));
    }
    const resolved = resolvedDois.get(item.id);
    if (resolved && cleanRules().shortDois) {
      changes.unshift({
        field: "DOI",
        from: field(item, "DOI"),
        to: resolved,
        reason: "short DOI",
      });
    }
    const citation = citationLabel(item);
    const title = field(item, "title");
    if (changes.length)
      planned.push({ item, plan: { citation, title, changes } });
    const missing = missingFields(withChanges(snap, changes), style);
    if (missing.length) {
      incomplete.push({ citation, title, missing, notFound: !work });
    }
    progress.changeLine({ progress: ((i + 1) / toCheck.length) * 100 });
  }
  progress.close();

  const report = incomplete.length
    ? [
        "",
        getString("fill-incomplete", { args: { count: incomplete.length } }),
        formatIncomplete(incomplete, 10, getString("fill-not-found")),
      ]
    : [];

  if (!planned.length) {
    if (incomplete.length) {
      alert(
        getString("fill-confirm-title"),
        [getString("fill-nothing"), ...report].join("\n"),
      );
    } else {
      showResult(
        getString("fill-complete", { args: { count: selected.length } }),
      );
    }
    return;
  }

  const plans = planned.map((p) => p.plan);
  const ok = confirm(
    getString("fill-confirm-title"),
    [
      getString("fill-confirm-intro", { args: { count: plans.length } }),
      "",
      formatPlan(plans),
      ...report,
      "",
      getString("fill-confirm-note"),
    ].join("\n"),
    getString("fill-confirm-button", { args: { count: plans.length } }),
  );
  if (!ok) return;

  const saved = await applyPlans(planned);
  showResult(getString("fill-done", { args: { count: saved } }));
}
