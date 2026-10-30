import { CLEAN_RULES, RuleSettings } from "../core/clean";
import { Style } from "../core/crossref";

function getPref(key: string): unknown {
  return Zotero.Prefs.get(`${addon.data.config.prefsPrefix}.${key}`, true);
}

export function referenceStyle(): Style {
  return getPref("style") === "chicago" ? "chicago" : "apa";
}

export function cleanRules(): RuleSettings {
  return Object.fromEntries(
    CLEAN_RULES.map((rule) => [rule, getPref(`clean.${rule}`) !== false]),
  );
}
