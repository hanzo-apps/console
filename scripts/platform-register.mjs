#!/usr/bin/env node
/**
 * platform-register.mjs — register/reconcile console on platform.hanzo.ai.
 *
 * Idempotent. Reads `.platform/console.yaml`, resolves every `{ kms: path }`
 * reference from kms.hanzo.ai, and reconciles the PaaS control plane via its
 * tRPC API (project -> environment -> applications -> docker provider -> env
 * -> domains). Re-running converges to the same state; it never duplicates.
 *
 * This is config-as-code for the PaaS. It does NOT build or deploy images —
 * CI builds + publishes to ghcr; here we only point the PaaS docker apps at
 * those images and wire their runtime. Deploy is triggered separately
 * (`.github/workflows/paas-deploy.yml` or `--deploy`).
 *
 * Zero npm dependencies: Node >=20 `fetch` + a tiny YAML reader for the
 * fixed, flat shape of `.platform/console.yaml`.
 *
 * Auth to the PaaS: `x-api-key` (Better Auth API key) from KMS.
 * Auth to KMS: `KMS_TOKEN` env (a KMS machine-identity token; in CI this is
 * minted at runtime — see paas-deploy.yml). Never hardcode secrets.
 *
 * Usage:
 *   KMS_TOKEN=… node scripts/platform-register.mjs            # reconcile
 *   KMS_TOKEN=… node scripts/platform-register.mjs --deploy   # + deploy now
 *   KMS_TOKEN=… node scripts/platform-register.mjs --image-tag sha-abc1234
 *   …                                                  --dry-run
 *
 * Flags:
 *   --image-tag <tag>  Override the ghcr tag for every app (immutable tag,
 *                      e.g. sha-<sha7> or vX.Y.Z). Defaults to each app's
 *                      configured tag. NEVER pass a floating tag (:latest/:main).
 *   --deploy           Trigger application.deploy after reconciling.
 *   --dry-run          Resolve + plan, print, change nothing.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SPEC_PATH = resolve(REPO_ROOT, ".platform/console.yaml");

const KMS_URL = process.env.KMS_URL || "https://kms.hanzo.ai";
const KMS_TOKEN = process.env.KMS_TOKEN || "";

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const opt = (f, d) => {
	const i = args.indexOf(f);
	return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const DRY_RUN = has("--dry-run");
const DO_DEPLOY = has("--deploy");
const IMAGE_TAG = opt("--image-tag", null);

const die = (msg) => {
	console.error(`\x1b[31m✗ ${msg}\x1b[0m`);
	process.exit(1);
};
const ok = (msg) => console.log(`\x1b[32m✓\x1b[0m ${msg}`);
const info = (msg) => console.log(`  ${msg}`);

// ── Minimal YAML reader ────────────────────────────────────────────────────
// Only the flat/nested-map + list-of-maps shapes used by console.yaml. Values
// may be `{ kms: path }` inline maps, scalars, or quoted strings. Not a general
// YAML parser — deliberately small and auditable.
function parseYaml(text) {
	const lines = text
		.split("\n")
		.map((l) => l.replace(/\t/g, "  "))
		.filter((l) => l.trim() !== "" && !/^\s*#/.test(l));
	let i = 0;
	const peekIndent = () => (i < lines.length ? lines[i].match(/^ */)[0].length : -1);

	function parseValue(raw) {
		const v = raw.trim();
		if (v === "") return undefined;
		const inlineKms = v.match(/^\{\s*kms:\s*([^}]+?)\s*\}$/);
		if (inlineKms) return { kms: inlineKms[1].trim() };
		if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
			return v.slice(1, -1);
		if (v === "true") return true;
		if (v === "false") return false;
		return v;
	}

	function parseBlock(indent) {
		// list?
		if (i < lines.length && lines[i].slice(indent).startsWith("- ")) {
			const arr = [];
			while (i < lines.length && peekIndent() === indent && lines[i].slice(indent).startsWith("- ")) {
				const first = lines[i];
				const rest = first.slice(indent + 2);
				lines[i] = " ".repeat(indent + 2) + rest;
				arr.push(parseBlock(indent + 2));
			}
			return arr;
		}
		// map
		const obj = {};
		while (i < lines.length && peekIndent() === indent) {
			const line = lines[i];
			const m = line.slice(indent).match(/^([A-Za-z0-9_.-]+):\s?(.*)$/);
			if (!m) break;
			const key = m[1];
			const inline = m[2];
			i++;
			if (inline === "" || inline === undefined) {
				const childIndent = peekIndent();
				if (childIndent > indent) obj[key] = parseBlock(childIndent);
				else obj[key] = null;
			} else {
				obj[key] = parseValue(inline);
			}
		}
		return obj;
	}
	return parseBlock(peekIndent());
}

