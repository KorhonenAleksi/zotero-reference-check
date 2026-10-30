import { describe, expect, it } from "vitest";
import {
  describeChange,
  FieldChange,
  formatPlan,
  logRow,
  PlannedItem,
  summarizeReasons,
} from "../../src/core/changes";
import {
  cleanCatalogueTitle,
  cleanJournalName,
  isAccessionNumber,
  isArchiveScan,
  isBogusPages,
  isDatabaseName,
  ItemSnapshot,
  planCleanup as planChanges,
  RuleSettings,
  splitVolumeIssue,
} from "../../src/core/clean";
import { isShortDoi, parseHandleAlias } from "../../src/core/doi";

const article = (fields: Partial<ItemSnapshot>): ItemSnapshot => ({
  itemType: "journalArticle",
  ...fields,
});

const changed = (item: ItemSnapshot, rules?: RuleSettings) =>
  Object.fromEntries(planChanges(item, rules).map((c) => [c.field, c.to]));

describe("database links", () => {
  const ebsco = "https://search.ebscohost.com/login.aspx?AN=1";

  it("removes database links from articles without a DOI", () => {
    expect(planChanges(article({ url: ebsco }))).toEqual([
      { field: "url", from: ebsco, to: "", reason: "database link" },
    ]);
    expect(
      changed({
        itemType: "book",
        url: "https://ebookcentral.proquest.com/lib/example/detail.action?docID=1",
      }),
    ).toEqual({ url: "" });
  });

  it("leaves links on items with a DOI alone", () => {
    expect(planChanges(article({ url: ebsco, DOI: "10.1002/smj.1" }))).toEqual(
      [],
    );
    expect(
      planChanges({
        itemType: "bookSection",
        url: ebsco,
        extra: "Place: London\nDOI: 10.4135/9781446200",
      }),
    ).toEqual([]);
  });

  it("treats a blank DOI as missing", () => {
    expect(changed(article({ url: ebsco, DOI: "  " }))).toEqual({ url: "" });
  });

  it("leaves item types where the URL is the point", () => {
    expect(planChanges({ itemType: "webpage", url: ebsco })).toEqual([]);
    expect(planChanges({ itemType: "blogPost", url: ebsco })).toEqual([]);
    expect(
      planChanges({ itemType: "attachment", url: ebsco, archive: "JSTOR" }),
    ).toEqual([]);
  });
});

describe("Internet Archive scans", () => {
  const chandler = "http://archive.org/details/strategystructur00chan_0";

  it("recognises book scans, not Wayback copies", () => {
    expect(isArchiveScan(chandler)).toBe(true);
    expect(isArchiveScan("https://www.archive.org/stream/x/x_djvu.txt")).toBe(
      true,
    );
    expect(
      isArchiveScan("https://web.archive.org/web/2001/https://x.org/report"),
    ).toBe(false);
    expect(isArchiveScan("https://archive.org.example.com/details/x")).toBe(
      false,
    );
    expect(isArchiveScan("https://example.org/archive.org/details/x")).toBe(
      false,
    );
  });

  it("moves a book's scan link to a link attachment", () => {
    expect(planChanges({ itemType: "book", url: chandler })).toEqual([
      {
        field: "url",
        from: chandler,
        to: "",
        reason: "archive link",
        attachLink: chandler,
      },
    ]);
  });

  it("does not attach a link the item already has", () => {
    expect(
      planChanges({ itemType: "book", url: chandler, linkedUrls: [chandler] }),
    ).toEqual([
      { field: "url", from: chandler, to: "", reason: "archive link" },
    ]);
  });

  it("leaves other item types, Wayback links and items with a DOI alone", () => {
    expect(planChanges(article({ url: chandler }))).toEqual([]);
    expect(
      planChanges({
        itemType: "report",
        url: "https://web.archive.org/web/2001/https://x.org/report.pdf",
      }),
    ).toEqual([]);
    expect(
      planChanges({ itemType: "book", url: chandler, DOI: "10.1/x" }),
    ).toEqual([]);
  });
});

describe("rule settings", () => {
  const item = article({
    url: "https://www.jstor.org/stable/1",
    archive: "JSTOR",
    pages: "0",
  });

  it("runs every rule by default", () => {
    expect(changed(item)).toEqual({ url: "", archive: "", pages: "" });
  });

  it("skips rules switched off", () => {
    expect(changed(item, { databaseLinks: false, pages: false })).toEqual({
      archive: "",
    });
    expect(
      planChanges(
        {
          itemType: "book",
          creators: [{ firstName: "with an introduction by Keith" }],
        },
        { catalogueNames: false },
      ),
    ).toEqual([]);
  });
});

