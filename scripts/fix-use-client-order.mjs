#!/usr/bin/env node
/**
 * Move accidentally-placed `import { describeError } ...` lines that ended
 * up BEFORE a `'use client'` directive. The "use client" pragma must be the
 * first non-comment, non-whitespace token in a file — having any import
 * above it is a build-time error.
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

let fixed = 0;

for (const file of walk(ROOT)) {
  const src = fs.readFileSync(file, "utf8");
  // Pattern: import line above "use client". Move the import to AFTER it.
  if (!src.includes("describeError")) continue;
  const lines = src.split("\n");
  let useClientIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*['"]use client['"];?\s*$/.test(lines[i])) {
      useClientIdx = i;
      break;
    }
  }
  if (useClientIdx <= 0) continue;
  // Find any import-lines above it.
  const aboveImports = [];
  for (let i = 0; i < useClientIdx; i++) {
    if (/^import\b/.test(lines[i])) aboveImports.push(i);
  }
  if (aboveImports.length === 0) continue;

  // Pull those import lines out.
  const movedLines = aboveImports.map((i) => lines[i]);
  // Remove from highest index first to preserve lower indexes.
  for (let i = aboveImports.length - 1; i >= 0; i--) {
    lines.splice(aboveImports[i], 1);
  }
  // Recompute useClientIdx (it shifted up by the count of removals).
  const newUseClientIdx = useClientIdx - aboveImports.length;
  // Insert the imports just after the use-client line (and a blank line).
  lines.splice(newUseClientIdx + 1, 0, "", ...movedLines);

  fs.writeFileSync(file, lines.join("\n"));
  fixed++;
  process.stdout.write(`  ${path.relative(ROOT, file)}\n`);
}

console.log(`\n✓ ${fixed} files reordered`);
