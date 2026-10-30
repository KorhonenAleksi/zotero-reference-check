# Zotero Reference Check

A Zotero 9/10 plugin that gets selected items ready for a journal's reference
list. Right-click the items for two commands:

- **Clean up references…** removes the leftovers database and catalogue
  imports leave behind: database links, database names and accession
  numbers, decorated journal names, article IDs posing as page numbers,
  issues stuck in the volume field, and short DOIs.
- **Fill missing details from Crossref…** checks each item for the details
  its reference needs (authors, year, journal, volume, pages, editors,
  publisher…) and fills the empty ones from Crossref, including a DOI when
  one exists.

Both list every change and change nothing until you confirm (Cancel is the
default button). Every change is first appended to `reference-check-log.csv`
in your Zotero data folder (Settings → Advanced → Files and Folders → Show
Data Directory) with the item key, field, old and new value, so anything can
be restored.

Formerly **Zotero Clean URLs** (`cleanurls@korhonenaleksi.github.io`). It's a
new plugin ID, so uninstall Clean URLs after installing this. Its old log
`clean-urls-log.csv` is kept.

## Why

When an article has no DOI, APA (and most journal styles) print its URL. If
that URL is a database login link such as

```
https://search.ebscohost.com/login.aspx?direct=true&db=bth&AN=9509210295&site=ehost-live&authtype=sso&custid=ns000000
```

it ends up in your reference list. APA 7 says not to include database URLs,
and proxy links only work for members of one university. With no DOI or URL,
APA falls back to the Archive fields, which print as
"Business Source Ultimate. (174326664)". And an item made from a dragged-in
PDF, or imported from a catalogue, often lacks the volume, pages or editors
a journal will ask for.

## Clean up references

Only journal articles, conference papers, books, book sections, theses,
reports, magazine and newspaper articles, and encyclopedia entries. Web
pages, attachments and read-only group libraries are never touched.

| Field                     | Change                                                                                                                                                                                                                                                                                                                                                                   | Example                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| URL                       | Cleared when the item has **no DOI** and the link is a research database (EBSCO, ProQuest, JSTOR, Gale, Web of Science, Scopus, Nexis Uni, Factiva), a library proxy (`libproxy`, `ezproxy`/`ezp`, `*.idm.oclc.org`, `/login?url=`), or an academic network (ResearchGate, Academia.edu, Semantic Scholar, Google Scholar)                                               | `search.ebscohost.com/login.aspx?…`                                                              |
| URL → attachment          | Internet Archive book scans (`archive.org/details/…`) on books and book sections without a DOI move to a link attachment titled "Internet Archive", which no style prints. Like a database, the scan is where you read the book, not part of its reference. Wayback Machine copies (`web.archive.org`) and other item types are left alone: people cite those on purpose | `archive.org/details/strategystructur00chan_0`                                                   |
| Archive                   | Database names cleared                                                                                                                                                                                                                                                                                                                                                   | Business Source Ultimate, ProQuest Central, JSTOR                                                |
| Loc. in Archive           | Accession numbers cleared (kept for real archive locations)                                                                                                                                                                                                                                                                                                              | `174326664`, `WOS:A1995RR91800003`                                                               |
| Publication, Journal Abbr | Publisher and coverage suffixes dropped; Academy of Management titles without "The"                                                                                                                                                                                                                                                                                      | `Strategic Management Journal (Wiley-Blackwell) - 1980 to 2009` → `Strategic Management Journal` |
| Pages                     | `0` and article IDs cleared (12+ digits, or the whole DOI suffix); real article numbers such as `101381` kept                                                                                                                                                                                                                                                            | `00018392251355283`                                                                              |
| Extra                     | A page count stored as `Pages: 344 Pages` (printed as "p. 344") moves to # of Pages                                                                                                                                                                                                                                                                                      |                                                                                                  |
| Title (books)             | Catalogue semicolon becomes a subtitle colon                                                                                                                                                                                                                                                                                                                             | `Leadership in Administration; a Sociological …` → `…: A Sociological …`                         |
| Creators                  | Role phrases dropped from names                                                                                                                                                                                                                                                                                                                                          | `with an introduction by Keith` → `Keith`                                                        |
| DOI                       | Short DOIs replaced with the full DOI, looked up at doi.org                                                                                                                                                                                                                                                                                                              | `10/gghcqk` → `10.…`                                                                             |

