import fs from 'fs';

const items = JSON.parse(
  fs.readFileSync('c:/Users/Ibrahim Elmur/Desktop/BGroup Super App/super-app/AUDIT_v12_HIGH_VERIFY_BATCH.json', 'utf8'),
);
// Compact down to what the verifier needs
const compact = items.map((r) => ({
  finding_id: r.finding_id,
  files_modified: r.files_modified,
  summary: (r.summary || '').slice(0, 600),
}));
const dataLiteral = JSON.stringify(compact);

const script = `export const meta = {
  name: 'v12-high-verify-batch-1',
  description: 'Adversarial verification of 10 v12 HIGH implementations that were left unverified after the previous workflow hit the session limit.',
  phases: [
    { title: 'Verify', detail: '10 parallel independent verifiers' },
    { title: 'Synthesise', detail: 'Roll-up verdict' },
  ],
};

const ITEMS = ${dataLiteral};
const PROJECT_ROOT = 'c:\\\\Users\\\\Ibrahim Elmur\\\\Desktop\\\\BGroup Super App\\\\super-app';

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
  ITEMS.map((r) => () => {
    const prompt = [
      'You are an INDEPENDENT verifier of one v12 HIGH fix. Read the actually-modified file(s) and decide whether the bug as described is closed AND no new bug was introduced.',
      'Project root: ' + PROJECT_ROOT,
      '',
      '=== IMPLEMENTER REPORT ===',
      'ID: ' + r.finding_id,
      'Files modified: ' + (r.files_modified || []).join(', '),
      'Summary: ' + r.summary,
      '',
      'Quote the actually-changed lines in your reasoning. Set verdict=FIXED only if the bug is closed cleanly with no obvious new bug. PARTIAL if some scenarios remain. NOT_FIXED if the change misses the bug. REGRESSION_INTRODUCED if it breaks something else.',
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
    fixed: { type: 'integer' },
    partial: { type: 'integer' },
    not_fixed: { type: 'integer' },
    regressions: { type: 'integer' },
    needs_followup: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, verdict: { type: 'string' }, why: { type: 'string' } }, required: ['id', 'verdict', 'why'] } },
  },
  required: ['fixed', 'partial', 'not_fixed', 'regressions', 'needs_followup'],
};

const synth = await agent(
  'Synthesise these 10 v12 HIGH verifier verdicts. List anything that needs a followup fix.\\n\\n' + JSON.stringify(verifyResults),
  { label: 'synth', phase: 'Synthesise', schema: SYNTH },
);

return { verifyResults, synth };
`;

const outPath = 'c:/Users/Ibrahim Elmur/Desktop/BGroup Super App/super-app/scripts/v12_high_verify_batch.js';
fs.writeFileSync(outPath, script);
console.log('Wrote', outPath, script.length, 'chars');
