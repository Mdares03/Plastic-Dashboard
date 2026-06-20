/**
 * B2 — seed the reason catalog with the client's real Spanish taxonomy so it is never
 * empty on deploy (an empty catalog = operators literally cannot classify).
 *
 * Source of truth: docs/archive/downtime_menu.md. Idempotent — safe to re-run; it
 * upserts categories (by orgId+kind+name) and items (by the unique orgId+reasonCode).
 *
 * "Molde / Cambio de molde" is mapped to reasonCode MOLD_CHANGE so computeDowntime treats
 * it as PLANNED (DEFAULT_PLANNED_CODES), not as a reducible loss.
 *
 * Usage (read/write; point at the target DB via the env file):
 *   npx dotenv -e .env -- tsx scripts/seed-reason-catalog.ts <orgId>
 */
import { prisma } from "@/lib/prisma";

type Cat = { name: string; prefix: string; items: string[] };

// Order matters → drives sortOrder + the "01".."0N" code suffixes.
const DOWNTIME: Cat[] = [
  { name: "Material", prefix: "DTMAT", items: ["Falta de material", "Material incorrecto", "Material contaminado", "Atasco de material", "Cambio de material", "Otro"] },
  { name: "Proceso", prefix: "DTPRC", items: ["Temperatura fuera de rango", "Parámetros incorrectos", "Ajuste de proceso", "Arranque o estabilización", "Proceso inestable", "Otro"] },
  { name: "Calidad", prefix: "DTCAL", items: ["Inspección de calidad", "Defecto detectado", "Espera de liberación", "Rechazo de producción", "Validación de primera pieza", "Otro"] },
  { name: "Seguridad", prefix: "DTSEG", items: ["Paro de seguridad", "Guarda o puerta abierta", "Sensor de seguridad activado", "Bloqueo y etiquetado", "Reset de seguridad", "Otro"] },
  { name: "Molde", prefix: "DTMOL", items: ["Cambio de molde", "En espera de arranque", "Ajuste de molde", "Limpieza de molde", "Falla de molde", "Problema de expulsión", "Otro"] },
  { name: "Máquina", prefix: "DTMAQ", items: ["Alarma de máquina", "Falla eléctrica", "Falla mecánica", "Falla neumática o hidráulica", "Reinicio de máquina", "Otro"] },
  { name: "Automatización", prefix: "DTAUT", items: ["Falla de robot", "Falla de sensor", "Pérdida de comunicación", "Atasco de pieza", "Reset de celda", "Otro"] },
  { name: "Operación", prefix: "DTOPE", items: ["Falta de operador", "Error de operación", "Cambio de turno", "Espera de apoyo", "Limpieza o ajuste", "Otro"] },
  { name: "Servicios", prefix: "DTSER", items: ["Falta de energía", "Baja presión de aire", "Falta de agua o enfriamiento", "Falla de red o comunicación", "Utilidad fuera de rango", "Otro"] },
];

const SCRAP: Cat[] = [
  { name: "Material", prefix: "SCMAT", items: ["Material incorrecto", "Material contaminado", "Humedad de material", "Mezcla incorrecta", "Color incorrecto", "Otro"] },
  { name: "Proceso", prefix: "SCPRC", items: ["Parámetros incorrectos", "Temperatura incorrecta", "Presión incorrecta", "Tiempo incorrecto", "Proceso inestable", "Otro"] },
  { name: "Calidad", prefix: "SCCAL", items: ["Defecto visual", "Defecto dimensional", "No cumple especificación", "Defecto detectado en inspección", "Pieza no liberada", "Otro"] },
  { name: "Molde", prefix: "SCMOL", items: ["Rebaba", "Falta de llenado", "Problema de expulsión", "Desalineación", "Daño de molde", "Otro"] },
  { name: "Manipulación", prefix: "SCMAN", items: ["Pieza golpeada", "Pieza rayada", "Pieza deformada", "Daño por robot", "Daño por operador", "Otro"] },
];

// Special reasonCodes that override the prefix-suffix scheme.
const SPECIAL_CODE: Record<string, string> = {
  "downtime|Molde|Cambio de molde": "MOLD_CHANGE",
};

async function seedKind(orgId: string, kind: "downtime" | "scrap", cats: Cat[]) {
  let createdCats = 0;
  let createdItems = 0;
  for (let ci = 0; ci < cats.length; ci += 1) {
    const cat = cats[ci];
    let category = await prisma.reasonCatalogCategory.findFirst({
      where: { orgId, kind, name: cat.name },
      select: { id: true },
    });
    if (!category) {
      category = await prisma.reasonCatalogCategory.create({
        data: { orgId, kind, name: cat.name, codePrefix: cat.prefix, sortOrder: ci, active: true },
        select: { id: true },
      });
      createdCats += 1;
    }

    for (let ii = 0; ii < cat.items.length; ii += 1) {
      const itemName = cat.items[ii];
      const suffix = String(ii + 1).padStart(2, "0");
      const reasonCode =
        SPECIAL_CODE[`${kind}|${cat.name}|${itemName}`] ?? `${cat.prefix}-${suffix}`;

      // Upsert on the unique (orgId, reasonCode).
      const existing = await prisma.reasonCatalogItem.findFirst({
        where: { orgId, reasonCode },
        select: { id: true },
      });
      if (existing) {
        await prisma.reasonCatalogItem.update({
          where: { id: existing.id },
          data: { categoryId: category.id, name: itemName, codeSuffix: suffix, sortOrder: ii, active: true },
        });
      } else {
        await prisma.reasonCatalogItem.create({
          data: { orgId, categoryId: category.id, name: itemName, codeSuffix: suffix, reasonCode, sortOrder: ii, active: true },
        });
        createdItems += 1;
      }
    }
  }
  return { createdCats, createdItems };
}

async function main() {
  const orgId = process.argv[2];
  if (!orgId) {
    console.error("Usage: tsx scripts/seed-reason-catalog.ts <orgId>");
    process.exitCode = 1;
    return;
  }
  const org = await prisma.org.findUnique({ where: { id: orgId }, select: { id: true, name: true } });
  if (!org) {
    console.error(`Org ${orgId} not found.`);
    process.exitCode = 1;
    return;
  }

  const dt = await seedKind(orgId, "downtime", DOWNTIME);
  const sc = await seedKind(orgId, "scrap", SCRAP);
  console.log(
    `Seeded reason catalog for ${org.name} (${orgId}):\n` +
      `  downtime: +${dt.createdCats} categories, +${dt.createdItems} items\n` +
      `  scrap:    +${sc.createdCats} categories, +${sc.createdItems} items\n` +
      `(idempotent — existing rows were updated in place.)`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
