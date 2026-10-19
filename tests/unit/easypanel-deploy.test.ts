import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("despliegue independiente en EasyPanel", () => {
  const compose = readFileSync("docker-compose.easypanel.yml", "utf8");
  const dockerfile = readFileSync("Dockerfile", "utf8");
  const guide = readFileSync("docs/deploy-easypanel-nexora.md", "utf8");

  it("no crea PostgreSQL ni publica puertos del VPS", () => {
    expect(compose).not.toMatch(/^\s{2}postgres:/m);
    expect(compose).not.toMatch(/^\s+ports:/m);
    expect(compose).toMatch(/^\s+expose:\s*$[\s\S]*?"3000"/m);
  });

  it("recibe la conexión y secretos únicamente desde el entorno", () => {
    expect(compose).toContain("DATABASE_URL: ${DATABASE_URL:");
    expect(compose).not.toMatch(/postgres(?:ql)?:\/\/[^$\n]+:[^$\n]+@/);
    expect(compose).toContain("- nexora_media:/data");
  });

  it("usa el Dockerfile raíz y reconoce el commit que inyecta EasyPanel", () => {
    expect(dockerfile).toContain('ARG GIT_SHA=""');
    expect(dockerfile).toContain('${SOURCE_COMMIT:-$GIT_SHA}');
    expect(guide).toContain("Source: **GitHub**");
    expect(guide).toContain("Build Path / contexto: `/`");
    expect(guide).toContain("Dockerfile Path: `Dockerfile`");
  });
});
