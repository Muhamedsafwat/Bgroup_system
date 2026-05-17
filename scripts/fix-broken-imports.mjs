#!/usr/bin/env node
/**
 * Repair script for the on-error codemod: it inserted
 *   import { describeError } from "@/lib/zod-errors";
 * INSIDE a multi-line `import { ... }` block in some files, producing a
 * parse error. This script:
 *   1. Detects that exact pattern
 *   2. Removes the bad line
 *   3. Re-inserts a proper standalone import after the last valid import
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "src");

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile() && (p.endsWith(".ts") || p.endsWith(".tsx"))) yield p;
  }
}

const STRAY =
  /^import \{ describeError \} from "@\/lib\/zod-errors";\n/m;

let fixed = 0;

for (const file of walk(ROOT)) {
  const src = fs.readFileSync(file, "utf8");
  // Pattern: previous line opens an import (`import {`) and the next non-
  // empty line continues that import. The injected line is "between them".
  const lines = src.split("\n");
  let changed = false;
  for (let i = 1; i < lines.length - 1; i++) {
    if (lines[i] !== `import { describeError } from "@/lib/zod-errors";`) continue;
    const prev = lines[i - 1]?.trim();
    const next = lines[i + 1]?.trim();
    // Heuristic: we're inside another import if the previous line ends with
    // `{` OR `,` (a multi-line import in progress), AND the next line looks
    // like an identifier or `}`.
    const insideImport =
      (prev?.endsWith("{") || prev?.endsWith(",")) &&
      next &&
      !next.startsWith("import");
    if (insideImport) {
      lines.splice(i, 1);
      changed = true;
      // Decrement so we re-check this position in case multiple were injected.
      i--;
    }
  }
  if (!changed) continue;

  // Now re-insert a clean import line after the LAST valid import statement.
  let out = lines.join("\n");
  if (!/from\s+["']@\/lib\/zod-errors["']/.test(out)) {
    // Find the end of the import block. Walk until we hit a line that doesn't
    // start with `import`, `}`, a comment, or whitespace.
    const importBlock = out.match(/^((?:import[^;]*?;\s*\n+)+)/m);
    if (importBlock) {
      const idx = importBlock[0].length;
      out =
        out.slice(0, idx) +
        `import { describeError } from "@/lib/zod-errors";\n` +
        out.slice(idx);
    } else {
      out = `import { describeError } from "@/lib/zod-errors";\n` + out;
    }
  }

  fs.writeFileSync(file, out);
  fixed++;
  process.stdout.write(`  ${path.relative(ROOT, file)}\n`);
}

console.log(`\n✓ ${fixed} files repaired`);
