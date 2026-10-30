import { cleanItems } from "./cleanup";
import { fillItems } from "./fill";
import { getString } from "../utils/locale";
import { showResult } from "./zotero";

const MENU_ID = "referencecheck-item-menu";
// Zotero may namespace the ID; keep the one it returns for unregistering.
let registeredMenuID: string | false = false;

// One command at a time: a second one started while the first is still
// looking things up would plan from stale values and could undo its changes.
let running = false;

export function registerItemMenu() {
  const command =
    (run: (items: Zotero.Item[]) => Promise<void>) =>
    (_event: Event, context: { items?: Zotero.Item[] }) => {
      if (running) {
        showResult(getString("busy"));
        return;
      }
      running = true;
      run(context.items ?? [])
        .catch((e) => Zotero.logError(e))
        .finally(() => {
          running = false;
        });
    };
  // No separator: Zotero groups plugin items under its own separator and
  // rejects the whole registration if a top-level separator is included.
  registeredMenuID = Zotero.MenuManager.registerMenu({
    menuID: MENU_ID,
    pluginID: addon.data.config.addonID,
    target: "main/library/item",
    menus: [
      {
        menuType: "menuitem",
        l10nID: `${addon.data.config.addonRef}-menuitem-clean`,
        onCommand: command(cleanItems),
      },
      {
        menuType: "menuitem",
        l10nID: `${addon.data.config.addonRef}-menuitem-fill`,
        onCommand: command(fillItems),
      },
    ],
  });
  if (!registeredMenuID) {
    Zotero.logError(
      new Error("Reference Check: item menu registration was rejected"),
    );
  }
}

export function unregisterItemMenu() {
  if (registeredMenuID) Zotero.MenuManager.unregisterMenu(registeredMenuID);
  registeredMenuID = false;
}
