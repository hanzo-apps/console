// Normalize capnp-es output to the repo's import convention.
// 1. Rewrite cross-file imports ".//<name>.js" -> "./<name>" (extensionless,
//    matching the repo; collapses the double slash capnp-es emits).
// 2. Drop imported names that are not referenced in the file body (capnp-es
//    imports every exported symbol of a dependency whether used or not).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const outDir = process.argv[2];
if (!outDir) {
  console.error("usage: normalize-gen.mjs <gen-dir>");
  process.exit(1);
}

for (const file of readdirSync(outDir)) {
  if (!file.endsWith(".ts")) continue;
  const path = join(outDir, file);
  let src = readFileSync(path, "utf8");

  src = src.replace(
    /import \{([^}]*)\} from "\.\/+([\w-]+)\.js";/g,
    (_m, names, mod) => {
      const used = names
        .split(",")
        .map((n) => n.trim())
        .filter(Boolean)
        // keep a name only if it appears again outside this import line
        .filter((n) => {
          const re = new RegExp(`\\b${n.replace(/\$/g, "\\$")}\\b`, "g");
          const count = (src.match(re) || []).length;
          return count > 1;
        });
      return `import { ${used.join(", ")} } from "./${mod}";`;
    },
  );

  writeFileSync(path, src);
}
