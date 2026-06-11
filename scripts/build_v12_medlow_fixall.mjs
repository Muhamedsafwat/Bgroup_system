import fs from 'fs';

const medium = JSON.parse(fs.readFileSync('c:/Users/Ibrahim Elmur/Desktop/BGroup Super App/super-app/AUDIT_v12_MEDIUM.json', 'utf8'));
const low = JSON.parse(fs.readFileSync('c:/Users/Ibrahim Elmur/Desktop/BGroup Super App/super-app/AUDIT_v12_LOW.json', 'utf8'));
const items = [...medium, ...low];
const dataLiteral = JSON.stringify(items);

const script = `export const meta = {
  name: 'v12-medlow-fix-all',
  description: 'Pipeline: verify -> implement-if-bug -> verify-post for 75 MEDIUM + 17 LOW v12 audit findings. Same proven pattern as v12 HIGH closure.',
  phases: [
    { title: 'VerifyPre', detail: '92 parallel pre-verifiers' },
    { title: 'Implement', detail: 'Implementers for items where bug confirmed' },
    { title: 'VerifyPost', detail: 'Independent post-verifiers (require quoted disk lines)' },
    { title: 'Synthesise', detail: 'Final roll-up' },
  ],
};

const ITEMS = ${dataLiteral};
const PROJECT_ROOT = 'c:\\\\Users\\\\Ibrahim Elmur\\\\Desktop\\\\BGroup Super App\\\\super-app';

const PRE = {
  type: 'object',
  properties: {
    finding_id: { type: 'string' },
    state: { type: 'string', enum: ['BUG_PRESENT', 'ALREADY_FIXED', 'UNCLEAR', 'NOT_A_BUG'] },
    bug_summary: { type: 'string' },
    fix_plan: { type: 'string' },
  },
  required: ['finding_id', 'state', 'bug_summary', 'fix_plan'],
};

const IMPL = {
  type: 'object',
  properties: {
    finding_id: { type: 'string' },
    applied: { type: 'boolean' },
    files_modified: { type: 'array', items: { type: 'string' } },
    diff_summary: { type: 'string' },
    notes: { type: 'string' },
  },
  required: ['finding_id', 'applied', 'files_modified', 'diff_summary', 'notes'],
};

const POST = {
  type: 'object',
  properties: {
    finding_id: { type: 'string' },
    verdict: { type: 'string', enum: ['FIXED', 'PARTIAL', 'NOT_FIXED', 'REGRESSION_INTRODUCED', 'SKIPPED_NO_BUG', 'NOT_A_BUG'] },
    quoted_lines: { type: 'string' },
    reasoning: { type: 'string' },
  },
  required: ['finding_id', 'verdict', 'quoted_lines', 'reasoning'],
};

const pipelineResults = await pipeline(
  ITEMS,
  async (item) => {
    const prompt = [
      'You are an independent pre-verifier for ONE v12 ' + item.severity + ' bug claim.',
      'Project root: ' + PROJECT_ROOT,
      '',
      '=== ORIGINAL AUDIT FINDING ===',
      'ID: ' + item.finding_id + ' (' + item.severity + ')',
      'Domain: ' + (item.domain || '?'),
      'File: ' + (item.file || '?'),
      'Summary: ' + item.summary,
      '',
      'Open the file at the cited path, read the relevant region, then decide:',
      '- state=BUG_PRESENT if the bug as described is currently in the code',
      '- state=ALREADY_FIXED if subsequent v11/v12 fixes already closed it',
      '- state=NOT_A_BUG if the finding misread the code and there is no bug',
      '- state=UNCLEAR only if you genuinely cannot tell',
      'bug_summary: 1-2 sentence description.',
      'fix_plan: concrete instructions (file path, line numbers, what to change). If state != BUG_PRESENT, leave fix_plan empty.',
    ].join('\\n');
    return agent(prompt, { label: 'pre:' + item.finding_id, phase: 'VerifyPre', schema: PRE, model: 'sonnet' });
  },
  async (preResult, item) => {
    if (!preResult || preResult.state !== 'BUG_PRESENT') {
      return { finding_id: item.finding_id, applied: false, files_modified: [], diff_summary: 'skipped', notes: 'pre-verifier state=' + (preResult?.state || 'NULL') };
    }
    const prompt = [
      'You are an implementer applying ONE v12 ' + item.severity + ' fix.',
      'CRITICAL: previous agents reported success without actually writing edits. You MUST use Edit/Write, THEN Read the file to confirm the change landed before reporting applied=true.',
      'Project root: ' + PROJECT_ROOT,
      '',
      '=== BUG ===',
      'Finding: ' + item.finding_id + ' (' + item.severity + ')',
      'Bug: ' + (preResult.bug_summary || ''),
      'Fix plan: ' + (preResult.fix_plan || ''),
      '',
      'Constraints:',
      '- Do NOT refactor surrounding code or fix unrelated bugs.',
      '- Match existing code style.',
      '- Add a brief comment tagged "audit v12 ' + item.severity + ' (' + item.finding_id + ')".',
      '- If the fix needs a Prisma schema change, return applied=false with notes explaining (do not write a migration).',
      '- If file no longer exists or path is wrong, return applied=false with notes.',
      '',
      'After editing, Read the file and put 3-10 actual changed lines in diff_summary.',
    ].join('\\n');
    return agent(prompt, { label: 'imp:' + item.finding_id, phase: 'Implement', schema: IMPL, model: 'sonnet' });
  },
  async (implResult, item) => {
    if (!implResult) return { finding_id: item.finding_id, verdict: 'NOT_FIXED', quoted_lines: '', reasoning: 'implementer null' };
    if (!implResult.applied) {
      return { finding_id: item.finding_id, verdict: 'SKIPPED_NO_BUG', quoted_lines: '', reasoning: implResult.notes || 'skipped' };
    }
    const prompt = [
      'You are an INDEPENDENT post-verifier. The implementer just claimed to apply a fix. Read the file fresh and confirm the change is on disk.',
      'Project root: ' + PROJECT_ROOT,
      '',
      'Finding: ' + item.finding_id + ' (' + item.severity + ')',
      'Claimed files: ' + (implResult.files_modified || []).join(', '),
      'Implementer diff: ' + (implResult.diff_summary || ''),
      '',
      'Read each claimed file, quote 3-10 ACTUAL lines you see (with line numbers), then verdict:',
      '- FIXED: bug closed cleanly with no obvious new bug',
      '- PARTIAL: some scenarios closed, others remain',
      '- NOT_FIXED: change is not on disk (ghost) or does not close bug',
      '- REGRESSION_INTRODUCED: change broke something else',
      'In quoted_lines: paste the actual lines you read. Verdicts without quoted disk lines will be rejected.',
    ].join('\\n');
    return agent(prompt, { label: 'post:' + item.finding_id, phase: 'VerifyPost', schema: POST, model: 'sonnet' });
  },
);

const valid = pipelineResults.filter(Boolean);
const tally = { FIXED: 0, SKIPPED_NO_BUG: 0, PARTIAL: 0, NOT_FIXED: 0, REGRESSION_INTRODUCED: 0, NOT_A_BUG: 0 };
for (const v of valid) tally[v.verdict] = (tally[v.verdict] || 0) + 1;
log('Pipeline done. ' + JSON.stringify(tally));

phase('Synthesise');
const SYNTH = {
  type: 'object',
  properties: {
    total: { type: 'integer' },
    fixed: { type: 'integer' },
    skipped_no_bug: { type: 'integer' },
    partial: { type: 'integer' },
    not_fixed: { type: 'integer' },
    regressions: { type: 'integer' },
    not_a_bug: { type: 'integer' },
    needs_manual: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, verdict: { type: 'string' }, why: { type: 'string' } }, required: ['id', 'verdict', 'why'] } },
  },
  required: ['total', 'fixed', 'skipped_no_bug', 'partial', 'not_fixed', 'regressions', 'not_a_bug', 'needs_manual'],
};
const synth = await agent(
  'Synthesise the v12 MEDIUM+LOW fix pipeline. Roll up verdicts. List anything that needs manual followup with concrete next steps.\\n\\n' + JSON.stringify(valid),
  { label: 'synth', phase: 'Synthesise', schema: SYNTH },
);

return { pipelineResults: valid, synth };
`;

const outPath = 'c:/Users/Ibrahim Elmur/Desktop/BGroup Super App/super-app/scripts/v12_medlow_fixall.js';
fs.writeFileSync(outPath, script);
console.log('Wrote', outPath, script.length, 'chars');
