import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COCUYOTEC_URL,
  PRODUCT_FAVICON,
  PRODUCT_NAME,
  VOCERO_AUTHOR_URL,
} from "@/lib/product-brand";

describe("identidad pública CRM - COCUYO", () => {
  it("mantiene nombre, favicon y créditos en constantes sin depender de una organización", () => {
    expect(PRODUCT_NAME).toBe("CRM - COCUYO");
    expect(PRODUCT_FAVICON).toBe("/brand/cocuyo-mark.svg?v=2");
    expect(COCUYOTEC_URL).toBe("https://cocuyotec.com/");
    expect(VOCERO_AUTHOR_URL).toBe("https://github.com/kevinrivm/vocero-crm");
  });

  it("sirve un SVG liviano con los tres colores de la marca", () => {
    const svg = readFileSync("public/brand/cocuyo-mark.svg", "utf8");
    expect(svg).toContain("<svg");
    expect(svg).toContain("#101650");
    expect(svg).toContain("#ffb31a");
    expect(svg).toMatch(/#fff(?:fff)?/);
    expect(Buffer.byteLength(svg)).toBeLessThan(10_000);
  });
});

describe("login sin alta pública", () => {
  it("no ofrece el enlace de registro y conserva la entrada por correo", () => {
    const login = readFileSync("src/app/(auth)/login/page.tsx", "utf8");
    expect(login).not.toContain("/register");
    expect(login).not.toContain("Crear la cuenta inicial");
    expect(login).toContain("signIn.email");
  });

  it("mantiene el cierre del registro respaldado por la API", () => {
    const auth = readFileSync("src/lib/auth/index.ts", "utf8");
    expect(auth).toContain("await enforceSignupPolicy(ctx.path)");
    expect(auth).toContain("El registro público está cerrado");
  });

  it("usa la marca del producto y la atribución aprobada, no la organización", () => {
    const authLayout = readFileSync("src/app/(auth)/layout.tsx", "utf8");
    const logo = readFileSync("src/components/cocuyo-brand.tsx", "utf8");
    expect(authLayout).not.toContain("getBranding");
    expect(authLayout).not.toContain("CRM de WhatsApp con agente de IA");
    expect(authLayout).toContain("Basado en Vocero CRM de");
    expect(logo).toContain(">COCUYO</span>");
  });
});
