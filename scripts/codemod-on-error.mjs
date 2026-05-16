#!/usr/bin/env node
/**
 * Replaces React-Query/mutation `onError: () => toast.error("X")` with
 * `onError: (err: unknown) => toast.error(describeError(err) || "X")` so the
 * actual cause (server message, network failure, etc.) reaches the user
 * instead of a generic hard-coded fallback.
 *
 * Also handles the `toast({ title: ..., description: "X" })` shape (the HR
 * pages use the older shadcn toast API) by stitching `describeError(err)`
 * into the description.
 *
 * Conservative: only triggers on the exact zero-arg arrow pattern. Hand-
 * written handlers that already accept the error are skipped.
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

const PATTERNS = [
  // onError: () => toast.error("X")
  {
    re: /onError:\s*\(\s*\)\s*=>\s*toast\.error\(\s*(['"`])([^'"`]+)\1\s*\)/g,
    fix: (_full, q, msg) =>
      `onError: (__err: unknown) => toast.error(describeError(__err) || ${q}${msg}${q})`,
  },
  // onError: () => toast({ ..., description: "X" })
  // (shadcn legacy API). Insert describeError into description.
  {
    re: /onError:\s*\(\s*\)\s*=>\s*toast\(\s*\{\s*([^}]*?)description:\s*(['"`])([^'"`]+)\2([^}]*?)\}\s*\)/g,
    fix: (_full, before, q, desc, after) =>
      `onError: (__err: unknown) => toast({ ${before}description: describeError(__err) || ${q}${desc}${q}${after}})`,
  },
];

let touched = 0;
let total = 0;

for (const file of walk(ROOT)) {
  const src = fs.readFileSync(file, "utf8");
  let out = src;
  let touchedThis = false;
  for (const { re, fix } of PATTERNS) {
    if (re.test(out)) {
      re.lastIndex = 0;
      out = out.replace(re, (...args) => {
        total++;
        touchedThis = true;
        return fix(...args);
      });
    }
  }
  if (!touchedThis) continue;

  // Insert import if missing
  if (!/from\s+["']@\/lib\/zod-errors["']/.test(out)) {
    const lastImport = out.match(/(^import[^\n]*\n)+/m);
    if (lastImport) {
      const idx = lastImport.index + lastImport[0].length;
      out =
        out.slice(0, idx) +
        `import { describeError } from "@/lib/zod-errors";\n` +
        out.slice(idx);
    } else {
      out = `import { describeError } from "@/lib/zod-errors";\n` + out;
    }
  } else if (!/describeError/.test(out)) {
    // Already imports from the module but not the right symbol — add it.
    out = out.replace(
      /import\s*\{\s*([^}]+)\}\s*from\s*["']@\/lib\/zod-errors["']/,
      (_m, imports) => `import { ${imports.trim()}, describeError } from "@/lib/zod-errors"`
    );
  }

  fs.writeFileSync(file, out);
  touched++;
  process.stdout.write(`  ${path.relative(ROOT, file)}\n`);
}

console.log(`\n✓ ${touched} files touched, ${total} handlers updated`);