describe("database names and accession numbers", () => {
  it("recognises database names in Archive", () => {
    for (const name of [
      "Business Source Ultimate",
      "Business Source Complete",
      "JSTOR",
      "ProQuest Central; Social Science Premium Collection",
      "ABI/INFORM Collection",
      "APA PsycArticles",
      "bsh",
    ]) {
      expect(isDatabaseName(name), name).toBe(true);
    }
    expect(isDatabaseName("Bodleian Library")).toBe(false);
    expect(isDatabaseName("")).toBe(false);
  });

  it("recognises accession numbers in Loc. in Archive", () => {
    for (const id of [
      "174326664",
      "203397705; 00609030",
      "WOS:A1995RR91800003",
      "1996-06258-007",
    ]) {
      expect(isAccessionNumber(id), id).toBe(true);
    }
    for (const loc of ["Box 12, Folder 3", "MS 1234", "1957"]) {
      expect(isAccessionNumber(loc), loc).toBe(false);
    }
  });

  it("clears both, even when the item has a DOI", () => {
    expect(
      changed(
        article({
          archive: "Business Source Ultimate",
          archiveLocation: "174326664",
          DOI: "10.1/x",
        }),
      ),
    ).toEqual({ archive: "", archiveLocation: "" });
  });

  it("clears any location stored with a database name", () => {
    expect(
      changed(
        article({
          archive: "ProQuest Central",
          archiveLocation: "32987935; 200903-B7-0026596 (MB)",
        }),
      ),
    ).toEqual({ archive: "", archiveLocation: "" });
  });

  it("keeps real archive locations", () => {
    expect(
      planChanges(
        article({ archive: "Bodleian Library", archiveLocation: "Box 12" }),
      ),
    ).toEqual([]);
  });
});

describe("cleanJournalName", () => {
  it("drops publisher and coverage suffixes", () => {
    expect(
      cleanJournalName(
        "Strategic Management Journal (Wiley-Blackwell) - 1980 to 2009",
      ),
    ).toBe("Strategic Management Journal");
    expect(
      cleanJournalName(
        "Strategic Management Journal (John Wiley & Sons, Inc.) - 1980 to 2009",
      ),
    ).toBe("Strategic Management Journal");
    expect(
      cleanJournalName("Journal of Management Studies (Wiley-Blackwell)"),
    ).toBe("Journal of Management Studies");
    expect(cleanJournalName("Organization Science (INFORMS)")).toBe(
      "Organization Science",
    );
    expect(cleanJournalName("Sloan Management Review  (1986-1998)")).toBe(
      "Sloan Management Review",
    );
  });

  it("gives Academy of Management journals their own titles", () => {
    expect(cleanJournalName("The Academy of Management Journal")).toBe(
      "Academy of Management Journal",
    );
    expect(cleanJournalName("The Academy of Management review")).toBe(
      "Academy of Management Review",
    );
    expect(
      cleanJournalName(
        "Academy of Management. The Academy of Management Review  (pre-1986)",
      ),
    ).toBe("Academy of Management Review");
    expect(
      cleanJournalName("Academy of Management Learning and Education"),
    ).toBe("Academy of Management Learning & Education");
  });

  it("keeps other names as they are", () => {
    for (const name of [
      "The Leadership Quarterly",
      "The Economic Journal",
      "Organization science (Providence, R.I.)",
      "Journal of Institutional and Theoretical Economics (JITE) / Zeitschrift für die gesamte Staatswissenschaft",
      "Toward a (More) Comprehensive CPA Framework",
    ]) {
      expect(cleanJournalName(name)).toBe(name);
    }
  });

  it("cleans the publication and its abbreviation", () => {
    const name = "Journal of Management Studies (Wiley-Blackwell)";
    expect(
      changed(article({ publicationTitle: name, journalAbbreviation: name })),
    ).toEqual({
      publicationTitle: "Journal of Management Studies",
      journalAbbreviation: "Journal of Management Studies",
    });
  });
});

