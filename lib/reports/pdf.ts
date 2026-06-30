import fs from "fs";
import puppeteer from "puppeteer-core";
import { signPrintToken, type PrintTokenPayload } from "@/lib/reports/printToken";

/**
 * Headless-Chromium report PDF (item 3). Renders the token-gated print route — real
 * Recharts charts and the same styling the app uses — and rasterizes it to a PDF
 * buffer. Self-hosted deploy: point PUPPETEER_EXECUTABLE_PATH at the host's Chromium
 * (apt install chromium), or rely on the common-path autodetect below.
 */

const CANDIDATE_CHROME_PATHS = [
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/snap/bin/chromium",
];

function resolveChromePath(): string {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH;
  if (fromEnv) return fromEnv;
  for (const candidate of CANDIDATE_CHROME_PATHS) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // try next
    }
  }
  throw new Error(
    "No Chromium executable found. Install it (apt-get install -y chromium) or set PUPPETEER_EXECUTABLE_PATH."
  );
}

export async function generateReportPdf(params: {
  payload: PrintTokenPayload;
  baseUrl: string;
}): Promise<Buffer> {
  const token = signPrintToken(params.payload);
  const url = `${params.baseUrl}/reports/print/${params.payload.type}?token=${encodeURIComponent(token)}`;

  const browser = await puppeteer.launch({
    executablePath: resolveChromePath(),
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1024, height: 1400, deviceScaleFactor: 2 });
    // Keep the on-screen (dark dashboard) look rather than print media styles.
    await page.emulateMediaType("screen");
    await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
    // Wait for the charts to paint so they appear in the PDF (best-effort).
    await page.waitForSelector("svg.recharts-surface", { timeout: 15000 }).catch(() => undefined);
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "12mm", bottom: "12mm", left: "10mm", right: "10mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

/** Like generateReportPdf but returns null instead of throwing (for best-effort email attach). */
export async function tryGenerateReportPdf(params: {
  payload: PrintTokenPayload;
  baseUrl: string;
}): Promise<Buffer | null> {
  try {
    return await generateReportPdf(params);
  } catch {
    return null;
  }
}
