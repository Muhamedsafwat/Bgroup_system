import fs from 'fs';

const items = JSON.parse(
  fs.readFileSync('c:/Users/Ibrahim Elmur/Desktop/BGroup Super App/super-app/AUDIT_v12_SKIPPED.json', 'utf8'),
);
const dataLiteral = JSON.stringify(items);

const script = `export const meta = {
  name: 'v12-skipped-recheck-and-fix',
  description: '38 v12 items previously marked SKIPPED_NO_BUG — independently re-verify each one (deeper inspection: check the actual cited code, every nearby branch, every adjacent file), then fix any that turn out to be real bugs. Same 3-stage pipeline with quoted-disk-lines as a hard contract.',
  phases: [
    { title: 'DeepVerify', detail: 'Independent re-verifier — deeper inspection than the first pass' },
    { title: 'Implement', detail: 'Apply the fix if a bug is found' },
    { title: 'VerifyPost', detail: 'Confirm fix landed on disk (quoted lines required)' },
    { title: 'Synthesise', detail: 'Final roll-up' },
  ],
};

const ITEMS = ${dataLiteral};
const PROJECT_ROOT = 'c:\\\\Users\\\\Ibrahim Elmur\\\\Desktop\\\\BGroup Super App\\\\super-app';

const DEEP = {
  type: 'object',
  properties: {
    finding_id: { type: 'string' },
    state: { type: 'string', enum: ['BUG_PRESENT', 'ALREADY_FIXED', 'NOT_A_BUG', 'UNCLEAR'] },
    bug_summary: { type: 'string' },
    fix_plan: { type: 'string' },
    quoted_lines: { type: 'string' },
  },
  required: ['finding_id', 'state', 'bug_summary', 'fix_plan', 'quoted_lines'],
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
    verdict: { type: 'string', enum: ['FIXED', 'PARTIAL', 'NOT_FIXED', 'REGRESSION_INTRODUCED', 'SKIPPED_NO_BUG'] },
    quoted_lines: { type: 'string' },
    reasoning: { type: 'string' },
  },
  required: ['finding_id', 'verdict', 'quoted_lines', 'reasoning'],
};

const pipelineResults = await pipeline(
  ITEMS,
  async (item) => {
    const prompt = [
      'You are a DEEP-INSPECTION verifier. A previous agent dismissed this v12 ' + item.severity + ' bug as "no bug exists in the current code", but the user wants every claim independently re-checked at deeper scrutiny.',
      'Project root: ' + PROJECT_ROOT,
      '',
      '=== ORIGINAL AUDIT FINDING ===',
      'ID: ' + item.finding_id + ' (' + item.severity + ')',
      'Domain: ' + (item.domain || '?'),
      'File hint: ' + (item.file || '?'),
      'Summary: ' + item.summary,
      '',
      'Open the cited file. Read at least 80 lines around the cited region. Then ALSO:',
      '- check adjacent files in the same handler (e.g. if it is an API route, check the action.ts AND the validation schema AND the page that calls it)',
      '- check for related call-sites by greping the function name',
      '- check the Prisma schema for relevant constraints',
      '',
      'You MUST quote 5-20 actual lines from the file in quoted_lines (with line numbers). Without that, your verdict is invalid.',
      '',
      'Then decide:',
      '- state=BUG_PRESENT if the bug as described is currently in the code, OR a closely-related variant of the bug is present',
      '- state=ALREADY_FIXED if you can prove (with quoted lines) that a fix is in place',
      '- state=NOT_A_BUG if the original audit misread the code AND you can prove that with quoted lines',
      '- state=UNCLEAR only if literally cannot be determined',
      '',
      'Bias: prefer BUG_PRESENT over NOT_A_BUG when uncertain. The user wants every real bug fixed.',
      '',
      'fix_plan: if BUG_PRESENT, give concrete instructions (file path, exact lines, what to change). Empty otherwise.',
    ].join('\\n');
    return agent(prompt, { label: 'deep:' + item.finding_id, phase: 'DeepVerify', schema: DEEP, model: 'sonnet' });
  },
  async (preResult, item) => {
    if (!preResult || preResult.state !== 'BUG_PRESENT') {
      return { finding_id: item.finding_id, applied: false, files_modified: [], diff_summary: 'no-op: ' + (preResult?.state || 'NULL'), notes: 'deep verifier said ' + (preResult?.state || 'NULL') };
    }
    const prompt = [
      'You are an implementer applying ONE v12 ' + item.severity + ' fix.',
      'CRITICAL: previous agents reported success without actually writing edits. You MUST use Edit/Write, THEN Read the file to confirm the change landed before reporting applied=true.',
      'Project root: ' + PROJECT_ROOT,
      '',
      '=== BUG (from deep verifier) ===',
      'Finding: ' + item.finding_id + ' (' + item.severity + ')',
      'Bug: ' + (preResult.bug_summary || ''),
      'Fix plan: ' + (preResult.fix_plan || ''),
      'Verifier-quoted lines (current state): ' + (preResult.quoted_lines || '').slice(0, 1500),
      '',
      'Constraints:',
      '- Do NOT refactor surrounding code or fix unrelated bugs.',
      '- Match existing code style.',
      '- Add a brief comment tagged "audit v12 ' + item.severity + ' (' + item.finding_id + ') recheck".',
      '- If the fix needs a Prisma schema change, return applied=false with notes (do not write a migration).',
      '- If the file does not exist or the path is wrong, return applied=false with notes.',
      '',
      'After editing, Read the file and put 3-15 actual changed lines in diff_summary.',
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
      'Read each claimed file, quote 5-15 ACTUAL lines you see (with line numbers), then verdict:',
      '- FIXED: bug closed cleanly with no obvious new bug',
      '- PARTIAL: some scenarios closed, others remain',
      '- NOT_FIXED: change is not on disk (ghost) or does not close bug',
      '- REGRESSION_INTRODUCED: change broke something else',
      'In quoted_lines: paste the actual disk lines. Verdicts without disk quotes will be rejected.',
    ].join('\\n');
    return agent(prompt, { label: 'post:' + item.finding_id, phase: 'VerifyPost', schema: POST, model: 'sonnet' });
  },
);

const valid = pipelineResults.filter(Boolean);
const tally = { FIXED: 0, SKIPPED_NO_BUG: 0, PARTIAL: 0, NOT_FIXED: 0, REGRESSION_INTRODUCED: 0 };
for (const v of valid) tally[v.verdict] = (tally[v.verdict] || 0) + 1;
log('Recheck done. ' + JSON.stringify(tally));

phase('Synthesise');
const SYNTH = {
  type: 'object',
  properties: {
    total: { type: 'integer' },
    fixed: { type: 'integer' },
    confirmed_no_bug: { type: 'integer' },
    partial: { type: 'integer' },
    not_fixed: { type: 'integer' },
    regressions: { type: 'integer' },
    fixed_ids: { type: 'array', items: { type: 'string' } },
    needs_manual: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, verdict: { type: 'string' }, why: { type: 'string' } }, required: ['id', 'verdict', 'why'] } },
  },
  required: ['total', 'fixed', 'confirmed_no_bug', 'partial', 'not_fixed', 'regressions', 'fixed_ids', 'needs_manual'],
};
const synth = await agent(
  'Synthesise the v12 SKIPPED-item recheck. Roll up verdicts. List FIXED ids and anything needing manual followup.\\n\\n' + JSON.stringify(valid),
  { label: 'synth', phase: 'Synthesise', schema: SYNTH },
);

return { pipelineResults: valid, synth };
`;

const outPath = 'c:/Users/Ibrahim Elmur/Desktop/BGroup Super App/super-app/scripts/v12_skipped_recheck.js';
fs.writeFileSync(outPath, script);
console.log('Wrote', outPath, script.length, 'chars');
