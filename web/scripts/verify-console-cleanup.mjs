/**
 * Headless verification for the console cleanup/rework.
 *
 * Signs in to the LIVE console as a global admin, drives to org Settings/Billing
 * and a couple of product pages, and PROVES each fix:
 *   - 0 blue chrome elements   (computed-style scan of every visible element)
 *   - no "v4.0.0" version label anywhere in the chrome
 *   - no "Star HanzoCloud" GitHub-star widget
 *   - H-logo only / no "Hanzo" wordmark in the top-left
 *   - app-selector (grid) on the RIGHT of the sidebar header
 *   - no "KMS" entry in Organization Settings nav
 *   - the regrouped product nav (which groups render)
 * Screenshots the Billing page + the sidebar.
 *
 * Usage:
 *   CONSOLE_URL=https://console.hanzo.ai TAG=before \
 *   CONSOLE_USER=z@hanzo.ai CONSOLE_PASS='IloveHanzo2026!!' \
 *   node scripts/verify-console-cleanup.mjs
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.CONSOLE_URL ?? "https://console.hanzo.ai";
const USER = process.env.CONSOLE_USER ?? "z@hanzo.ai";
const PASS = process.env.CONSOLE_PASS ?? "";
const TAG = process.env.TAG ?? "run";
const HOST = new URL(BASE).host;
const OUT = process.env.OUT_DIR ?? `/tmp/console-verify/${TAG}`;
mkdirSync(OUT, { recursive: true });

const log = (...a) => console.log(...a);
const shot = async (page, name) => {
  await page
    .screenshot({ path: `${OUT}/${name}.png`, fullPage: false })
    .catch(() => {});
  log(`  · screenshot ${OUT}/${name}.png`);
};

// Is an HSL/RGB color perceptibly "blue"? Blue hue band ~200-260 with real
// saturation+value. Pure grayscale (sat ~0) never counts. Returns the offending
// color string or null.
function blueDetectorSource() {
  return `
  function parseColor(c) {
    if (!c) return null;
    const m = c.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(',').map(s => parseFloat(s.trim()));
    const [r,g,b,a=1] = p;
    if (a === 0) return null; // fully transparent → invisible
    return {r,g,b,a};
  }
  function isBlue(c) {
    const col = parseColor(c);
    if (!col) return false;
    const {r,g,b} = col;
    // grayscale guard: near-equal channels = neutral, never blue
    const max = Math.max(r,g,b), min = Math.min(r,g,b);
    if (max - min < 24) return false;           // low chroma → neutral
    // blue dominates and is clearly above the others
    if (b > 110 && b - r > 35 && b - g > 25) return true;
    return false;
  }
  function scanBlue() {
    const hits = [];
    const els = document.querySelectorAll('body *');
    for (const el of els) {
      const r = el.getClientRects();
      if (!r.length) continue;                  // not rendered
      const st = getComputedStyle(el);
      if (st.visibility === 'hidden' || st.opacity === '0') continue;
      const props = {
        color: st.color,
        backgroundColor: st.backgroundColor,
        borderTopColor: st.borderTopColor,
        borderBottomColor: st.borderBottomColor,
        borderLeftColor: st.borderLeftColor,
        borderRightColor: st.borderRightColor,
        outlineColor: st.outlineColor,
        fill: st.fill,
        stroke: st.stroke,
      };
      for (const [k,v] of Object.entries(props)) {
        // borders only count if there's an actual border width
        if (k.startsWith('border')) {
          const side = k.replace('Color','Width');
          if (parseFloat(st[side] || '0') === 0) continue;
        }
        if (k === 'outlineColor' && parseFloat(st.outlineWidth||'0') === 0) continue;
        if (isBlue(v)) {
          hits.push({
            tag: el.tagName.toLowerCase(),
            cls: (el.className && el.className.toString) ? el.className.toString().slice(0,80) : '',
            prop: k, value: v,
            text: (el.textContent||'').trim().slice(0,40),
          });
        }
      }
    }
    // de-dupe by tag+prop+value+cls
    const seen = new Set(); const uniq = [];
    for (const h of hits) {
      const key = h.tag+'|'+h.prop+'|'+h.value+'|'+h.cls;
      if (seen.has(key)) continue; seen.add(key); uniq.push(h);
    }
    return uniq;
  }
  window.__scanBlue = scanBlue;
  `;
}

async function signIn(page) {
  const passSel = 'input[type="password"], input[name="password"]';
  await page.waitForTimeout(2500);

  // Console sign-in is an SPA with a single "Hanzo IAM" SSO button -> hanzo.id.
  if (!(await page.locator(passSel).first().isVisible().catch(() => false))) {
    const ssoBtn = page.getByRole("button", { name: /hanzo iam/i }).first();
    if (await ssoBtn.isVisible().catch(() => false)) {
      await ssoBtn.click();
      await page.waitForTimeout(4500);
      await page.waitForLoadState("networkidle", { timeout: 25000 }).catch(() => {});
    }
  }

  // hanzo.id login form: first text input = username/email, password input,
  // and a "Sign in" SUBMIT button. Avoid the "Continue with GitHub/Google" etc.
  await page.waitForSelector(passSel, { timeout: 25000 });
  // username/email is the visible non-password text input
  const emailBox = page
    .locator('input[type="email"], input[type="text"]:visible, input[name="username"]')
    .first();
  if (await emailBox.isVisible().catch(() => false)) {
    await emailBox.fill(USER);
  }
  await page.locator(passSel).first().fill(PASS);
  // the email/password form's submit button is labelled "Sign in"
  const submit = page.getByRole("button", { name: /^sign in$/i }).first();
  if (await submit.isVisible().catch(() => false)) await submit.click();
  else await page.locator(passSel).first().press("Enter");

  // Follow OAuth back to console; click any consent/authorize if shown.
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(2500);
    const url = page.url();
    if (url.includes(HOST) && !/\/auth\/(sign-in|iam\/callback)/.test(url)) break;
    const consent = page
      .getByRole("button", {
        name: /authorize|allow|consent|agree|^accept$/i,
      })
      .first();
    if (await consent.isVisible().catch(() => false))
      await consent.click().catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  }
}

async function firstOrgId(page) {
  // On the Organizations landing, grab the first org link href -> /organization/<id>
  return await page
    .$$eval("a[href*='/organization/']", (as) => {
      for (const a of as) {
        const m = a.getAttribute("href").match(/\/organization\/([^/?#]+)/);
        if (m) return m[1];
      }
      return null;
    })
    .catch(() => null);
}
async function firstProjectId(page) {
  return await page
    .$$eval("a[href*='/project/']", (as) => {
      for (const a of as) {
        const m = a.getAttribute("href").match(/\/project\/([^/?#]+)/);
        if (m) return m[1];
      }
      return null;
    })
    .catch(() => null);
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await ctx.addInitScript(blueDetectorSource());

  const R = {
    base: BASE,
    tag: TAG,
    signedIn: false,
    checks: {},
    blue: {},
    nav: {},
  };

  try {
    log(`\n[1] open ${BASE}`);
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(3000);
    log(`[2] sign in as ${USER}`);
    await signIn(page).catch((e) => log(`  ! sign-in: ${e.message}`));
    await page.waitForTimeout(3000);
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    const url = page.url();
    // Signed in only when the browser is actually ON the console origin (not
    // hanzo.id — whose OAuth URL embeds console.hanzo.ai in redirect_uri) and
    // off the /auth/* sign-in routes.
    const onConsole = (() => {
      try {
        return new URL(url).host === HOST;
      } catch {
        return false;
      }
    })();
    R.signedIn = onConsole && !/\/auth\//.test(new URL(url).pathname);
    log(`  · landed ${url} signedIn=${R.signedIn}`);

    const orgId = await firstOrgId(page);
    log(`[3] first org: ${orgId}`);
    if (!orgId) {
      log("  ! no org found — cannot continue deep checks");
    }

    // --- Org Settings / Billing ---
    if (orgId) {
      const settingsUrl = `${BASE}/organization/${orgId}/settings/billing`;
      log(`[4] org settings/billing: ${settingsUrl}`);
      await page.goto(settingsUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(5000);
      await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
      await shot(page, "billing");

      // KMS in settings nav?
      const settingsNavTitles = await page
        .$$eval("nav a, nav span", (els) =>
          els
            .map((e) => (e.textContent || "").trim())
            .filter((t) => t && t.length < 30),
        )
        .catch(() => []);
      const navText = (await page.locator("body").innerText().catch(() => "")) || "";
      R.checks.kmsInSettings = /(^|\b)KMS(\b|$)/m.test(
        settingsNavTitles.join("|"),
      );
      R.nav.settingsNavSample = settingsNavTitles.slice(0, 40);

      // blue scan on billing
      R.blue.billing = await page.evaluate(() => window.__scanBlue()).catch(() => []);
    }

    // --- A product page (traces) to scan chrome + sidebar ---
    const projId = await firstProjectId(page).catch(() => null);
    let pid = projId;
    if (!pid && orgId) {
      // open the org to reveal a project
      await page.goto(`${BASE}/organization/${orgId}`, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await page.waitForTimeout(4000);
      pid = await firstProjectId(page).catch(() => null);
    }
    log(`[5] first project: ${pid}`);
    if (pid) {
      const tracesUrl = `${BASE}/project/${pid}/traces`;
      log(`[6] product page: ${tracesUrl}`);
      await page.goto(tracesUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(5000);
      await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
      await shot(page, "product-traces");
      // sidebar screenshot (left 280px)
      await page
        .screenshot({
          path: `${OUT}/sidebar.png`,
          clip: { x: 0, y: 0, width: 280, height: 900 },
        })
        .catch(() => {});
      log(`  · screenshot ${OUT}/sidebar.png`);

      R.blue.product = await page.evaluate(() => window.__scanBlue()).catch(() => []);

      // --- chrome assertions on the product page ---
      const probe = await page.evaluate(() => {
        const bodyText = document.body.innerText || "";
        // version label
        const versionV4 = /v?4\.0\.0/.test(bodyText);
        // github-star widget
        const starWidget =
          /Star\s+HanzoCloud/i.test(bodyText) ||
          !!document.querySelector(
            'img[src*="img.shields.io/github/stars"]',
          );
        // wordmark "Hanzo" text in the sidebar header region (top-left 280x80)
        let wordmark = false;
        const headerEls = document.querySelectorAll("*");
        for (const el of headerEls) {
          const rs = el.getClientRects();
          if (!rs.length) continue;
          const r = rs[0];
          if (r.left < 260 && r.top < 80 && r.width < 260) {
            const t = (el.childElementCount === 0 ? el.textContent : "") || "";
            if (/^\s*Hanzo\s*$/.test(t)) wordmark = true;
          }
        }
        // app-selector (grid) position: find the LayoutGrid trigger (aria-label "Switch app")
        const appSel = document.querySelector('[aria-label="Switch app" i]');
        let appSelectorSide = "absent";
        if (appSel) {
          const r = appSel.getBoundingClientRect();
          // sidebar is ~256px wide; right corner if center.x > half the sidebar
          appSelectorSide = r.left + r.width / 2 > 128 ? "right" : "left";
        }
        // which nav groups render (SidebarGroupLabel)
        const groupLabels = Array.from(
          document.querySelectorAll(
            '[data-sidebar="group-label"], [class*="group-label" i]',
          ),
        )
          .map((e) => (e.textContent || "").trim())
          .filter(Boolean);
        // all top-level nav item titles
        const navTitles = Array.from(
          document.querySelectorAll('[data-sidebar="menu-button"] span, aside a span'),
        )
          .map((e) => (e.textContent || "").trim())
          .filter(Boolean);
        return {
          versionV4,
          starWidget,
          wordmark,
          appSelectorSide,
          groupLabels: [...new Set(groupLabels)],
          navTitles: [...new Set(navTitles)],
        };
      });
      R.checks.versionV4 = probe.versionV4;
      R.checks.starWidget = probe.starWidget;
      R.checks.wordmark = probe.wordmark;
      R.checks.appSelectorSide = probe.appSelectorSide;
      R.nav.groupLabels = probe.groupLabels;
      R.nav.navTitles = probe.navTitles;
    }
  } catch (e) {
    R.error = String(e && e.message ? e.message : e);
    log(`  !! ${R.error}`);
  } finally {
    await browser.close();
  }

  // Summarize blue
  const blueProduct = (R.blue.product || []).length;
  const blueBilling = (R.blue.billing || []).length;
  R.blueSummary = { product: blueProduct, billing: blueBilling };

  writeFileSync(`${OUT}/result.json`, JSON.stringify(R, null, 2));
  log(`\n===== RESULT (${TAG}) =====`);
  log(`signedIn:            ${R.signedIn}`);
  log(`blue chrome (product): ${blueProduct}`);
  log(`blue chrome (billing): ${blueBilling}`);
  log(`v4.0.0 present:      ${R.checks.versionV4}`);
  log(`star widget present: ${R.checks.starWidget}`);
  log(`wordmark present:    ${R.checks.wordmark}`);
  log(`app-selector side:   ${R.checks.appSelectorSide}`);
  log(`KMS in settings nav: ${R.checks.kmsInSettings}`);
  log(`nav group labels:    ${JSON.stringify(R.nav.groupLabels)}`);
  log(`result.json:         ${OUT}/result.json`);
  if (blueProduct) {
    log(`\nblue offenders (product, first 10):`);
    for (const h of (R.blue.product || []).slice(0, 10))
      log(`  - <${h.tag}> ${h.prop}=${h.value} cls="${h.cls}" "${h.text}"`);
  }
}

main();
