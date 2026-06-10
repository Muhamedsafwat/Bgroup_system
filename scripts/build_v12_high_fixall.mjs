import fs from 'fs';

const items = JSON.parse(
  fs.readFileSync('c:/Users/Ibrahim Elmur/Desktop/BGroup Super App/super-app/AUDIT_v12_REMAINING_HIGH.json', 'utf8'),
);
const dataLiteral = JSON.stringify(items);

const script = `export const meta = {
  name: 'v12-high-fix-remaining',
  description: 'Pipeline: per-finding (verify current state -> if NOT_FIXED implement edit -> verify edit landed on disk). Closes the remaining v12 HIGH audit items.',
  phases: [
    { title: 'VerifyPre', detail: 'Read file, decide if bug exists' },
    { title: 'Implement', detail: 'Apply fix if bug exists' },
    { title: 'VerifyPost', detail: 'Confirm edit landed on disk' },
    { title: 'Synthesise', detail: 'Roll-up final verdicts' },
  ],
};

const ITEMS = ${dataLiteral};
const PROJECT_ROOT = 'c:\\\\Users\\\\Ibrahim Elmur\\\\Desktop\\\\BGroup Super App\\\\super-app';

const PRE = {
  type: 'object',
  properties: {
    finding_id: { type: 'string' },
    state: { type: 'string', enum: ['BUG_PRESENT', 'ALREADY_FIXED', 'UNCLEAR'] },
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
    verdict: { type: 'string', enum: ['FIXED', 'PARTIAL', 'NOT_FIXED', 'REGRESSION_INTRODUCED', 'SKIPPED_NO_BUG'] },
    quoted_lines: { type: 'string' },
    reasoning: { type: 'string' },
  },
  required: ['finding_id', 'verdict', 'quoted_lines', 'reasoning'],
};

const pipelineResults = await pipeline(
  ITEMS,
  // Stage 1: VerifyPre
  async (item) => {
    const prompt = [
      'You are an independent verifier checking the CURRENT state of a v12 HIGH bug.',
      'Project root: ' + PROJECT_ROOT,
      'A previous workflow CLAIMED to apply a fix; many of those claims were ghosts (file never modified). Your job: read the file fresh, decide if the bug is currently present.',
      '',
      '=== PREVIOUS IMPLEMENTER CLAIM ===',
      'Finding ID: ' + item.finding_id,
      'Files supposedly modified: ' + (item.files_modified || []).join(', '),
      'Summary: ' + item.summary,
      '',
      'Open the files, read the relevant code, then return:',
      '- state=ALREADY_FIXED if the bug as described is closed,',
      '- state=BUG_PRESENT if the bug is still there (most likely outcome — many were ghost fixes),',
      '- state=UNCLEAR only if you genuinely cannot tell.',
      'bug_summary: 1-2 sentences describing the bug.',
      'fix_plan: concrete instructions for the implementer (file paths, line numbers, what to change).',
    ].join('\\n');
    return agent(prompt, {
      label: 'pre:' + item.finding_id,
      phase: 'VerifyPre',
      schema: PRE,
      model: 'sonnet',
    });
  },
  // Stage 2: Implement (only if BUG_PRESENT)
  async (preResult, item) => {
    if (!preResult || preResult.state === 'ALREADY_FIXED') {
      return { finding_id: item.finding_id, applied: false, files_modified: [], diff_summary: 'skipped: bug not present', notes: 'pre-verifier said ALREADY_FIXED' };
    }
    const prompt = [
      'You are an implementer applying ONE v12 HIGH fix.',
      'CRITICAL: previous agents reported success without actually writing edits. You MUST use the Edit/Write tool to modify the file, THEN use Read to confirm the change is on disk before reporting applied=true.',
      'Project root: ' + PROJECT_ROOT,
      '',
      '=== BUG (from pre-verifier) ===',
      'Finding: ' + item.finding_id,
      'Bug: ' + (preResult.bug_summary || ''),
      'Fix plan: ' + (preResult.fix_plan || ''),
      '',
      'Constraints:',
      '- Do NOT introduce new bugs or refactor surrounding code.',
      '- Match existing code style.',
      '- Add a brief comment explaining the fix, tagged "audit v12 HIGH (' + item.finding_id + ')".',
      '- If the fix needs a Prisma migration, return applied=false with notes explaining.',
      '',
      'After editing, Read the file once to confirm the new lines are present. Return the diff_summary with the actual changed lines you can see in the file.',
    ].join('\\n');
    return agent(prompt, {
      label: 'imp:' + item.finding_id,
      phase: 'Implement',
      schema: IMPL,
      model: 'sonnet',
    });
  },
  // Stage 3: VerifyPost (always runs — confirms the edit actually landed)
  async (implResult, item) => {
    if (!implResult) {
      return { finding_id: item.finding_id, verdict: 'NOT_FIXED', quoted_lines: '', reasoning: 'implementer returned null' };
    }
    if (!implResult.applied) {
      return { finding_id: item.finding_id, verdict: 'SKIPPED_NO_BUG', quoted_lines: '', reasoning: implResult.notes || 'skipped' };
    }
    const prompt = [
      'You are an INDEPENDENT post-verifier. The implementer just reported applying a fix. Your job: read the file fresh and confirm the change is actually on disk.',
      'Project root: ' + PROJECT_ROOT,
      '',
      'Finding: ' + item.finding_id,
      'Implementer claimed files: ' + (implResult.files_modified || []).join(', '),
      'Implementer diff summary: ' + (implResult.diff_summary || ''),
      '',
      'Read each claimed file, quote 3-10 relevant lines you actually see (with line numbers), then decide:',
      '- FIXED: the bug is closed cleanly with no obvious new bug',
      '- PARTIAL: some scenarios closed, others remain',
      '- NOT_FIXED: the implementer\\'s change is NOT on disk (ghost fix) or doesn\\'t actually close the bug',
      '- REGRESSION_INTRODUCED: the change broke something else',
      'In quoted_lines: include the actual file lines you read. Without this, your verdict cannot be trusted.',
    ].join('\\n');
    return agent(prompt, {
      label: 'post:' + item.finding_id,
      phase: 'VerifyPost',
      schema: POST,
      model: 'sonnet',
    });
  },
);

const valid = pipelineResults.filter(Boolean);
const fixedCount = valid.filter((v) => v.verdict === 'FIXED').length;
const skippedCount = valid.filter((v) => v.verdict === 'SKIPPED_NO_BUG').length;
const notFixedCount = valid.filter((v) => v.verdict === 'NOT_FIXED').length;
log('Pipeline done: ' + fixedCount + ' FIXED, ' + skippedCount + ' already-fixed, ' + notFixedCount + ' still-broken.');

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
    needs_manual: {
      type: 'array',
      items: { type: 'object', properties: { id: { type: 'string' }, verdict: { type: 'string' }, why: { type: 'string' } }, required: ['id', 'verdict', 'why'] },
    },
  },
  required: ['total', 'fixed', 'skipped_no_bug', 'partial', 'not_fixed', 'regressions', 'needs_manual'],
};
const synth = await agent(
  'Synthesise the v12 HIGH fix pipeline. Roll up verdicts. List anything that needs manual followup with concrete next steps.\\n\\n' + JSON.stringify(valid),
  { label: 'synth', phase: 'Synthesise', schema: SYNTH },
);

return { pipelineResults: valid, synth };
`;

const outPath = 'c:/Users/Ibrahim Elmur/Desktop/BGroup Super App/super-app/scripts/v12_high_fixall.js';
fs.writeFileSync(outPath, script);
console.log('Wrote', outPath, script.length, 'chars');