// ── KMS ────────────────────────────────────────────────────────────────────
const kmsCache = new Map();
async function kmsGet(path) {
	if (kmsCache.has(path)) return kmsCache.get(path);
	if (!KMS_TOKEN) die("KMS_TOKEN not set — cannot resolve secrets from KMS");
	const slash = path.lastIndexOf("/");
	const org = "hanzo";
	const name = slash >= 0 ? path.slice(slash + 1) : path;
	// console.yaml uses `org-prefixed/NAME`; the leading segment is the KMS
	// "folder"/project. We query by org=hanzo and select by secret name.
	const url = `${KMS_URL}/v1/kms/orgs/${org}/secrets/${encodeURIComponent(name)}`;
	const res = await fetch(url, { headers: { Authorization: `Bearer ${KMS_TOKEN}` } });
	if (!res.ok) die(`KMS read failed for "${path}" (${res.status} ${res.statusText})`);
	const body = await res.json();
	const value = body?.secret?.value ?? body?.value;
	if (value == null) die(`KMS secret "${path}" has no value`);
	kmsCache.set(path, value);
	return value;
}

// Resolve any `{ kms: path }` leaves in an object to their secret values.
async function resolveRefs(node) {
	if (node && typeof node === "object" && !Array.isArray(node)) {
		if (typeof node.kms === "string" && Object.keys(node).length === 1) {
			return DRY_RUN ? `«kms:${node.kms}»` : await kmsGet(node.kms);
		}
		const out = {};
		for (const [k, v] of Object.entries(node)) out[k] = await resolveRefs(v);
		return out;
	}
	if (Array.isArray(node)) return Promise.all(node.map(resolveRefs));
	return node;
}

// ── PaaS tRPC client ─────────────────────────────────────────────────────
// tRPC v11 single (non-batched) call: POST {serverUrl}/api/trpc/{path}
// query  -> GET  ?input=<superjson-json>
// mutation -> POST body { "json": <input> }
// Auth: x-api-key header.
class Trpc {
	constructor(serverUrl, apiKey) {
		this.base = `${serverUrl.replace(/\/$/, "")}/api/trpc`;
		this.apiKey = apiKey;
	}
	async query(path, input) {
		const qs = input ? `?input=${encodeURIComponent(JSON.stringify({ json: input }))}` : "";
		return this.#send("GET", `${this.base}/${path}${qs}`);
	}
	async mutate(path, input) {
		return this.#send("POST", `${this.base}/${path}`, { json: input });
	}
	async #send(method, url, body) {
		const res = await fetch(url, {
			method,
			headers: {
				"content-type": "application/json",
				"x-api-key": this.apiKey,
			},
			body: body ? JSON.stringify(body) : undefined,
		});
		const text = await res.text();
		let parsed;
		try {
			parsed = text ? JSON.parse(text) : {};
		} catch {
			die(`PaaS non-JSON response from ${url}: ${text.slice(0, 200)}`);
		}
		if (!res.ok || parsed?.error) {
			const m = parsed?.error?.json?.message || parsed?.error?.message || res.statusText;
			die(`PaaS ${method} ${url.replace(this.base, "")} -> ${res.status}: ${m}`);
		}
		// superjson result envelope: { result: { data: { json: <value> } } }
		return parsed?.result?.data?.json ?? parsed?.result?.data ?? parsed;
	}
}

// Render an env object into dotenv format (the PaaS stores `env` as a blob).
function toDotenv(env) {
	return Object.entries(env || {})
		.map(([k, v]) => `${k}=${v}`)
		.join("\n");
}

