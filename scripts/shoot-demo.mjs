// Screenshot the README gallery against a demo vault.
//   python3 scripts/make-demo-vault.py /tmp/demo-vault
//   SECOND_BRAIN_VAULT=/tmp/demo-vault PORT=3200 npm run dev
//   node scripts/shoot-demo.mjs http://127.0.0.1:3200 docs/screenshots
// Playwright is not a dependency of this repo; pass NODE_PATH to a checkout
// that has it if `import("playwright")` fails.
import { mkdir } from "node:fs/promises";

const base = process.argv[2] ?? "http://127.0.0.1:3200";
const outDir = process.argv[3] ?? "docs/screenshots";
const password = process.env.DASHBOARD_PASSWORD ?? "";

// fullPage on the dashboard only: it is the one screen whose point is that
// every module reports in one place, and a viewport crop cuts it in half.
// Everywhere else a full-page shot is mostly scrolled-past detail.
const shots = [
  ["dashboard", "/", { fullPage: true }],
  ["daily-brief", "/daily"],
  ["training", "/training"],
  ["tasks", "/tasks"],
  ["business", "/business"],
  ["finances", "/finances"],
  ["library", "/wiki"],
  ["assistant", "/assistant"],
  ["notes", "/notes"],
];

// 3x on the cropped shots; 2x on the full-page dashboard, where a third of a
// pixel costs several megabytes of PNG for a screen nobody views at 1:1.
const SCALE = 3;
const SCALE_FULL_PAGE = 2;

const { chromium } = await import("playwright");
await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });

async function shoot(label, width, height, scale, keep = () => true) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
  });
  await context.addCookies([
    { name: "second-brain:locale", value: "en", url: base },
    { name: "second-brain:theme", value: "dark", url: base },
  ]);
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  if (password) {
    await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
    const field = page.locator('input[type="password"]').first();
    if (await field.count()) {
      await field.fill(password);
      // Waiting on networkidle is not enough: the sign-in is a server action,
      // and a run that starts before the server is warm settles the network
      // while still sitting on /login. Every shot is then a screenshot of the
      // login card, silently overwriting the gallery. Wait for the URL.
      await Promise.all([
        page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 }),
        page.locator('button[type="submit"], button').first().click(),
      ]);
    }
  }
  const signedIn = !new URL(page.url()).pathname.startsWith("/login");
  if (password && !signedIn) throw new Error("sign-in failed: refusing to overwrite the gallery with login screens");

  for (const [name, path, options = {}] of shots.filter(keep)) {
    await page.goto(`${base}${path}`, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(1500);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    if (options.fullPage) {
      // Lazy blocks below the fold never render if the page is shot where it
      // loaded, so walk it down first and give the charts a beat to draw.
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight / 2) {
          window.scrollTo(0, y);
          await new Promise((resolve) => setTimeout(resolve, 120));
        }
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(900);
    }
    await page.screenshot({ path: `${outDir}/${name}-${label}.png`, fullPage: Boolean(options.fullPage) });
    console.log(`${name}-${label}: overflow ${overflow}px`);
  }
  if (errors.length) console.log(`console errors (${label}):`, errors.slice(0, 5));
  await context.close();
}

// deviceScaleFactor is fixed per browser context, so the full-page dashboard
// gets its own pass rather than dragging every other shot down to 2x.
await shoot("desktop", 1680, 1050, SCALE, ([, , options = {}]) => !options.fullPage);
await shoot("desktop", 1680, 1050, SCALE_FULL_PAGE, ([, , options = {}]) => options.fullPage);
await shoot("mobile", 390, 844, SCALE_FULL_PAGE);
await browser.close();
