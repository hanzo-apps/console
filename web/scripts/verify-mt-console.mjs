/**
 * Playwright verification for the multi-tenant console on IAM.
 *
 * Drives the LIVE console end-to-end as a global-admin user:
 *   1. sign in via IAM (hanzo.id) at console.hanzo.ai
 *   2. assert the Organizations landing shows orgs (a global admin must see ALL)
 *   3. open an org -> a project -> an embedded service dashboard (/svc/<slug>)
 *   4. assert the embed iframe renders (org-scoped, SSO, no separate login)
 *
 * Usage:
 *   CONSOLE_URL=https://console.hanzo.ai \
 *   CONSOLE_USER=z@hanzo.ai CONSOLE_PASS='IloveHanzo2026!!' \
 *   node scripts/verify-mt-console.mjs
 *
 * Writes screenshots to /tmp/mt-verify/*.png and prints a PASS/FAIL summary.
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.CONSOLE_URL ?? "https://console.hanzo.ai";
const USER = process.env.CONSOLE_USER ?? "z@hanzo.ai";
const PASS = process.env.CONSOLE_PASS ?? "";
const HOST = new URL(BASE).host;
const OUT = process.env.OUT_DIR ?? "/tmp/mt-verify";
mkdirSync(OUT, { recursive: true });

const log = (...a) => console.log(...a);
const shot = async (page, name) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }).catch(() => {});
  log(`  · screenshot ${OUT}/${name}.png`);
};
const dumpForm = async (page, label) => {
  const fields = await page
    .$$eval("input,button", (els) =>
      els.map((e) => ({
        tag: e.tagName,
        type: e.getAttribute("type"),
        name: e.getAttribute("name"),
        ph: e.getAttribute("placeholder"),
        txt: (e.textContent || "").trim().slice(0, 30),
        vis: !!(e.offsetParent || e.getClientRects().length),
      })),
    )
    .catch(() => []);
  log(`  · DOM(${label}): ${JSON.stringify(fields.filter((f) => f.vis))}`);
};

async function signIn(page) {
  // The console sign-in is an SPA; wait for it to hydrate. The page may show a
  // single "Hanzo IAM" SSO button that redirects to hanzo.id, OR an inline
  // email+password form. Handle both.
  const emailSel =
    'input[type="email"], input[name="email"], input[name="username"], input[autocomplete="username"], input[placeholder*="mail" i]';
  const passSel = 'input[type="password"], input[name="password"]';
  await page.waitForTimeout(2500);
  await dumpForm(page, "signin-initial");

  // If no form yet, click the IAM/SSO button to go to hanzo.id.
  const hasForm = await page
    .locator(`${emailSel}, ${passSel}`)
    .first()
    .isVisible()
    .catch(() => false);
  if (!hasForm) {
    const ssoBtn = page
      .getByRole("button", { name: /hanzo iam|sign ?in with|continue with|iam|sso/i })
      .first();
    if (await ssoBtn.isVisible().catch(() => false)) {
      log("  · clicking SSO button -> hanzo.id");
      await ssoBtn.click();
      await page.waitForTimeout(4000);
      await page.waitForLoadState("networkidle", { timeout: 25000 }).catch(() => {});
      log(`  · now on ${page.url()}`);
    }
  }

  await page.waitForSelector(`${emailSel}, ${passSel}`, { timeout: 25000 });
  await dumpForm(page, "signin");

  if (await page.locator(emailSel).first().isVisible().catch(() => false)) {
    await page.fill(emailSel, USER);
  }
  if (!(await page.locator(passSel).first().isVisible().catch(() => false))) {
    const cont = page
      .getByRole("button", { name: /continue|next|sign ?in|log ?in/i })
      .first();
    if (await cont.isVisible().catch(() => false)) await cont.click();
    await page.waitForTimeout(2000);
  }
  await page.waitForSelector(passSel, { timeout: 20000 });
  await page.fill(passSel, PASS);
  await shot(page, "02-credentials-filled");
  // Submit via the form's submit button (NOT a "Continue with GitHub/Google"
  // social button). Prefer an explicit submit; fall back to Enter in the field.
  const submit = page.locator('button[type="submit"]').first();
  if (await submit.isVisible().catch(() => false)) {
    await submit.click();
  } else {
    await page.locator(passSel).first().press("Enter");
  }

  // Capture any immediate error (wrong password / rate limit) post-submit.
  await page.waitForTimeout(3500);
  await shot(page, "02b-post-submit");
  const errText = await page
    .locator('[role="alert"], .error, [class*="error" i], [class*="destructive" i]')
    .first()
    .innerText({ timeout: 3000 })
    .catch(() => "");
  if (errText) log(`  ! IdP error after submit: ${errText.slice(0, 160)}`);

  // Follow the OAuth dance back to console. There may be a consent step on
  // hanzo.id; click any obvious consent/authorize button. Then wait for the
  // redirect to the console callback that sets hi_session.
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(2500);
    const url = page.url();
    if (url.includes(HOST) && !/\/auth\/(sign-in|iam\/callback)/.test(url)) break;
    // consent / authorize button on the IdP
    const consent = page
      .getByRole("button", { name: /authorize|allow|consent|agree|accept|continue/i })
      .first();
    if (await consent.isVisible().catch(() => false)) {
      log(`  · clicking consent on ${new URL(url).host}`);
      await consent.click().catch(() => {});
    }
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  }
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const result = {
    base: BASE,
    signedIn: false,
    orgCount: 0,
    orgNames: [],
    embedRendered: false,
    embedService: null,
  };

  try {
    log(`\n[1] open ${BASE}`);
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(3000);
    await shot(page, "01-landing");

    log(`[2] sign in as ${USER}`);
    try {
      await signIn(page);
    } catch (e) {
      log(`  ! sign-in form issue: ${e.message}`);
      await dumpForm(page, "signin-fail");
    }

    await page.waitForTimeout(3000);
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    log(`  · landed on ${page.url()}`);
    await shot(page, "03-post-login");

    log(`[3] read Organizations at ${BASE}/`);
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(4000);
    await shot(page, "04-organizations");
    // Authenticated only if the app rendered (NOT the "Hanzo IAM" SSO button).
    const onSignIn = await page
      .getByRole("button", { name: /hanzo iam/i })
      .first()
      .isVisible()
      .catch(() => false);
    result.signedIn = !onSignIn && page.url().includes(HOST);
    log(`  · signed in: ${result.signedIn} (sign-in bounce: ${onSignIn})`);
    const orgIds = await page
      .$$eval('a[href*="/organization/"]', (as) =>
        Array.from(
          new Set(
            as
              .map((a) => (a.getAttribute("href").match(/\/organization\/([^/?#]+)/) || [])[1])
              .filter(Boolean),
          ),
        ),
      )
      .catch(() => []);
    result.orgCount = orgIds.length;
    result.orgNames = orgIds;
    log(`  · orgs visible: ${orgIds.length} -> ${orgIds.join(", ") || "(none)"}`);

    if (orgIds.length > 0) {
      log(`[4] open org ${orgIds[0]} -> project -> embedded service`);
      await page.goto(`${BASE}/organization/${orgIds[0]}`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await page.waitForTimeout(3000);
      await shot(page, "05-org-projects");
      const projectId = await page
        .$eval("a[href*='/project/']", (a) => (a.getAttribute("href").match(/\/project\/([^/?#]+)/) || [])[1])
        .catch(() => null);
      if (projectId) {
        log(`  · project ${projectId}`);
        for (const slug of ["base", "playground", "chat", "flow", "search"]) {
          const svcUrl = `${BASE}/project/${projectId}/svc/${slug}`;
          await page
            .goto(svcUrl, { waitUntil: "domcontentloaded", timeout: 30000 })
            .catch(() => {});
          await page.waitForTimeout(5000);
          const hasIframe = (await page.locator("iframe").count()) > 0;
          const bodyText = hasIframe
            ? await page
                .frameLocator("iframe")
                .first()
                .locator("body")
                .innerText({ timeout: 9000 })
                .catch(() => "")
            : "";
          if (hasIframe && bodyText && bodyText.trim().length > 0) {
            result.embedRendered = true;
            result.embedService = slug;
            await shot(page, `06-embed-${slug}`);
            log(`  · embed "${slug}" RENDERED (iframe body ${bodyText.length} chars)`);
            break;
          }
          log(`  · embed "${slug}": iframe=${hasIframe} body=${bodyText.length}`);
        }
      } else {
        log("  ! no project found in org");
        await dumpForm(page, "org-no-project");
      }
    }
  } catch (err) {
    log(`ERROR: ${err.stack || err.message}`);
  } finally {
    await browser.close();
  }

  log("\n==== RESULT ====");
  log(JSON.stringify(result, null, 2));
  const pass = result.signedIn && result.orgCount > 0 && result.embedRendered;
  log(`VERDICT: ${pass ? "PASS" : "FAIL"}`);
  process.exit(pass ? 0 : 1);
}

main();
