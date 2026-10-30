/**
 * Zotero plumbing shared by both commands: reading fields, the shortDOI
 * lookup, the confirmation dialog, the change log, and saving changes.
 */

import { FieldChange, LOG_HEADER, logRow, PlannedItem } from "../core/changes";
import { ARCHIVE_ATTACHMENT_TITLE } from "../core/clean";
import { isShortDoi, parseHandleAlias } from "../core/doi";
import { CLEANABLE_TYPES } from "../core/links";

export function citationLabel(item: Zotero.Item): string {
  const creator = item.getField("firstCreator") as string;
  // Multipart date: "1999-00-00 1999"
  const year = (item.getField("date", true, true) as string).slice(0, 4);
  const yearLabel = /^\d{4}$/.test(year) && year !== "0000" ? year : "n.d.";
  return `${creator || "Anonymous"} (${yearLabel})`;
}

export function hasField(item: Zotero.Item, name: string): boolean {
  const id = Zotero.ItemFields.getID(name);
  return !!id && Zotero.ItemFields.isValidForType(id, item.itemTypeID);
}

export function field(item: Zotero.Item, name: string): string {
  try {
    return (item.getField(name) as string) ?? "";
  } catch {
    // Field not valid for this item type
    return "";
  }
}

/** Selected items both commands may change. */
export function editableReferences(selected: Zotero.Item[]): Zotero.Item[] {
  return selected.filter(
    (item) =>
      item.isRegularItem() &&
      CLEANABLE_TYPES.has(item.itemType) &&
      Zotero.Libraries.isEditable(item.libraryID),
  );
}

export function progressWindow(text: string) {
  return new ztoolkit.ProgressWindow(addon.data.config.addonName, {
    closeOnClick: true,
    closeTime: -1,
  })
    .createLine({ text, type: "default", progress: 0 })
    .show();
}

export function showResult(text: string) {
  new ztoolkit.ProgressWindow(addon.data.config.addonName, {
    closeOnClick: true,
    closeTime: 5000,
  })
    .createLine({ text, type: "success" })
    .show();
}

/** The full DOI for a shortDOI via the doi.org handle API, or null. */
async function resolveShortDoi(doi: string): Promise<string | null> {
  try {
    const xhr = await Zotero.HTTP.request(
      "GET",
      `https://doi.org/api/handles/${doi.trim()}`,
      { responseType: "json", successCodes: [200], timeout: 15000 },
    );
    return parseHandleAlias(xhr.response);
  } catch (e) {
    Zotero.debug(`Reference Check: could not resolve ${doi}: ${e}`);
    return null;
  }
}

/** Full DOIs for the items whose DOI field holds a shortDOI, by item ID. */
export async function resolveShortDois(
  items: Zotero.Item[],
  message: (count: number) => string,
): Promise<Map<number, string>> {
  const resolved = new Map<number, string>();
  const queue = items.filter((item) => isShortDoi(field(item, "DOI")));
  if (!queue.length) return resolved;

  const progress = progressWindow(message(queue.length));
  // A few lookups at a time, to be polite to doi.org
  const workers = Array.from({ length: 6 }, async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const full = await resolveShortDoi(field(item, "DOI"));
      if (full) resolved.set(item.id, full);
    }
  });
  await Promise.all(workers);
  progress.close();
  return resolved;
}

/**
 * Shows the confirmation; true when the user clicked the action button.
 * With `checkbox`, its state is written back to `checkbox.value`.
 */
export function confirm(
  title: string,
  text: string,
  button: string,
  checkbox?: { label: string; value: boolean },
): boolean {
  const ps = Services.prompt;
  // The gecko typings mark these constants optional; they always exist.
  const flags =
    ps.BUTTON_POS_0! * ps.BUTTON_TITLE_IS_STRING! +
    ps.BUTTON_POS_1! * ps.BUTTON_TITLE_CANCEL! +
    // Cancel is the default button, so Enter never changes anything by accident
    ps.BUTTON_POS_1_DEFAULT!;
  const choice = ps.confirmEx(
    Zotero.getMainWindow() as unknown as mozIDOMWindowProxy,
    title,
    text,
    flags,
    button,
    "",
    "",
    // An empty checkbox label hides the checkbox
    checkbox?.label ?? "",
    checkbox ?? { value: false },
  );
  return choice === 0;
}

