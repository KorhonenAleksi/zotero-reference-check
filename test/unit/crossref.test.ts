import { describe, expect, it } from "vitest";
import {
  bookIsbn,
  cleanPlace,
  CrossrefWork,
  describeMissing,
  FillSnapshot,
  formatDate,
  formatIncomplete,
  isSameWork,
  missingFields,
  needsLookup,
  pickMatch,
  planBookFill,
  planFill,
  searchQuery,
  titlesMatch,
  wantsBookDetails,
  withChanges,
} from "../../src/core/crossref";
import clioBook from "./fixtures/clio-book.json";
import clioSearch from "./fixtures/clio-search.json";
import heller from "./fixtures/heller.json";
import kippingBook from "./fixtures/kipping-book.json";
import kippingChapter from "./fixtures/kipping-chapter.json";

// Real Crossref responses (test/unit/fixtures), trimmed to CROSSREF_SELECT.

const BOOK_SECTION_FIELDS = [
  "title",
  "bookTitle",
  "publisher",
  "place",
  "date",
  "pages",
  "ISBN",
  "url",
  "extra",
];

function bookSection(
  fields: Record<string, string>,
  creators: FillSnapshot["creators"] = [],
  doi?: string,
): FillSnapshot {
  return {
    itemType: "bookSection",
    fields: {
      ...Object.fromEntries(BOOK_SECTION_FIELDS.map((f) => [f, ""])),
      ...fields,
    },
    creators,
    doi,
  };
}

const kipping = bookSection(
  {
    title: "Analyzing and Interpreting Historical Sources: A Basic Methodology",
    bookTitle: "Organizations in Time: History, Theory, Methods",
    publisher: "Oxford University Press",
    date: "2013-12-12",
    pages: "",
    extra: "DOI: 10.1093/acprof:oso/9780199646890.003.0013",
  },
  [
    { firstName: "Matthias", lastName: "Kipping", creatorType: "author" },
    { firstName: "R. Daniel", lastName: "Wadhwani", creatorType: "author" },
    { firstName: "Marcelo", lastName: "Bucheli", creatorType: "author" },
  ],
  "10.1093/acprof:oso/9780199646890.003.0013",
);

const clio = bookSection(
  {
    title:
      "Clio’s Toolkit: The Practice of Historical Methods in Organization Studies",
    bookTitle:
      "The Routledge Companion to Qualitative Research in Organization Studies",
    publisher: "Routledge",
    date: "2017",
    extra: "Num Pages: 15",
  },
  [
    { firstName: "R. Daniel", lastName: "Wadhwani", creatorType: "author" },
    { firstName: "Stephanie", lastName: "Decker", creatorType: "author" },
  ],
);

function article(
  fields: Record<string, string>,
  creators: FillSnapshot["creators"] = [],
  doi?: string,
): FillSnapshot {
  return {
    itemType: "journalArticle",
    fields: {
      title: "",
      publicationTitle: "",
      volume: "",
      issue: "",
      pages: "",
      date: "",
      DOI: doi ?? "",
      extra: "",
      ...fields,
    },
    creators,
    doi,
  };
}

describe("missingFields", () => {
  it("lists what the item type needs and lacks", () => {
    expect(missingFields(kipping)).toEqual(["editor", "pages"]);
    expect(missingFields(article({ title: "x", date: "2020" }))).toEqual([
      "author",
      "publicationTitle",
      "volume",
      "pages",
    ]);
  });

  it("accepts either of two alternatives", () => {
    const book: FillSnapshot = {
      itemType: "book",
      fields: { title: "T", date: "1957", publisher: "Harper" },
      creators: [{ lastName: "Mir", creatorType: "editor" }],
    };
    expect(missingFields(book)).toEqual([]);
    expect(missingFields({ ...book, creators: [] })).toEqual(["author|editor"]);
    expect(describeMissing(["author|editor", "pages"])).toBe(
      "Author or Editor, Pages",
    );
  });

  it("ignores fields the type doesn't have", () => {
    expect(
      missingFields({
        itemType: "journalArticle",
        fields: { title: "T", date: "2020", publicationTitle: "J" },
        creators: [{ lastName: "A", creatorType: "author" }],
      }),
    ).toEqual([]);
  });
});

describe("Chicago", () => {
  const book: FillSnapshot = {
    itemType: "book",
    fields: { title: "T", date: "1962", publisher: "MIT Press", place: "" },
    creators: [{ lastName: "Chandler", creatorType: "author" }],
  };

  it("also needs the place of publication", () => {
    expect(missingFields(book)).toEqual([]);
    expect(missingFields(book, "chicago")).toEqual(["place"]);
    expect(needsLookup(book)).toBe(false);
    expect(needsLookup(book, "chicago")).toBe(true);
  });

  it("asks Open Library only for what the style needs", () => {
    const withIsbn = {
      ...book,
      fields: { ...book.fields, ISBN: "0-262-53009-0" },
    };
    expect(wantsBookDetails(withIsbn)).toBe(false);
    expect(wantsBookDetails(withIsbn, "chicago")).toBe(true);
    expect(bookIsbn(withIsbn)).toBe("0262530090");
    expect(
      bookIsbn({
        ...book,
        fields: { ISBN: "978-0-19-964689-0 9780199646906" },
      }),
    ).toBe("9780199646890");
  });
});

