import fs from 'fs';

const highs = JSON.parse(
  fs.readFileSync('c:/Users/Ibrahim Elmur/Desktop/BGroup Super App/super-app/AUDIT_v12_HIGH.json', 'utf8'),
);
const compact = highs.map((h, i) => ({
  rank: h.rank ?? (i + 1),
  file: h.file,
  summary: h.summary,
  scenario: (h.scenario || '').slice(0, 400),
  recommended_fix: (h.recommended_fix || '').slice(0, 500),
}));

const dataLiteral = JSON.stringify(compact);

const script = `export const meta = {
  name: 'v12-high-remediation',
  description: 'Fix 43 v12 HIGH findings in parallel + adversarial per-fix verification + synthesis.',
  phases: [
    { title: 'Implement', detail: '43 parallel implementer agents' },
    { title: 'Verify', detail: 'Per-fix adversarial verifier' },
    { title: 'Synthesise', detail: 'Final manifest' },
  ],
};

const HIGHS = ${dataLiteral};
const PROJECT_ROOT = 'c:\\\\Users\\\\Ibrahim Elmur\\\\Desktop\\\\BGroup Super App\\\\super-app';

phase('Implement');

const FIX_RESULT = {
  type: 'object',
  properties: {
    finding_id: { type: 'string' },
    files_modified: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    tsc_clean: { type: 'boolean' },
    unresolved: { type: 'string' },
  },
  required: ['finding_id', 'files_modified', 'summary', 'tsc_clean', 'unresolved'],
};

async function fixOne(crit) {
  const prompt = [
    'You are an implementer. Apply ONE v12 HIGH fix to the codebase.',
    'Project root: ' + PROJECT_ROOT,
    'super-app/ is the workspace.',
    '',
    '=== FINDING HIGH-' + crit.rank + ' ===',
    'File(s): ' + crit.file,
    'Summary: ' + crit.summary,
    'Scenario: ' + crit.scenario,
    'Recommended fix: ' + crit.recommended_fix,
    '',
    'Rules:',
    '- Read the cited file(s) first.',
    '- Apply ONLY this fix; do not refactor unrelated code.',
    '- Tag your change with a comment referencing audit v12 HIGH.',
    '- Do NOT run prisma db push.',
    '- Run npx tsc --noEmit from super-app/; set tsc_clean=true only if exit 0 and no output.',
    '- If the code is already fixed (a previous workflow pass closed it), set summary to start with "already fixed" and tsc_clean=true.',
  ].join('\\n');
  return agent(prompt, { label: 'H-' + crit.rank, phase: 'Implement', schema: FIX_RESULT, model: 'sonnet' });
}

const implResults = await parallel(HIGHS.map((h) => () => fixOne(h)));
log('Implementation phase: ' + implResults.filter(Boolean).length + '/' + HIGHS.length + ' attempted.');

phase('Verify');

const VERDICT = {
  type: 'object',
  properties: {
    finding_id: { type: 'string' },
    verdict: { type: 'string', enum: ['FIXED', 'PARTIAL', 'NOT_FIXED', 'REGRESSION_INTRODUCED'] },
    reasoning: { type: 'string' },
    new_issues: { type: 'string' },
  },
  required: ['finding_id', 'verdict', 'reasoning', 'new_issues'],
};

const verifyResults = await parallel(
  implResults.filter((r) => r).map((r) => () => {
    const prompt = [
      'You verify one v12 HIGH fix. Read changed file(s).',
      'Project root: ' + PROJECT_ROOT,
      '',
      '=== IMPLEMENTER REPORT ===',
      'ID: ' + r.finding_id,
      'Files: ' + (r.files_modified || []).join(', '),
      'Summary: ' + r.summary,
      'tsc_clean: ' + r.tsc_clean,
      'Unresolved: ' + (r.unresolved || '(none)'),
      '',
      'Set verdict=FIXED only if the bug is closed AND no obvious regression. Quote the actually-changed code in your reasoning.',
    ].join('\\n');
    return agent(prompt, { label: 'v:' + r.finding_id, phase: 'Verify', schema: VERDICT, model: 'sonnet' });
  }),
);
const fixedCount = verifyResults.filter((v) => v && v.verdict === 'FIXED').length;
log('Verification: ' + fixedCount + '/' + verifyResults.length + ' confirmed FIXED.');

phase('Synthesise');

const SYNTH = {
  type: 'object',
  properties: {
    closed: { type: 'integer' },
    partial: { type: 'integer' },
    failed: { type: 'integer' },
    regressions_introduced: { type: 'integer' },
    schema_pushes_needed: { type: 'array', items: { type: 'string' } },
    smokes_to_run: { type: 'array', items: { type: 'string' } },
    items_needing_followup: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, files: { type: 'string' }, why: { type: 'string' } }, required: ['id', 'files', 'why'] } },
  },
  required: ['closed', 'partial', 'failed', 'regressions_introduced', 'schema_pushes_needed', 'smokes_to_run', 'items_needing_followup'],
};

const synth = await agent(
  'Synthesise 43 v12 HIGH impl + verify results. Name files needing schema push. Name smokes to run. Flag regressions.\\n\\nIMPL: ' + JSON.stringify(implResults) + '\\n\\nVERIFY: ' + JSON.stringify(verifyResults),
  { label: 'synth', phase: 'Synthesise', schema: SYNTH },
);

return { implResults, verifyResults, synth };
`;

const outPath = 'c:/Users/Ibrahim Elmur/Desktop/BGroup Super App/super-app/scripts/v12_high_workflow.js';
fs.writeFileSync(outPath, script);
console.log('Wrote', outPath, script.length, 'chars');
