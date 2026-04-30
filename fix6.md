Patch 1 — Apply settings + update UI function node (PRIMARY)
Node: Apply settings + update UI (function node)
Action: Replace the entire normalizeCatalogItems definition.
FIND this block (lines ~58–76 of the function):
javascriptconst normalizeCatalogItems = (list, fallbackLabelPrefix) => {
  if (!Array.isArray(list)) return [];
  return list
    .map((c, idx) => {
      const categoryId = String(c.id || c.categoryId || ("cat_" + idx));
      const categoryLabel = String(c.label || c.categoryLabel || (fallbackLabelPrefix + " " + (idx + 1)));
      const detailsRaw = Array.isArray(c.children) ? c.children : (Array.isArray(c.details) ? c.details : []);
      const details = detailsRaw.map((d, jdx) => ({
        id: String(d.id || d.detailId || (categoryId + "_d" + jdx)),
        label: String(d.label || d.detailLabel || ("Detalle " + (jdx + 1)))
      }));
      return {
        id: categoryId,
        label: categoryLabel,
        children: details
      };
    })
    .filter((c) => c.label && c.children.length > 0);
};
REPLACE with:
javascript// ============================================================
// CATALOG SANITIZER
// Defense against leaked markdown/spec text being stored as
// catalog labels in Control Tower. Rejects entries whose label
// looks like documentation/notes rather than a real reason.
// Tune MAX_LABEL_LEN if your real labels are longer.
// ============================================================
const MAX_LABEL_LEN = 40;

const isCleanLabel = (s) => {
  if (typeof s !== "string") return false;
  const t = s.trim();
  if (!t) return false;
  if (t.length > MAX_LABEL_LEN) return false;          // sentence-length text
  if (/[\r\n\t]/.test(t)) return false;                // multi-line content
  if (/^[-*#>|`\[\]]/.test(t)) return false;           // markdown leaders: - * # > | ` [ ]
  if (/\*\*|__|```|~~~|###/.test(t)) return false;     // markdown bold/code/heading
  if (/[(\[<{][^)\]>}]*$/.test(t)) return false;       // unbalanced opening bracket → truncated
  if (/=/.test(t)) return false;                        // code-like assignment (e.g. type=event)
  return true;
};

const normalizeCatalogItems = (list, fallbackLabelPrefix) => {
  if (!Array.isArray(list)) return [];

  const dropped = [];

  const cleaned = list
    .map((c, idx) => {
      const categoryId = String(c.id || c.categoryId || ("cat_" + idx));
      const categoryLabel = String(
        c.label || c.categoryLabel || (fallbackLabelPrefix + " " + (idx + 1))
      ).trim();

      const detailsRaw = Array.isArray(c.children)
        ? c.children
        : (Array.isArray(c.details) ? c.details : []);

      const details = detailsRaw
        .map((d, jdx) => ({
          id: String(d.id || d.detailId || (categoryId + "_d" + jdx)),
          label: String(d.label || d.detailLabel || ("Detalle " + (jdx + 1))).trim()
        }))
        .filter((d) => {
          if (isCleanLabel(d.label)) return true;
          dropped.push("detail<" + categoryLabel.slice(0, 20) + ">: " + d.label.slice(0, 50));
          return false;
        });

      return { id: categoryId, label: categoryLabel, children: details };
    })
    .filter((c) => {
      if (!isCleanLabel(c.label)) {
        dropped.push("category: " + c.label.slice(0, 50));
        return false;
      }
      if (c.children.length === 0) {
        dropped.push("empty: " + c.label.slice(0, 50));
        return false;
      }
      return true;
    });

  if (dropped.length > 0) {
    node.warn(
      "[CATALOG SANITIZER " + fallbackLabelPrefix + "] Dropped " +
      dropped.length + " polluted entries:\n  - " +
      dropped.slice(0, 15).join("\n  - ") +
      (dropped.length > 15 ? "\n  ... (+" + (dropped.length - 15) + " more)" : "")
    );
  }

  return cleaned;
};
Side effects:

Function signature unchanged → no other code in this node needs to change.
The two call sites (incomingCatalog.downtime, incomingCatalog.scrap) work identically.
node.warn will fire on every settings sync that has dirty data — this is intentional so you see when CT pushes garbage.
A category whose children are all polluted will be dropped (it'd be useless anyway).
dropped only logs first 15 to avoid debug-pane spam.

Risk on legit data: MAX_LABEL_LEN = 40 will reject labels longer than 40 chars. If your real catalog has labels like "Falla mecánica del extrusor principal con sensor" (49), bump this to 60. The shortest known false-negative in your current data ("Tap Acknowledge on anomaly panel", 32 chars) still slips through — see Patch 2 below or upstream cleanup.