import { CLEAN_RULES, RuleSettings } from "../core/clean";
import { Style } from "../core/crossref";

function getPref(key: string): unknown {
  return Zotero.Prefs.get(`${addon.data.config.prefsPrefix}.${key}`, true);
}

/** Whether "Fill missing details" tags items that are still incomplete. */
export function tagPref(): boolean {
  return getPref("fill.tagIncomplete") !== false;
}

export function setTagPref(value: boolean) {
  Zotero.Prefs.set(
    `${addon.data.config.prefsPrefix}.fill.tagIncomplete`,
    value,
    true,
  );
}

export function referenceStyle(): Style {
  return getPref("style") === "chicago" ? "chicago" : "apa";
}

export function cleanRules(): RuleSettings {
  return Object.fromEntries(
    CLEAN_RULES.map((rule) => [rule, getPref(`clean.${rule}`) !== false]),
  );
}