describe("cleanPlace", () => {
  it("takes the place out of catalogue-style data", () => {
    expect(cleanPlace("1 Edition. | New York : Routledge, [2017]")).toBe(
      "New York",
    );
    expect(cleanPlace("Abingdon, Oxon; New York, NY: Routledge, 2021. |")).toBe(
      "Abingdon, Oxon",
    );
    expect(cleanPlace("[Helena, MT?")).toBe("Helena, MT");
    expect(cleanPlace("Cambridge, Mass")).toBe("Cambridge, Mass");
    expect(cleanPlace("Cham")).toBe("Cham");
  });

  it("gives up on anything that isn't a place", () => {
    expect(cleanPlace("2017")).toBe("");
    expect(cleanPlace("")).toBe("");
  });
});

describe("planBookFill", () => {
  const book: FillSnapshot = {
    itemType: "book",
    fields: { title: "T", publisher: "", place: "" },
    creators: [],
  };

  it("fills publisher and place from Open Library", () => {
    expect(
      planBookFill(book, {
        publishers: ["M.I.T. Press"],
        publish_places: ["Cambridge, Mass"],
      }),
    ).toEqual([
      {
        field: "publisher",
        from: "",
        to: "M.I.T. Press",
        reason: "Open Library",
      },
      {
        field: "place",
        from: "",
        to: "Cambridge, Mass",
        reason: "Open Library",
      },
    ]);
  });

  it("never overwrites", () => {
    expect(
      planBookFill(
        {
          ...book,
          fields: {
            ...book.fields,
            publisher: "MIT Press",
            place: "Cambridge, MA",
          },
        },
        { publishers: ["M.I.T. Press"], publish_places: ["Cambridge, Mass"] },
      ),
    ).toEqual([]);
  });
});

describe("needsLookup", () => {
  const complete = article(
    {
      title: "T",
      date: "2020",
      publicationTitle: "J",
      volume: "1",
      pages: "1-2",
    },
    [{ lastName: "A", creatorType: "author" }],
  );

  it("looks up incomplete items and articles without a DOI", () => {
    expect(needsLookup(complete)).toBe(true);
    expect(needsLookup({ ...complete, doi: "10.1/x" })).toBe(false);
    expect(needsLookup(kipping)).toBe(true);
  });
});

describe("matching search results", () => {
  it("matches a title Crossref has without its subtitle", () => {
    expect(
      titlesMatch(clio.fields.title, clioSearch.items[0] as CrossrefWork),
    ).toBe(true);
  });

  it("does not match a different work with a similar title", () => {
    expect(
      titlesMatch("Clio’s Battles", clioSearch.items[0] as CrossrefWork),
    ).toBe(false);
    // A one-word main title is too weak on its own
    expect(
      titlesMatch("Introduction: Something Else", {
        DOI: "x",
        title: ["Introduction"],
      }),
    ).toBe(false);
  });

  it("picks the chapter out of the search results", () => {
    expect(pickMatch(clio, clioSearch.items as CrossrefWork[])?.DOI).toBe(
      "10.4324/9781315686103-8",
    );
  });

  it("requires a shared author and a close year", () => {
    const work = clioSearch.items[0] as CrossrefWork;
    expect(isSameWork(clio, work)).toBe(true);
    expect(
      isSameWork(
        { ...clio, creators: [{ lastName: "Smith", creatorType: "author" }] },
        work,
      ),
    ).toBe(false);
    expect(
      isSameWork({ ...clio, fields: { ...clio.fields, date: "2005" } }, work),
    ).toBe(false);
  });

  it("requires a compatible type", () => {
    expect(
      isSameWork(
        article({ title: clio.fields.title, date: "2017" }),
        clioSearch.items[0] as CrossrefWork,
      ),
    ).toBe(false);
  });

  it("builds the search from title, first author and year", () => {
    expect(searchQuery(clio)).toBe(
      "Clio’s Toolkit: The Practice of Historical Methods in Organization Studies Wadhwani 2017",
    );
    expect(searchQuery(article({}))).toBeNull();
  });
});

