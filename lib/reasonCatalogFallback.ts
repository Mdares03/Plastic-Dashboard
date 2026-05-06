import { readFile } from "fs/promises";
import path from "path";
import { parseReasonCatalogMarkdown, type ReasonCatalog } from "@/lib/reasonCatalog";

let catalogPromise: Promise<ReasonCatalog> | null = null;

/** Server-only: reads downtime_menu.md from the repo root. */
export async function loadFallbackReasonCatalog() {
  if (!catalogPromise) {
    catalogPromise = readFile(path.join(process.cwd(), "downtime_menu.md"), "utf8")
      .then((raw) => parseReasonCatalogMarkdown(raw))
      .catch(() => ({ version: 1, downtime: [], scrap: [] }));
  }
  return catalogPromise;
}
