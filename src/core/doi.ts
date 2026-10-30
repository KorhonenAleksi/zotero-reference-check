/** DOI helpers shared by the clean-up and the Crossref fill-in. */

/** A shortDOI such as "10/gghcqk". */
export function isShortDoi(doi: string | undefined): boolean {
  return /^10\/[a-z0-9]+$/i.test(doi?.trim() ?? "");
}

/** The full DOI from a doi.org handle API response for a shortDOI. */
export function parseHandleAlias(response: unknown): string | null {
  const values = (response as { values?: unknown })?.values;
  if (!Array.isArray(values)) return null;
  for (const v of values) {
    const value = v?.type === "HS_ALIAS" ? v.data?.value : null;
    if (typeof value === "string" && /^10\.\d+\/\S+$/.test(value)) {
      // shortDOI stores DOIs upper-cased; DOIs are case-insensitive and
      // registries display them lower-case.
      return value.toLowerCase();
    }
  }
  return null;
}
