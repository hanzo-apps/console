/**
 * Live Job-1 verification for console.hanzo.ai: Vector, Search, Models,
 * Prompts. Headless OIDC login (Hanzo IAM) as the superuser, then exercise each
 * product's backend DIRECTLY over the live /v1/trpc endpoint using the signed-in
 * session cookie — the authoritative proof that the tRPC procedures resolve
 * (no 500, no empty-because-dead-backend).
 *
 * Usage:
 *   CONSOLE_PASS='IloveHanzo2026!!!' TAG=after node scripts/verify-job1.mjs
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.CONSOLE_URL ?? "https://console.hanzo.ai";
const USER = process.env.CONSOLE_USER ?? "z@hanzo.ai";
const PASS = process.env.CONSOLE_PASS ?? "IloveHanzo2026!!!";
const TAG = process.env.TAG ?? "run";
const PROJECT_ID = process.env.PROJECT_ID || "";
const OUT = process.env.OUT_DIR ?? `/tmp/job1-verify/${TAG}`;
const HOST = new URL(BASE).host;
mkdirSync(OUT, { recursive: true });

const log = (m) => console.log(m);
const R = { base: BASE, tag: TAG, signedIn: false, projectId: null, matrix: {}, raw: {}, errors: [] };
const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true }).catch(() => {});
const onAuth = (u) => /\/auth\//.test(new URL(u).pathname);

async function signIn(page) {
  const passSel = 'input[type="password"], input[name="password"]';
  // Let the sign-in page render, then — if it's the federated chooser (no
  // password field, just a "Sign in with Hanzo IAM" button/link) — follow it.
  await page.waitForTimeout(2800);
  if (!(await page.locator(passSel).first().isVisible().catch(() => false))) {
    const sso = page.getByRole("button", { name: /hanzo iam|sign in with|continue with|sso/i })
      .or(page.getByRole("link", { name: /hanzo iam|sign in with|continue with|sso/i }))
      .first();
    if (await sso.isVisible().catch(() => false)) {
      await sso.click().catch(() => {});
      await page.waitForTimeout(4500);
      await page.waitForLoadState("networkidle", { timeout: 25000 }).catch(() => {});
    }
  }
  // Fill credentials on the IAM login form.
  await page.waitForSelector(passSel, { timeout: 30000 });
  const email = page.locator('input[type="email"], input[name="username"], input[type="text"]:visible').first();
  if (await email.isVisible().catch(() => false)) await email.fill(USER);
  await page.locator(passSel).first().fill(PASS);
  const submit = page.getByRole("button", { name: /^sign in$|^log in$|^continue$/i }).first();
  if (await submit.isVisible().catch(() => false)) await submit.click();
  else await page.locator(passSel).first().press("Enter");

  // Drive through consent + the OIDC callback exchange. Poll up to ~75s for the
  // app to land back on a non-/auth/ console URL (session established).
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(2500);
    const u = page.url();
    if (u.includes(HOST) && !onAuth(u)) return true;
    const consent = page.getByRole("button", { name: /authorize|allow|consent|agree|^accept$|approve/i }).first();
    if (await consent.isVisible().catch(() => false)) await consent.click().catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  }
  return page.url().includes(HOST) && !onAuth(page.url());
}

async function findProjectId(page) {
  const readLink = (sel, re) =>
    page.$$eval(sel, (as, reStr) => {
      const r = new RegExp(reStr);
      for (const a of as) { const m = (a.getAttribute("href") || "").match(r); if (m) return m[1]; }
      return null;
    }, re).catch(() => null);

  if (PROJECT_ID) {
    await page.goto(`${BASE}/project/${PROJECT_ID}`, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(1500);
    if (!/page not found|could not be found/i.test(await page.content().catch(() => ""))) return PROJECT_ID;
  }
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(2500);
  let pid = await readLink("a[href*='/project/']", "/project/([^/?#]+)");
  if (pid) return pid;
  const org = await readLink("a[href*='/organization/']", "/organization/([^/?#]+)");
  if (org) {
    await page.goto(`${BASE}/organization/${org}`, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(1500);
    pid = await readLink("a[href*='/project/']", "/project/([^/?#]+)");
  }
  return pid;
}

// One tRPC call (superjson envelope) against live /v1/trpc using page cookies.
async function trpc(page, kind, proc, input) {
  return page.evaluate(async ({ kind, proc, input }) => {
    const wrap = encodeURIComponent(JSON.stringify({ 0: { json: input } }));
    const res = kind === "query"
      ? await fetch(`/v1/trpc/${proc}?batch=1&input=${wrap}`, { headers: { "content-type": "application/json" } })
      : await fetch(`/v1/trpc/${proc}?batch=1`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ 0: { json: input } }) });
    const txt = await res.text();
    let data; try { data = JSON.parse(txt); } catch { data = txt; }
    return { status: res.status, data };
  }, { kind, proc, input });
}
function unwrap(r) {
  const e = Array.isArray(r.data) ? r.data[0] : r.data;
  if (e && e.error) return { ok: false, status: r.status, code: e.error?.json?.data?.code ?? e.error?.json?.code, error: e.error?.json?.message ?? JSON.stringify(e.error) };
  return { ok: true, status: r.status, json: e?.result?.data?.json ?? e?.result?.data };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  try {
    log(`[1] goto ${BASE}`);
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
    log(`[2] sign in ${USER}`);
    R.signedIn = await signIn(page).catch((e) => { R.errors.push(`signin: ${e.message}`); return false; });
    log(`  landed ${page.url()} signedIn=${R.signedIn}`);
    await shot(page, "01-landed");
    if (!R.signedIn) throw new Error("sign-in did not complete");

    const pid = await findProjectId(page);
    R.projectId = pid;
    log(`[3] projectId=${pid}`);
    if (!pid) throw new Error("no project id");
    // Land inside the project so relative /v1/trpc fetches are same-origin authed.
    await page.goto(`${BASE}/project/${pid}`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const stamp = Date.now().toString().slice(-6);

    // ── VECTOR ────────────────────────────────────────────────────────
    log("[V] vector createCollection(1536,cosine) + list + upsert/search");
    const vName = `verify-${TAG}-${stamp}`;
    const vCreate = unwrap(await trpc(page, "mutation", "vector.createCollection", { projectId: pid, name: vName, dimension: 1536, distanceMetric: "cosine" }));
    const vList = unwrap(await trpc(page, "query", "vector.listCollections", { projectId: pid }));
    const vNames = (vList.json?.collections ?? []).map((c) => c.name);
    // small round-trip
    const rt = `rt-${TAG}-${stamp}`;
    await trpc(page, "mutation", "vector.createCollection", { projectId: pid, name: rt, dimension: 3, distanceMetric: "cosine" });
    await trpc(page, "mutation", "vector.upsert", { projectId: pid, collectionName: rt, vectors: [{ id: "a", values: [1, 0, 0] }, { id: "b", values: [0, 1, 0] }] });
    const vSearch = unwrap(await trpc(page, "query", "vector.search", { projectId: pid, collectionName: rt, queryVector: [1, 0, 0], limit: 1 }));
    R.raw.vector = { create: vCreate, search: vSearch };
    R.matrix.vector_createCollection = vCreate.ok && vNames.includes(vName);
    R.matrix.vector_searchRoundTrip = vSearch.ok && (vSearch.json?.results?.[0]?.id === "a");

    // ── SEARCH ────────────────────────────────────────────────────────
    log("[S] search stats + keys + createIndex + query");
    const sStats = unwrap(await trpc(page, "query", "search.stats", { projectId: pid }));
    const sKeys = unwrap(await trpc(page, "query", "search.getKeys", { projectId: pid }));
    const sList = unwrap(await trpc(page, "query", "search.listIndexes", { projectId: pid }));
    const sIdx = unwrap(await trpc(page, "mutation", "search.createIndex", { projectId: pid, storeName: `docs-${stamp}`, url: "https://example.com" }));
    const sQuery = unwrap(await trpc(page, "query", "search.query", { projectId: pid, query: "example domain", mode: "hybrid", limit: 5 }));
    R.raw.search = { stats: sStats, keys: sKeys, list: sList, createIndex: sIdx, query: sQuery };
    R.matrix.search_stats_ok = sStats.ok;
    R.matrix.search_keys_ok = sKeys.ok && typeof sKeys.json?.publishableKey === "string";
    R.matrix.search_createIndex_ok = sIdx.ok && !!sIdx.json?.index;
    R.matrix.search_query_ok = sQuery.ok && Array.isArray(sQuery.json?.results);

    // ── MODELS ────────────────────────────────────────────────────────
    log("[M] cloudModels.list populated");
    const mList = unwrap(await trpc(page, "query", "cloudModels.list", { projectId: pid }));
    R.raw.models = { count: mList.json?.data?.length, sample: (mList.json?.data ?? []).slice(0, 3).map((m) => m.id) };
    R.matrix.models_populated = mList.ok && (mList.json?.data?.length ?? 0) > 0;

    // ── PROMPTS ───────────────────────────────────────────────────────
    log("[P] prompts.create (no 500 from event-sourcing)");
    const pCreate = unwrap(await trpc(page, "mutation", "prompts.create", { projectId: pid, name: `verify-${TAG}-${stamp}`, type: "text", prompt: "Hello {{name}}", labels: [], config: {}, commitMessage: null }));
    R.raw.prompts = pCreate;
    // PASS = it did NOT 500 with an internal server error (success or a benign
    // validation/conflict is fine — the point is the queue no longer throws).
    R.matrix.prompts_create_no500 = pCreate.ok || (pCreate.code && pCreate.code !== "INTERNAL_SERVER_ERROR");

    await page.goto(`${BASE}/project/${pid}/models`, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await shot(page, "02-models");
    await page.goto(`${BASE}/project/${pid}/search`, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await shot(page, "03-search");
  } catch (e) {
    R.errors.push(`fatal: ${e.message}`);
  } finally {
    await browser.close();
  }
  const pass = Object.values(R.matrix).filter(Boolean).length;
  const total = Object.keys(R.matrix).length;
  log("\n==== JOB-1 MATRIX ====");
  for (const [k, v] of Object.entries(R.matrix)) log(`  ${v ? "✅" : "❌"} ${k}`);
  log(`  ${pass}/${total} green`);
  log("\n==== DETAIL ====");
  log(JSON.stringify(R, null, 2));
}
main();