/** An alert with a checkbox, whose state is written back to `checkbox.value`. */
export function alertCheck(
  title: string,
  text: string,
  checkbox: { label: string; value: boolean },
) {
  Services.prompt.alertCheck(
    Zotero.getMainWindow() as unknown as mozIDOMWindowProxy,
    title,
    text,
    checkbox.label,
    checkbox,
  );
}

export const LOG_FILE = "reference-check-log.csv";

/**
 * Whether the item still holds the value a change was planned from. It may
 * not, if the item was edited (or another command saved) while the
 * confirmation was open; such a change is skipped rather than undoing that
 * edit.
 */
function isCurrent(item: Zotero.Item, c: FieldChange): boolean {
  const creators = item.getCreators();
  if (c.addCreators) {
    const type = c.addCreators[0]?.creatorType;
    return !creators.some(
      (cr) => Zotero.CreatorTypes.getName(cr.creatorTypeID) === type,
    );
  }
  if (c.creatorIndex !== undefined) {
    const creator = creators[c.creatorIndex] as unknown as
      Record<string, unknown> | undefined;
    return creator?.[c.field] === c.from;
  }
  return field(item, c.field) === c.from;
}

/** Logs, then saves every planned change. Returns the number of items saved. */
export async function applyPlans(
  planned: { item: Zotero.Item; plan: PlannedItem }[],
): Promise<number> {
  const current = planned
    .map(({ item, plan }) => ({
      item,
      plan: {
        ...plan,
        changes: plan.changes.filter((c) => isCurrent(item, c)),
      },
    }))
    .filter(({ plan }) => plan.changes.length);

  // Log before changing anything, so every old value can be restored.
  await appendToLog(current);

  let saved = 0;
  for (const { item, plan } of current) {
    const changes = await attachLinks(item, plan.changes);
    applyChanges(item, changes);
    await item.saveTx();
    Zotero.debug(
      `Reference Check: ${[...new Set(plan.changes.map((c) => c.reason))].join(", ")} in ${item.libraryKey}`,
    );
    saved++;
  }
  return saved;
}

/**
 * Creates the link attachments changes ask for. A change whose attachment
 * could not be created is dropped, so its URL stays in the field.
 */
async function attachLinks(
  item: Zotero.Item,
  changes: FieldChange[],
): Promise<FieldChange[]> {
  const kept: FieldChange[] = [];
  for (const c of changes) {
    if (c.attachLink) {
      try {
        await Zotero.Attachments.linkFromURL({
          url: c.attachLink,
          parentItemID: item.id,
          title: ARCHIVE_ATTACHMENT_TITLE,
        });
      } catch (e) {
        Zotero.logError(e as Error);
        continue;
      }
    }
    kept.push(c);
  }
  return kept;
}

function applyChanges(item: Zotero.Item, changes: FieldChange[]) {
  const creators: object[] = item.getCreators();
  let creatorsChanged = false;
  for (const c of changes) {
    if (c.addCreators) {
      creators.push(...c.addCreators);
      creatorsChanged = true;
    } else if (c.creatorIndex !== undefined) {
      (creators[c.creatorIndex] as Record<string, unknown>)[c.field] = c.to;
      creatorsChanged = true;
    } else {
      item.setField(c.field, c.to);
    }
  }
  if (creatorsChanged) {
    item.setCreators(creators as _ZoteroTypes.Item.CreatorJSON[]);
  }
}

async function appendToLog(
  planned: { item: Zotero.Item; plan: PlannedItem }[],
) {
  const path = PathUtils.join(Zotero.DataDirectory.dir, LOG_FILE);
  const changedAt = new Date().toISOString();
  const rows = planned.flatMap(({ item, plan }) =>
    plan.changes.map((c) =>
      logRow(changedAt, item.libraryKey, item.itemType, c),
    ),
  );
  if (!(await IOUtils.exists(path))) rows.unshift(LOG_HEADER);
  await IOUtils.writeUTF8(path, rows.join("\n") + "\n", {
    mode: "appendOrCreate",
  });
}
