#!/usr/bin/env node
/**
 * Move `CrmOpportunityStage` from the Prisma-generated import to the local
 * @/types alias (now `type CrmOpportunityStage = string`). Files affected
 * are listed by the typecheck failures.
 *
 * For each .ts/.tsx file:
 *   1. If it has `import type { …CrmOpportunityStage… } from "@/generated/prisma"`
 *      remove `CrmOpportunityStage` from that import list.
 *   2. Add `import type { CrmOpportunityStage } from "@/types"` if the
 *      symbol is still referenced and isn't imported from "@/types" already.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "src");

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "generated") continue;
      yield* walk(p);
    } else if (e.isFile() && (p.endsWith(".ts") || p.endsWith(".tsx"))) {
      yield p;
    }
  }
}

let touched = 0;

for (const file of walk(ROOT)) {
  const src = fs.readFileSync(file, "utf8");
  if (!src.includes("CrmOpportunityStage")) continue;

  let out = src;
  let changed = false;

  // Strip CrmOpportunityStage from imports of @/generated/prisma.
  out = out.replace(
    /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["']@\/generated\/prisma["']/g,
    (full, members) => {
      if (!members.includes("CrmOpportunityStage")) return full;
      const cleaned = members
        .split(",")
        .map((m) => m.trim())
        .filter((m) => m && m !== "CrmOpportunityStage")
        .join(", ");
      changed = true;
      if (cleaned.length === 0) {
        return ""; // drop the whole import statement
      }
      const isTypeOnly = full.startsWith("import type") ? "type " : "";
      return `import ${isTypeOnly}{ ${cleaned} } from "@/generated/prisma"`;
    }
  );
  // Clean any leftover empty `;\n` from a wiped import.
  out = out.replace(/^\s*;\s*\n/gm, "");

  if (!changed) continue;

  // Add the type import from @/types if not already present.
  if (!/from\s+["']@\/types["']/.test(out)) {
    const lastImport = out.match(/(^import[^\n]*\n)+/m);
    if (lastImport) {
      const idx = lastImport.index + lastImport[0].length;
      out =
        out.slice(0, idx) +
        `import type { CrmOpportunityStage } from "@/types";\n` +
        out.slice(idx);
    } else {
      out = `import type { CrmOpportunityStage } from "@/types";\n` + out;
    }
  } else if (!/import[^;]*CrmOpportunityStage[^;]*from\s+["']@\/types["']/.test(out)) {
    // @/types already imported but not the right symbol — add it.
    out = out.replace(
      /import\s+(?:type\s+)?\{\s*([^}]+)\}\s+from\s+["']@\/types["']/,
      (m, members) => {
        const isTypeOnly = m.startsWith("import type") ? "type " : "";
        return `import ${isTypeOnly}{ ${members.trim()}, CrmOpportunityStage } from "@/types"`;
      }
    );
  }

  fs.writeFileSync(file, out);
  touched++;
  process.stdout.write(`  ${path.relative(ROOT, file)}\n`);
}

console.log(`\n✓ ${touched} files migrated`);