describe("pages", () => {
  it("recognises page 0 and article IDs", () => {
    expect(isBogusPages("0")).toBe(true);
    expect(isBogusPages("00018392251355283")).toBe(true);
    expect(isBogusPages("amle.2024.0416", "10.5465/amle.2024.0416")).toBe(true);
    expect(isBogusPages("1467-8551.12781", "10.1111/1467-8551.12781")).toBe(
      true,
    );
  });

  it("keeps page ranges and short article numbers", () => {
    for (const pages of ["305-329", "101381", "e12345", "S35", "NP28-NP34"]) {
      expect(isBogusPages(pages, "10.1016/j.jwb.2022.101381"), pages).toBe(
        false,
      );
    }
  });

  it("keeps an article number that is only the last part of the DOI", () => {
    expect(isBogusPages("P10008", "10.1088/1742-5468/2008/10/P10008")).toBe(
      false,
    );
  });

  it("clears them on the item", () => {
    expect(changed({ itemType: "bookSection", pages: "0" })).toEqual({
      pages: "",
    });
  });
});

describe("DOI in Extra", () => {
  const extra = "Place: Oxford\nDOI: 10.1093/acprof:oso/9780199646890.003.0013";

  it("moves it to the DOI field when the type has one", () => {
    expect(changed({ itemType: "bookSection", DOI: "", extra })).toEqual({
      DOI: "10.1093/acprof:oso/9780199646890.003.0013",
      extra: "Place: Oxford",
    });
  });

  it("leaves it in Extra when the type has no DOI field or one is set", () => {
    expect(planChanges({ itemType: "bookSection", extra })).toEqual([]);
    expect(
      planChanges({ itemType: "bookSection", DOI: "10.1/x", extra }),
    ).toEqual([]);
  });
});

describe("volume and issue", () => {
  it("splits an issue imported into Volume", () => {
    expect(splitVolumeIssue("44(6)")).toEqual(["44", "6"]);
    expect(splitVolumeIssue("12 (3-4)")).toEqual(["12", "3-4"]);
    expect(splitVolumeIssue("44")).toBeNull();
    expect(splitVolumeIssue("Supplement (1)")).toBeNull();
  });

  it("only when Issue is empty", () => {
    expect(changed(article({ volume: "44(6)", issue: "" }))).toEqual({
      volume: "44",
      issue: "6",
    });
    expect(planChanges(article({ volume: "44(6)", issue: "5" }))).toEqual([]);
    // A type without an Issue field
    expect(planChanges({ itemType: "book", volume: "44(6)" })).toEqual([]);
  });
});

describe("page counts in Extra", () => {
  it("moves a book's page count to # of Pages", () => {
    expect(
      changed({ itemType: "book", extra: "Pages: 344 Pages", numPages: "" }),
    ).toEqual({ extra: "", numPages: "344" });
  });

  it("only removes the line when # of Pages is filled or missing", () => {
    expect(
      changed({ itemType: "book", extra: "Pages: 344", numPages: "350" }),
    ).toEqual({ extra: "" });
    expect(
      changed(article({ extra: "Pages: 20\nPlace: Briarcliff Manor" })),
    ).toEqual({ extra: "Place: Briarcliff Manor" });
  });

  it("keeps page ranges", () => {
    expect(planChanges(article({ extra: "Pages: 315-331" }))).toEqual([]);
  });
});

describe("catalogue titles and creator names", () => {
  it("turns a catalogue semicolon into a subtitle colon", () => {
    expect(
      cleanCatalogueTitle(
        "Leadership in Administration; a Sociological Interpretation",
      ),
    ).toBe("Leadership in Administration: A Sociological Interpretation");
    const porter =
      "Competitive Strategy: Techniques for Analyzing Industries and Competitors ; with a New Introduction";
    expect(cleanCatalogueTitle(porter)).toBe(porter);
  });

  it("only changes book titles", () => {
    expect(planChanges(article({ title: "Mind; a quarterly review" }))).toEqual(
      [],
    );
  });

  it("drops role phrases from creator names", () => {
    expect(
      planChanges({
        itemType: "book",
        creators: [
          { firstName: "Reinhart", lastName: "Koselleck" },
          { firstName: "with an introduction by Keith", lastName: "Tribe" },
        ],
      }),
    ).toEqual([
      {
        field: "firstName",
        creatorIndex: 1,
        from: "with an introduction by Keith",
        to: "Keith",
        reason: "creator name",
      },
    ]);
  });
});

