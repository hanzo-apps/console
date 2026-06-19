// https://github.com/t3-oss/t3-env/blob/e7e21095e00a477e37608783defda5a6a99586d0/packages/core/src/index.ts#L228
// unfortunately, we are not able to install t3-env in all our packaging as some rely on commonjs.
export const removeEmptyEnvVariables = (runtimeEnv: any) => {
  for (const [key, value] of Object.entries(runtimeEnv)) {
    if (value === "") {
      delete runtimeEnv[key];
    }
  }
  return runtimeEnv;
};

/**
 * Datastore env back-compat shim.
 *
 * Our datastore config is read from DATASTORE_* env vars. The legacy upstream
 * name was CLICKHOUSE_* (datastore IS our ClickHouse fork — the wire protocol
 * is unchanged, only our naming). Existing production deployments may still
 * set CLICKHOUSE_*, so for every DATASTORE_* var that is unset we fall back to
 * the matching CLICKHOUSE_* value. New DATASTORE_* always wins when present.
 *
 * Generic over the prefix swap so there is exactly one place that knows the
 * mapping; no per-variable enumeration to drift.
 */
export const applyDatastoreEnvBackCompat = (runtimeEnv: any) => {
  const NEW_PREFIX = "DATASTORE_";
  const LEGACY_PREFIX = "CLICKHOUSE_";
  for (const [key, value] of Object.entries(runtimeEnv)) {
    if (!key.startsWith(LEGACY_PREFIX) || value === undefined || value === "") {
      continue;
    }
    const newKey = NEW_PREFIX + key.slice(LEGACY_PREFIX.length);
    if (runtimeEnv[newKey] === undefined || runtimeEnv[newKey] === "") {
      runtimeEnv[newKey] = value;
    }
  }
  return runtimeEnv;
};
