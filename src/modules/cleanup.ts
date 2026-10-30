import { formatPlan, PlannedItem, summarizeReasons } from "../core/changes";
import { ItemSnapshot, planCleanup } from "../core/clean";
import { getString } from "../utils/locale";
import { cleanRules } from "../utils/prefs";
import {
  applyPlans,
  citationLabel,
  confirm,
  editableReferences,
  field,
  hasField,
  resolveShortDois,
  showResult,
} from "./zotero";

function snapshot(item: Zotero.Item, resolvedDOI?: string): ItemSnapshot {
  return {
    itemType: item.itemType,
    url: field(item, "url"),
    DOI: hasField(item, "DOI") ? field(item, "DOI") : undefined,
    resolvedDOI,
    extra: field(item, "extra"),
    archive: field(item, "archive"),
    archiveLocation: field(item, "archiveLocation"),
    publicationTitle: field(item, "publicationTitle"),
    journalAbbreviation: field(item, "journalAbbreviation"),
    volume: field(item, "volume"),
    issue: hasField(item, "issue") ? field(item, "issue") : undefined,
    pages: field(item, "pages"),
    numPages: hasField(item, "numPages") ? field(item, "numPages") : undefined,
    title: field(item, "title"),
    creators: item.getCreators(),
    linkedUrls: Zotero.Items.get(item.getAttachments())
      .filter(
        (a) => a.attachmentLinkMode === Zotero.Attachments.LINK_MODE_LINKED_URL,
      )
      .map((a) => field(a, "url")),
  };
}

export async function cleanItems(selected: Zotero.Item[]) {
  const candidates = editableReferences(selected);
  const rules = cleanRules();
  const resolvedDois = rules.shortDois
    ? await resolveShortDois(candidates, (count) =>
        getString("resolving-dois", { args: { count } }),
      )
    : new Map<number, string>();

  const planned: { item: Zotero.Item; plan: PlannedItem }[] = [];
  for (const item of candidates) {
    const changes = planCleanup(
      snapshot(item, resolvedDois.get(item.id)),
      rules,
    );
    if (!changes.length) continue;
    planned.push({
      item,
      plan: {
        citation: citationLabel(item),
        title: field(item, "title"),
        changes,
      },
    });
  }

  if (!planned.length) {
    showResult(getString("clean-none", { args: { count: selected.length } }));
    return;
  }

  const plans = planned.map((p) => p.plan);
  const ok = confirm(
    getString("clean-confirm-title"),
    [
      getString("clean-confirm-intro", {
        args: { count: plans.length, reasons: summarizeReasons(plans) },
      }),
      "",
      formatPlan(plans),
      "",
      getString("clean-confirm-note"),
    ].join("\n"),
    getString("clean-confirm-button", { args: { count: plans.length } }),
  );
  if (!ok) return;

  const saved = await applyPlans(planned);
  showResult(getString("clean-done", { args: { count: saved } }));
}