describe("planFill", () => {
  it("fills a chapter's pages and the book's editors", () => {
    const changes = planFill(
      kipping,
      kippingChapter as CrossrefWork,
      kippingBook.items[0] as CrossrefWork,
    );
    expect(changes).toEqual([
      { field: "pages", from: "", to: "305-329", reason: "Crossref" },
      {
        field: "creators",
        from: "",
        to: "editor: Bucheli, Marcelo; editor: Wadhwani, R. Daniel",
        addCreators: [
          { firstName: "Marcelo", lastName: "Bucheli", creatorType: "editor" },
          {
            firstName: "R. Daniel",
            lastName: "Wadhwani",
            creatorType: "editor",
          },
        ],
        reason: "Crossref",
      },
    ]);
    expect(missingFields(withChanges(kipping, changes))).toEqual([]);
  });

  it("fills pages, DOI (in Extra) and editors for a found chapter", () => {
    const changes = planFill(
      clio,
      clioSearch.items[0] as CrossrefWork,
      clioBook.items[0] as CrossrefWork,
    );
    expect(Object.fromEntries(changes.map((c) => [c.field, c.to]))).toEqual({
      pages: "113-127",
      extra: "Num Pages: 15\nDOI: 10.4324/9781315686103-8",
      creators: "editor: Mir, Raza; editor: Jain, Sanjay",
    });
  });

  it("never overwrites a filled field", () => {
    const filled = article(
      {
        title: "Mine",
        publicationTitle: "Organization studies",
        volume: "44",
        pages: "987–1010",
        date: "2023",
      },
      [{ firstName: "Michael", lastName: "Heller", creatorType: "author" }],
      "10.1177/01708406231156978",
    );
    expect(planFill(filled, heller as CrossrefWork)).toEqual([
      { field: "issue", from: "", to: "6", reason: "Crossref" },
    ]);
  });

  it("fills over leftovers the clean-up would remove", () => {
    const leftovers = article(
      { title: "T", volume: "44(6)", pages: "0", date: "2023" },
      [{ lastName: "Heller", creatorType: "author" }],
      "10.1177/01708406231156978",
    );
    expect(missingFields(leftovers)).toEqual([
      "publicationTitle",
      "volume",
      "pages",
    ]);
    const changes = planFill(leftovers, heller as CrossrefWork);
    expect(changes.filter((c) => c.from)).toEqual([
      { field: "volume", from: "44(6)", to: "44", reason: "Crossref" },
      { field: "pages", from: "0", to: "987-1002", reason: "Crossref" },
    ]);
  });

  it("fills an empty article and prefers the print date", () => {
    const empty = article({}, [], "10.1177/01708406231156978");
    const to = Object.fromEntries(
      planFill(empty, heller as CrossrefWork).map((c) => [c.field, c.to]),
    );
    expect(to).toMatchObject({
      title:
        "Rethinking Historical Methods in Organization Studies: Organizational Source Criticism",
      publicationTitle: "Organization Studies",
      volume: "44",
      issue: "6",
      date: "2023-06",
      creators: "author: Heller, Michael",
    });
    // The item already has this DOI
    expect(to.DOI).toBeUndefined();
  });

  it("fills a missing DOI into the DOI field when the type has one", () => {
    const found = article({ title: "x" });
    expect(
      planFill(found, { DOI: "10.1177/ABC", title: ["x"] }).find(
        (c) => c.field === "DOI",
      )?.to,
    ).toBe("10.1177/abc");
  });

  it("does not fill an OnlineFirst ID as the article number", () => {
    const doi = "10.1177/13505076261465893";
    expect(
      planFill(article({}, [], doi), {
        DOI: doi,
        "article-number": "13505076261465893",
      }),
    ).toEqual([]);
  });

  it("fills a book's place from Crossref, cleaned", () => {
    const book: FillSnapshot = {
      itemType: "book",
      fields: { title: "", publisher: "", place: "", date: "" },
      creators: [],
      doi: "10.4324/x",
    };
    expect(
      planFill(book, {
        DOI: "10.4324/x",
        publisher: "Routledge",
        "publisher-location": "1 Edition. | New York : Routledge, [2017]",
      }).map((c) => [c.field, c.to]),
    ).toEqual([
      ["publisher", "Routledge"],
      ["place", "New York"],
    ]);
  });

  it("uses the article number when there are no pages", () => {
    expect(
      planFill(article({}, [], "10.1/x"), {
        DOI: "10.1/x",
        "article-number": "101381",
      }),
    ).toEqual([{ field: "pages", from: "", to: "101381", reason: "Crossref" }]);
  });
});

describe("formatDate", () => {
  it("keeps the precision Crossref has", () => {
    expect(formatDate({ "date-parts": [[2013, 12, 12]] })).toBe("2013-12-12");
    expect(formatDate({ "date-parts": [[2023, 6]] })).toBe("2023-06");
    expect(formatDate({ "date-parts": [[1957]] })).toBe("1957");
    expect(formatDate({ "date-parts": [[null]] })).toBe("");
    expect(formatDate(undefined)).toBe("");
  });
});

describe("formatIncomplete", () => {
  it("lists what each item still lacks, capped", () => {
    const items = Array.from({ length: 3 }, (_, i) => ({
      citation: `A${i} (2001)`,
      title: `T${i}`,
      missing: ["volume", "pages"],
      notFound: i === 0,
    }));
    expect(formatIncomplete(items, 2).split("\n")).toEqual([
      "• A0 (2001) — T0: Volume, Pages (not found in Crossref)",
      "• A1 (2001) — T1: Volume, Pages",
      "…and 1 more",
    ]);
  });
});
