#!/usr/bin/env node
/**
 * One-shot codemod that replaces `parsed.error.issues[0].message` with the
 * structured `describeZodError` call across every API route in src/app/api.
 *
 * Before:
 *   return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
 *
 * After:
 *   const __z = describeZodError(parsed.error);
 *   return NextResponse.json({ error: __z.message, fieldErrors: __z.fieldErrors }, { status: 400 });
 *
 * Also inserts `import { describeZodError } from "@/lib/zod-errors";` near
 * the existing imports if missing.
 *
 * The replacement is conservative: only triggers on the exact "return
 * NextResponse.json(...issues[0].message...)" idiom — handwritten variants
 * (custom error shapes, throw-statements) are left alone so the codemod
 * can't break anything subtle.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "src", "app", "api");

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile() && p.endsWith(".ts")) yield p;
  }
}

let touched = 0;
let replaced = 0;

const PATTERN =
  /return NextResponse\.json\(\s*\{\s*error:\s*([a-zA-Z_$][\w$]*)\.error\.issues\[0\]\.message\s*\}\s*,\s*\{\s*status:\s*(\d+)\s*\}\s*\)\s*;/g;

for (const file of walk(ROOT)) {
  const src = fs.readFileSync(file, "utf8");
  if (!PATTERN.test(src)) continue;
  PATTERN.lastIndex = 0;

  let out = src.replace(PATTERN, (_full, varname, status) => {
    replaced++;
    return (
      `{ const __z = describeZodError(${varname}.error); ` +
      `return NextResponse.json({ error: __z.message, fieldErrors: __z.fieldErrors }, { status: ${status} }); }`
    );
  });

  // Insert import if missing.
  if (!/from\s+["']@\/lib\/zod-errors["']/.test(out)) {
    // Place after the last existing import.
    const lastImport = out.match(/(^import[^\n]*\n)+/m);
    if (lastImport) {
      const idx = lastImport.index + lastImport[0].length;
      out =
        out.slice(0, idx) +
        `import { describeZodError } from "@/lib/zod-errors";\n` +
        out.slice(idx);
    } else {
      out =
        `import { describeZodError } from "@/lib/zod-errors";\n` + out;
    }
  }

  fs.writeFileSync(file, out);
  touched++;
  process.stdout.write(`  ${path.relative(ROOT, file)}\n`);
}

console.log(`\n✓ ${touched} files touched, ${replaced} call sites rewritten`);