Publisher pages (Wiley, SAGE, ScienceDirect, …), open-access repositories and
`doi.org` links are never removed, and items with a DOI keep their URL: styles
print the DOI instead. Every rule can be switched off in the settings.

## Fill missing details

Only journal articles, conference papers, books, book sections, theses,
reports, and magazine and newspaper articles are checked. An item is looked
up when it lacks something its reference needs:

| Type             | Needs                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------- |
| Journal article  | author, date, title, publication, volume, pages (or article number), and a DOI if one exists |
| Book section     | author, date, title, book title, editor, pages, publisher, and a DOI if one exists           |
| Book             | author or editor, date, title, publisher                                                     |
| Conference paper | author, date, title, proceedings title or conference name, and a DOI if one exists           |
| Report, thesis   | author, date, title, institution / university                                                |

That is what APA 7 prints. With **Chicago** chosen in the settings, books,
book sections and reports also need the **place of publication** (required
by the 17th edition; the 18th made it optional). The place is filled in
whenever a source has it, whichever style you choose: APA simply doesn't
print it, so it does no harm.

Items with a DOI are fetched by DOI. Items without one are searched by title,
first author and year, and a result is used only if it is the same work: a
compatible type, the same title (or the same main title before the colon,
since Crossref often drops subtitles), a shared author surname, and a year
within one of the item's. For a book section, the editors and book title come
from the book's own Crossref record, found by ISBN.

Crossref rarely has a book's publisher or place. When a book or book section
still lacks one the chosen style needs, it is looked up by ISBN in
[Open Library](https://openlibrary.org). An ISBN lookup can't pick the wrong
book, so no title matching is involved.

Only empty fields are filled, plus leftovers the clean-up would remove anyway
(page `0`, an article ID in Pages, `44(6)` in Volume), so the order you run
the two commands in doesn't matter. Anything filled in already stays as it
is. The dialog also lists the items that will still lack something
afterwards (for example online-first articles that have no volume yet, or
works Crossref doesn't have), to fix by hand.

Requests go to Crossref one at a time, as it asks of clients without an API
key, so checking a few hundred items takes a few minutes. Items that already
have everything are not looked up.

Neither command changes the item type. For a PDF you dragged into Zotero, use
Zotero's own right-click → **Retrieve Metadata for PDF** first to create the
parent item, then fill in what's still missing.

## Settings

Settings → Reference Check:

- **Reference style:** APA 7 (default) or Chicago, which decides what "Fill
  missing details" treats as missing.
- **Clean up references:** a switch for each clean-up rule.

## Privacy

Nothing leaves your computer until you run a command, and then only:

- short DOIs, to doi.org, to get the full DOI;
- for "Fill missing details": DOIs, or the title, first author's surname and
  year of items without a DOI, to Crossref (api.crossref.org); and books'
  ISBNs to Open Library (openlibrary.org).

No account, API key or e-mail address is used or sent. The change log stays
in your Zotero data folder.

## Install

Requires Zotero 9 or 10.

1. Download `zotero-reference-check.xpi` from the latest
   [release](https://github.com/KorhonenAleksi/zotero-reference-check/releases/latest).
2. In Zotero: Tools → Plugins → gear icon → Install Plugin From File…, and
   pick the downloaded file.

Zotero checks for new versions automatically.

## Development

```sh
npm install
npm test            # unit tests for the pure core (src/core), runs in Node
npm run build       # → build/zotero-reference-check.xpi
npm start           # hot-reload into a separate dev Zotero profile (needs .env, see .env.example)
npm run release     # bump the version, tag and push; GitHub Actions then
                    # publishes the release and update.json
```

Layout: `src/core/` is pure TypeScript with no Zotero dependency and is
unit-tested in Node: `links.ts` (link classification), `clean.ts` (clean-up
rules), `crossref.ts` (what a reference needs, matching, filling), `doi.ts`,
and `changes.ts` (the change list, confirmation text and log). The Crossref
tests run on real, saved Crossref responses in `test/unit/fixtures/`.
`src/modules/` is the thin Zotero adapter: `menu.ts`, `cleanup.ts`,
`fill.ts` (Crossref requests), and `zotero.ts` (shared dialog, log, saving).

Built on [windingwind/zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template). Licensed AGPL-3.0-or-later.
