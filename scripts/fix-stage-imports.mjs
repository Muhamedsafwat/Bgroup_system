#!/usr/bin/env node
/**
 * Move `import type { CrmOpportunityStage } from "@/types"` lines that
 * the previous codemod inserted INSIDE multi-line import blocks. Same
 * fix the describeError repair did, but for this symbol.
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

const LINE = `import type { CrmOpportunityStage } from "@/types";`;

let fixed = 0;
for (const file of walk(ROOT)) {
  const src = fs.readFileSync(file, "utf8");
  const lines = src.split("\n");
  let changed = false;
  for (let i = 1; i < lines.length - 1; i++) {
    if (lines[i] !== LINE) continue;
    const prev = lines[i - 1]?.trim();
    const next = lines[i + 1]?.trim();
    const insideImport =
      (prev?.endsWith("{") || prev?.endsWith(",")) &&
      next &&
      !next.startsWith("import");
    if (insideImport) {
      lines.splice(i, 1);
      changed = true;
      i--;
    }
  }
  if (!changed) continue;
  let out = lines.join("\n");
  if (!/from\s+["']@\/types["']/.test(out) || !/CrmOpportunityStage/.test(out)) {
    const importBlock = out.match(/^((?:import[^;]*?;\s*\n+)+)/m);
    if (importBlock) {
      const idx = importBlock[0].length;
      out = out.slice(0, idx) + LINE + "\n" + out.slice(idx);
    } else {
      out = LINE + "\n" + out;
    }
  }
  // If file starts with "use client" / "use server" pragma + the import we
  // re-added is now above it, move it down.
  const pragmaIdx = out.search(/^\s*['"]use (client|server)['"];?/m);
  if (pragmaIdx > 0 && out.slice(0, pragmaIdx).includes(LINE)) {
    const before = out.slice(0, pragmaIdx).replace(LINE + "\n", "");
    const pragmaLine = out.slice(pragmaIdx).match(/^[^\n]*\n/)?.[0] ?? "";
    const after = out.slice(pragmaIdx + pragmaLine.length);
    out = before + pragmaLine + "\n" + LINE + "\n" + after;
  }
  fs.writeFileSync(file, out);
  fixed++;
  process.stdout.write(`  ${path.relative(ROOT, file)}\n`);
}
console.log(`\n✓ ${fixed} files repaired`);
