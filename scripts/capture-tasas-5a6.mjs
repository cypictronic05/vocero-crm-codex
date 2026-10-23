import { chromium } from "playwright";

const base = process.env.APP_BASE_URL ?? "http://127.0.0.1:3300";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_BROWSER_PATH ? { executablePath: process.env.PLAYWRIGHT_BROWSER_PATH } : {}),
});
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: "es-CL" });

async function prepare(page, theme) {
  await context.addCookies([{ name: "vocero-theme", value: theme, domain: "127.0.0.1", path: "/" }]);
  await page.goto(`${base}/exchange-rates`, { waitUntil: "load" });
  await page.getByRole("heading", { name: "Tasas de cambio" }).waitFor();
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (const element of document.querySelectorAll("*")) {
      if (element instanceof HTMLElement && element.scrollHeight > element.clientHeight) element.scrollTop = 0;
    }
    window.scrollTo(0, 0);
  });
}

try {
  const response = await context.request.post(`${base}/api/auth/sign-in/email`, {
    headers: { origin: base },
    data: { email: "owner-tasas@example.invalid", password: "tasas-e2e-password-123" },
  });
  if (!response.ok()) throw new Error(`No se pudo iniciar sesión para la captura: ${response.status()}`);
  const page = await context.newPage();
  await prepare(page, "light");
  await page.screenshot({ path: "docs/screenshots/fase-5a6-tasas.png", animations: "disabled" });
  await prepare(page, "dark");
  await page.screenshot({ path: "docs/screenshots/fase-5a6-tasas-dark.png", animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page, "light");
  await page.screenshot({ path: "docs/screenshots/fase-5a6-tasas-mobile.png", animations: "disabled" });
} finally {
  await context.close();
  await browser.close();
}
