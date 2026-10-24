import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const service = readFileSync("src/server/delivery/preparation.ts", "utf8");
const route = readFileSync("src/app/api/settings/delivery-preparation/route.ts", "utf8");
const migration = readFileSync("drizzle/0025_delivery_archive.sql", "utf8");

describe("preparación de entrega: contratos de seguridad", () => {
  it("archiva conversaciones y leads, nunca elimina", () => {
    expect(service).toContain("archivedAt");
    expect(service).not.toMatch(/delete\(schema\.(conversation|contact|lead)/);
  });
  it("protege el procedimiento con lock organizacional", () => expect(service).toContain("delivery:${session.organizationId}"));
  it("reabre conversaciones ante actividad entrante", () => expect(readFileSync("src/server/inbox/ingest.ts", "utf8")).toContain("archivedAt: null"));
  it("exige confirmación literal", () => expect(route).toContain("confirm: z.literal(true)"));
  it("restringe preview y ejecución al permiso de organización", () => expect(route.match(/ORGANIZATION_CONFIGURE/g)?.length).toBeGreaterThanOrEqual(3));
  it("exporta manifiesto y SHA-256", () => { expect(route).toContain("manifest"); expect(route).toContain("sha256"); });
  it("excluye secretos del manifiesto", () => { expect(route).toContain("passwords"); expect(route).toContain("tokens"); expect(route).toContain("credentials"); });
  it("mantiene adjuntos físicos fuera de la operación", () => expect(service).not.toContain("deleteMediaFile"));
  it("incluye columnas reversibles en migración", () => { expect(migration).toContain("conversation"); expect(migration).toContain("lead"); });
  it("crea auditoría específica", () => expect(migration).toContain("delivery_preparation_event"));
});
