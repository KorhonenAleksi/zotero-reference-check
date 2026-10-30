/**
 * Pure rules for spotting URLs that should not appear in a reference list:
 * library-database links, institutional proxy links, and academic social
 * networks. No Zotero dependency, so everything here is unit-tested in Node
 * (test/unit/links.test.ts). The rules that decide what to change on an item
 * live in references.ts.
 *
 * APA 7 says not to include database URLs for works found in
 * academic research databases; the same goes for proxy links, which only
 * work for members of one university.
 */

export type LinkKind = "database" | "proxy" | "network";

export interface LinkMatch {
  kind: LinkKind;
  /** Human-readable source shown in the confirmation, e.g. "EBSCO". */
  source: string;
  host: string;
}

const DATABASES: [RegExp, string][] = [
  [/(^|\.)ebscohost\.com$/, "EBSCO"],
  [/(^|\.)ebsco\.com$/, "EBSCO"],
  [/(^|\.)proquest\.com$/, "ProQuest"],
  [/(^|\.)jstor\.org$/, "JSTOR"],
  [/(^|\.)gale\.com$/, "Gale"],
  [/(^|\.)galegroup\.com$/, "Gale"],
  [/(^|\.)webofscience\.com$/, "Web of Science"],
  [/(^|\.)webofknowledge\.com$/, "Web of Science"],
  [/(^|\.)scopus\.com$/, "Scopus"],
  [/(^|\.)nexisuni\.com$/, "Nexis Uni"],
  [/(^|\.)factiva\.com$/, "Factiva"],
];

const NETWORKS: [RegExp, string][] = [
  [/(^|\.)researchgate\.net$/, "ResearchGate"],
  [/(^|\.)academia\.edu$/, "Academia.edu"],
  [/(^|\.)semanticscholar\.org$/, "Semantic Scholar"],
  [/(^|\.)scholar\.google\.[a-z.]+$/, "Google Scholar"],
];

// Proxy hosts rewrite the publisher's host ("www.jstor.org.libproxy.example.edu"),
// so they are checked before the database list.
const PROXY_HOSTS = [
  /(^|[.-])(lib)?proxy[0-9]*\./,
  /(^|[.-])ezp(roxy)?[0-9]*[.-]/,
  /\.idm\.oclc\.org$/,
];
const PROXY_PATHS = [/\/login\?(qurl|url)=/i];

/**
 * Item types whose reference-list entry should not carry a database link.
 * Web pages, blog posts, datasets, software etc. are excluded: for those the
 * URL is the point.
 */
export const CLEANABLE_TYPES = new Set([
  "journalArticle",
  "conferencePaper",
  "book",
  "bookSection",
  "thesis",
  "report",
  "magazineArticle",
  "newspaperArticle",
  "encyclopediaArticle",
]);

function parseUrl(url: string): URL | null {
  let s = url.trim();
  // Some imports store links without a scheme ("www.jstor.org/stable/1")
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(s)) s = `https://${s}`;
  try {
    const parsed = new URL(s);
    return /^https?:$/.test(parsed.protocol) ? parsed : null;
  } catch {
    return null;
  }
}

/** Classifies a URL, or returns null when it is an ordinary link to keep. */
export function classifyLink(url: string | null | undefined): LinkMatch | null {
  if (!url) return null;
  const parsed = parseUrl(url);
  if (!parsed) return null;
  const host = parsed.hostname.toLowerCase();

  if (
    PROXY_HOSTS.some((re) => re.test(host)) ||
    PROXY_PATHS.some((re) => re.test(parsed.pathname + parsed.search))
  ) {
    return { kind: "proxy", source: "Library proxy", host };
  }
  for (const [re, source] of DATABASES) {
    if (re.test(host)) return { kind: "database", source, host };
  }
  for (const [re, source] of NETWORKS) {
    if (re.test(host)) return { kind: "network", source, host };
  }
  return null;
}

function shorten(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

/** A URL without scheme and "www.", shortened for display. */
export function displayLink(url: string, max = 70): string {
  return shorten(
    url
      .trim()
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, ""),
    max,
  );
}
