import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
mkdirSync("/tmp/console-verify/dbg", { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto("https://console.hanzo.ai", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(4000);
await page.screenshot({ path: "/tmp/console-verify/dbg/01-console-landing.png" });
const dump = async (label) => {
  const els = await page.$$eval("input,button,a", (ns) => ns.map(e => ({
    tag: e.tagName, type: e.getAttribute("type"), name: e.getAttribute("name"),
    txt:(e.textContent||"").trim().slice(0,40),
    vis: !!(e.offsetParent || e.getClientRects().length)
  })).filter(x=>x.vis));
  console.log(`\n[${label}] ${page.url()}`);
  console.log(JSON.stringify(els.slice(0,20)));
};
await dump("console-signin-page");
// click the IAM/SSO sign-in button if present
const btn = page.getByRole("button", { name: /sign ?in|hanzo|iam|continue|log ?in/i }).first();
if (await btn.isVisible().catch(()=>false)) { console.log("clicking:", (await btn.textContent())?.trim()); await btn.click(); await page.waitForTimeout(5000); }
await page.screenshot({ path: "/tmp/console-verify/dbg/02-after-signin-click.png" });
await dump("after-click");
await browser.close();
