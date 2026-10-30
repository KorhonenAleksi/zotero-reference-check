busy = Reference Check is still working on the previous command. Try again when it has finished.

resolving-dois = { $count ->
        [one] Looking up the full form of 1 short DOI…
       *[other] Looking up the full form of { $count } short DOIs…
    }

clean-none = Nothing to clean up in the { $count } selected items.
clean-confirm-title = Clean up references
clean-confirm-intro = { $count ->
        [one] 1 item has leftovers that would appear in your reference list ({ $reasons }):
       *[other] { $count } items have leftovers that would appear in your reference list ({ $reasons }):
    }
clean-confirm-note = ✕ clears the value, → shows a change, + adds a line to Extra. Internet Archive links move to Extra. Items with a DOI keep their URL, and web pages and attachments are not touched. Every old value is saved to reference-check-log.csv in your Zotero data folder.
clean-confirm-button = { $count ->
        [one] Clean up 1 item
       *[other] Clean up { $count } items
    }
clean-done = { $count ->
        [one] Cleaned up 1 item.
       *[other] Cleaned up { $count } items.
    }

fill-checking = { $count ->
        [one] Checking 1 item in Crossref…
       *[other] Checking { $count } items in Crossref…
    }
fill-complete = The { $count } selected items have the details a reference needs.
fill-confirm-title = Fill missing details
fill-confirm-intro = { $count ->
        [one] Crossref can fill empty fields in 1 item:
       *[other] Crossref can fill empty fields in { $count } items:
    }
fill-incomplete = { $count ->
        [one] Still incomplete afterwards, fix by hand (1):
       *[other] Still incomplete afterwards, fix by hand ({ $count }):
    }
fill-not-found = not found in Crossref
fill-unavailable = { $count ->
        [one] 1 article has no volume or page numbers yet (published online first, or the journal doesn't use pages). It is complete: APA cites it with the DOI.
       *[other] { $count } articles have no volume or page numbers yet (published online first, or the journal doesn't use pages). They are complete: APA cites them with the DOI.
    }
fill-tag-checkbox = Tag items that are still incomplete (“Missing: …”), and untag them once complete
fill-nothing = Crossref has nothing to add to the selected items.
fill-confirm-note = + fills an empty field; nothing that is already filled in is changed. Every change is saved to reference-check-log.csv in your Zotero data folder.
fill-confirm-button = { $count ->
        [one] Fill 1 item
       *[other] Fill { $count } items
    }
fill-done = { $count ->
        [one] Filled in 1 item.
       *[other] Filled in { $count } items.
    }