// ── Reconcile ──────────────────────────────────────────────────────────────
async function main() {
	const raw = readFileSync(SPEC_PATH, "utf8");
	const spec = parseYaml(raw);

	const p = spec.platform || {};
	if (!p.serverUrl) die("spec.platform.serverUrl missing");
	if (!p.project) die("spec.platform.project missing");
	if (!p.environment) die("spec.platform.environment missing");

	const apiKey = await resolveRefs(p.api?.keyRef);
	if (!apiKey) die("spec.platform.api.keyRef did not resolve to an API key");

	const registry = await resolveRefs(spec.registry || {});

	console.log(`\nplatform.hanzo.ai PaaS reconcile — console`);
	console.log(`  server : ${p.serverUrl}`);
	console.log(`  project: ${p.project} / env ${p.environment}`);
	if (IMAGE_TAG) console.log(`  tag    : ${IMAGE_TAG} (override)`);
	if (DRY_RUN) console.log(`  mode   : DRY RUN (no changes)\n`);
	else console.log("");

	const api = new Trpc(p.serverUrl, DRY_RUN ? "dry-run" : apiKey);

	// 1) project (match by name, else create)
	const projects = DRY_RUN ? [] : await api.query("project.all");
	let project = (projects || []).find((x) => x.name === p.project);
	if (!project) {
		info(`project "${p.project}" not found — creating`);
		project = DRY_RUN
			? { projectId: "«new»", environments: [] }
			: await api.mutate("project.create", { name: p.project, description: "Hanzo Console" });
	}
	ok(`project ${project.projectId}`);

	// 2) environment (match by name within project, else create)
	let env = (project.environments || []).find((e) => e.name === p.environment);
	if (!env) {
		info(`environment "${p.environment}" not found — creating`);
		env = DRY_RUN
			? { environmentId: "«new»" }
			: await api.mutate("environment.create", {
					name: p.environment,
					projectId: project.projectId,
				});
	}
	ok(`environment ${env.environmentId}`);

	// existing apps in this environment (for idempotent match by appName)
	const existingApps = (env.applications || []).reduce((m, a) => {
		m[a.name] = a;
		return m;
	}, {});

	// 3) applications
	for (const app of spec.applications || []) {
		console.log(`\n── ${app.appName} ──`);

		// image tag: --image-tag override wins, else the configured tag
		let image = app.source?.image || "";
		if (IMAGE_TAG) image = image.replace(/:[^/:]+$/, "") + `:${IMAGE_TAG}`;
		if (/:(latest|main|master|dev|edge|nightly)$/.test(image))
			die(`refusing floating tag for ${app.appName}: ${image} (immutable tags only)`);

		// create if absent
		let existing = existingApps[app.name];
		let applicationId = existing?.applicationId;
		if (!applicationId) {
			info(`application "${app.appName}" not found — creating`);
			const created = DRY_RUN
				? { applicationId: "«new»" }
				: await api.mutate("application.create", {
						name: app.name,
						appName: app.appName,
						description: app.description || "",
						environmentId: env.environmentId,
					});
			applicationId = created.applicationId;
		}
		ok(`application ${applicationId}`);

		// docker provider: image + ghcr pull creds
		info(`docker provider -> ${image}`);
		if (!DRY_RUN)
			await api.mutate("application.saveDockerProvider", {
				applicationId,
				dockerImage: image,
				registryUrl: registry.url || "ghcr.io",
				username: registry.usernameRef ?? registry.username,
				password: registry.passwordRef ?? registry.password,
			});

		// runtime env (resolve KMS refs, write as dotenv blob)
		const envResolved = await resolveRefs(app.env || {});
		const dotenv = toDotenv(envResolved);
		info(`env -> ${Object.keys(envResolved).length} vars` + (DRY_RUN ? `\n${dotenv.replace(/^/gm, "      ")}` : ""));
		if (!DRY_RUN)
			await api.mutate("application.saveEnvironment", {
				applicationId,
				env: dotenv,
				createEnvFile: false,
			});

		// domains (create any not already present by host)
		const haveDomains = DRY_RUN
			? []
			: ((existing && (await api.query("domain.byApplicationId", { applicationId }))) || []);
		const haveHosts = new Set((haveDomains || []).map((d) => d.host));
		for (const d of app.domains || []) {
			if (haveHosts.has(d.host)) {
				info(`domain ${d.host} exists`);
				continue;
			}
			info(`domain ${d.host} -> create (https=${!!d.https})`);
			if (!DRY_RUN)
				await api.mutate("domain.create", {
					applicationId,
					host: d.host,
					path: d.path || "/",
					port: d.port || app.port || 3000,
					https: !!d.https,
					certificateType: d.certificateType || (d.https ? "letsencrypt" : "none"),
					domainType: "application",
				});
		}

		// deploy (opt-in)
		if (DO_DEPLOY) {
			info(`deploy -> queue`);
			if (!DRY_RUN)
				await api.mutate("application.deploy", {
					applicationId,
					title: IMAGE_TAG ? `Deploy ${IMAGE_TAG}` : "Reconcile deploy",
				});
		}
	}

	console.log("");
	ok(DRY_RUN ? "dry run complete — no changes made" : "reconcile complete");
}

main().catch((e) => die(e?.stack || String(e)));