describe("short DOIs", () => {
  it("recognises short DOIs", () => {
    expect(isShortDoi("10/gghcqk")).toBe(true);
    expect(isShortDoi("10.1002/smj.1")).toBe(false);
    expect(isShortDoi("")).toBe(false);
  });

  it("reads the full DOI from the doi.org handle API", () => {
    expect(
      parseHandleAlias({
        responseCode: 1,
        handle: "10/gtp6vf",
        values: [
          { index: 100, type: "HS_ADMIN", data: { format: "admin" } },
          {
            index: 1,
            type: "HS_ALIAS",
            data: { format: "string", value: "10.1016/J.JWB.2022.101381" },
          },
        ],
      }),
    ).toBe("10.1016/j.jwb.2022.101381");
    expect(parseHandleAlias({ responseCode: 100 })).toBeNull();
    expect(parseHandleAlias(null)).toBeNull();
  });

  it("replaces a resolved short DOI and checks pages against it", () => {
    expect(
      changed(
        article({
          DOI: "10/abc",
          resolvedDOI: "10.5465/amle.2024.0416",
          pages: "amle.2024.0416",
        }),
      ),
    ).toEqual({ DOI: "10.5465/amle.2024.0416", pages: "" });
  });

  it("leaves an unresolved short DOI alone", () => {
    expect(planChanges(article({ DOI: "10/abc" }))).toEqual([]);
  });
});

describe("confirmation text", () => {
  const item = (n: number, changes: FieldChange[]): PlannedItem => ({
    citation: `Author${n} (2001)`,
    title: `Title ${n}`,
    changes,
  });
  const url: FieldChange = {
    field: "url",
    from: "https://www.jstor.org/stable/1",
    to: "",
    reason: "database link",
  };

  it("lists each item with its changes, capped", () => {
    const list = formatPlan(
      Array.from({ length: 12 }, (_, i) => item(i + 1, [url])),
      10,
    );
    const lines = list.split("\n");
    expect(lines).toHaveLength(21);
    expect(lines[0]).toBe("• Author1 (2001) — Title 1");
    expect(lines[1]).toBe("    ✕ URL: jstor.org/stable/1");
    expect(lines[20]).toBe("…and 2 more");
  });

  it("describes each kind of change", () => {
    expect(
      describeChange({
        field: "publicationTitle",
        from: "Organization Science (INFORMS)",
        to: "Organization Science",
        reason: "journal name",
      }),
    ).toEqual([
      "Publication: Organization Science (INFORMS) → Organization Science",
    ]);
    expect(
      describeChange({
        field: "url",
        from: "http://archive.org/details/x",
        to: "",
        reason: "archive link",
        attachLink: "http://archive.org/details/x",
      }),
    ).toEqual(["→ URL moved to a link attachment: archive.org/details/x"]);
    expect(
      describeChange({
        field: "volume",
        from: "",
        to: "44",
        reason: "Crossref",
      }),
    ).toEqual(["+ Volume: 44"]);
    expect(
      describeChange({
        field: "extra",
        from: "Place: London\nPages: 344 Pages",
        to: "Place: London\nInternet Archive: http://archive.org/details/x",
        reason: "page count",
      }),
    ).toEqual([
      "✕ Extra: Pages: 344 Pages",
      "+ Extra: Internet Archive: http://archive.org/details/x",
    ]);
    expect(
      describeChange({
        field: "extra",
        from: "",
        to: "Internet Archive: http://archive.org/details/x",
        reason: "archive link",
      }),
    ).toEqual(["+ Extra: Internet Archive: http://archive.org/details/x"]);
  });

  it("summarises reasons by item count", () => {
    const archive: FieldChange = {
      field: "archive",
      from: "JSTOR",
      to: "",
      reason: "database name",
    };
    expect(
      summarizeReasons([
        item(1, [url, archive]),
        item(2, [archive]),
        item(3, [archive]),
      ]),
    ).toBe("database name 3, database link 1");
  });
});

describe("logRow", () => {
  it("writes a CSV line, quoting fields with commas or quotes", () => {
    expect(
      logRow("2026-10-30T20:00:00.000Z", "1/ABCD2345", "journalArticle", {
        field: "publicationTitle",
        from: "Strategic Management Journal (John Wiley & Sons, Inc.)",
        to: "Strategic Management Journal",
        reason: "journal name",
      }),
    ).toBe(
      '2026-10-30T20:00:00.000Z,1/ABCD2345,journalArticle,journal name,publicationTitle,"Strategic Management Journal (John Wiley & Sons, Inc.)",Strategic Management Journal',
    );
  });

  it("names the creator for creator changes", () => {
    expect(
      logRow("t", "1/K", "book", {
        field: "firstName",
        creatorIndex: 1,
        from: "with an introduction by Keith",
        to: "Keith",
        reason: "creator name",
      }),
    ).toBe(
      "t,1/K,book,creator name,creator2.firstName,with an introduction by Keith,Keith",
    );
  });
});
