import fs from 'fs';

const items = JSON.parse(
  fs.readFileSync('c:/Users/Ibrahim Elmur/Desktop/BGroup Super App/super-app/AUDIT_v12_STILL_SKIPPED.json', 'utf8'),
);
// Get original audit summary for HIGH items
const audit = JSON.parse(
  fs.readFileSync('C:/Users/IBRAHI~1/AppData/Local/Temp/claude/c--Users-Ibrahim-Elmur-Desktop-BGroup-Super-App/84050577-7e5c-420c-b0c0-f22822e9b50c/tasks/wmnvzp8ki.output', 'utf8'),
);
const fixList = audit.result.synth.fix_list;
const enriched = items.map(item => {
  if (item.severity === 'HIGH') {
    const n = parseInt(item.finding_id.replace('HIGH-', ''), 10);
    const entry = fixList[n - 1];
    if (entry) return { ...item, summary: entry.summary || item.summary, file: entry.file || item.file, domain: entry.domain };
  }
  return item;
});
const dataLiteral = JSON.stringify(enriched);

const script = `export const meta = {
  name: 'v12-ultra-recheck',
  description: 'THIRD-pass adversarial recheck of 17 items two earlier verifiers cleared. User directive: do not stop until every single finding is closed or proven clean with quoted disk evidence. This pass is maximally skeptical — implementer is told to apply a hardening fix if the originally described bug is truly absent.',
  phases: [
    { title: 'UltraVerify', detail: 'Adversarial: prove the bug is closed OR find related weakness' },
    { title: 'Implement', detail: 'Apply fix for any real or hardenable concern' },
    { title: 'VerifyPost', detail: 'Confirm disk lines' },
    { title: 'Synthesise', detail: 'Final tally' },
  ],
};

const ITEMS = ${dataLiteral};
const PROJECT_ROOT = 'c:\\\\Users\\\\Ibrahim Elmur\\\\Desktop\\\\BGroup Super App\\\\super-app';

const ULTRA = {
  type: 'object',
  properties: {
    finding_id: { type: 'string' },
    decision: { type: 'string', enum: ['REAL_BUG_PRESENT', 'HARDENABLE_GAP_NEARBY', 'GENUINELY_CLEAN'] },
    summary: { type: 'string' },
    fix_plan: { type: 'string' },
    quoted_lines: { type: 'string' },
  },
  required: ['finding_id', 'decision', 'summary', 'fix_plan', 'quoted_lines'],
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
    verdict: { type: 'string', enum: ['FIXED', 'PARTIAL', 'NOT_FIXED', 'REGRESSION_INTRODUCED', 'CONFIRMED_CLEAN'] },
    quoted_lines: { type: 'string' },
    reasoning: { type: 'string' },
  },
  required: ['finding_id', 'verdict', 'quoted_lines', 'reasoning'],
};

const pipelineResults = await pipeline(
  ITEMS,
  async (item) => {
    const prompt = [
      'You are the THIRD adversarial verifier for this v12 ' + item.severity + ' item. Two prior agents cleared it. The user explicitly directed: "fix every single thing you skipped, don\\'t stop unless everything is complete."',
      'Project root: ' + PROJECT_ROOT,
      '',
      '=== ORIGINAL AUDIT FINDING ===',
      'ID: ' + item.finding_id + ' (' + item.severity + ')',
      'File: ' + (item.file || '?'),
      'Summary: ' + item.summary,
      '',
      'Read the file at the cited path. Read at least 100 lines around the cited region. ALSO inspect:',
      '- Every adjacent file in the same handler chain (route -> action -> validation -> page)',
      '- The Prisma schema for relevant models',
      '- The RBAC scope helpers being used (e.g. scopeOpportunityByRole, canAccessCompany)',
      '- Test files exercising this path',
      '',
      'Quote 10-30 lines of disk evidence in quoted_lines (with line numbers). NO quoting = invalid.',
      '',
      'Then decide:',
      '- decision=REAL_BUG_PRESENT if the bug as described IS present (prior verifiers missed it)',
      '- decision=HARDENABLE_GAP_NEARBY if the exact bug is not there but a closely related defensive improvement is warranted (rate limit, bound, null guard, role check, transaction wrap, audit row, etc.). Be honest — do not invent a gap.',
      '- decision=GENUINELY_CLEAN if you can prove with quoted lines that nothing needs touching',
      '',
      'fix_plan: if REAL_BUG_PRESENT or HARDENABLE_GAP_NEARBY, give file path + line numbers + exact change. Empty otherwise.',
      '',
      'Be honest. Inventing a fake bug to satisfy the user is worse than reporting GENUINELY_CLEAN.',
    ].join('\\n');
    return agent(prompt, { label: 'ultra:' + item.finding_id, phase: 'UltraVerify', schema: ULTRA, model: 'sonnet' });
  },
  async (preResult, item) => {
    if (!preResult || preResult.decision === 'GENUINELY_CLEAN') {
      return { finding_id: item.finding_id, applied: false, files_modified: [], diff_summary: 'no-op: ' + (preResult?.decision || 'NULL'), notes: 'ultra verifier decision=' + (preResult?.decision || 'NULL') };
    }
    const prompt = [
      'You are applying ONE v12 ' + item.severity + ' fix or hardening.',
      'CRITICAL: previous agents reported success without writing edits. Use Edit/Write, then Read to confirm.',
      'Project root: ' + PROJECT_ROOT,
      '',
      '=== TASK ===',
      'Finding: ' + item.finding_id + ' (' + item.severity + ')',
      'Decision: ' + preResult.decision,
      'Summary: ' + (preResult.summary || ''),
      'Fix plan: ' + (preResult.fix_plan || ''),
      'Current code: ' + (preResult.quoted_lines || '').slice(0, 1500),
      '',
      'Constraints:',
      '- Apply ONLY the change in fix_plan. No refactor.',
      '- Match existing code style.',
      '- Add a brief comment tagged "audit v12 ' + item.severity + ' (' + item.finding_id + ') ultra".',
      '- If a Prisma migration is needed, return applied=false with notes.',
      '- If the file does not exist, return applied=false with notes.',
      '',
      'After editing, Read the file and put 3-15 actual changed lines in diff_summary.',
    ].join('\\n');
    return agent(prompt, { label: 'imp:' + item.finding_id, phase: 'Implement', schema: IMPL, model: 'sonnet' });
  },
  async (implResult, item) => {
    if (!implResult) return { finding_id: item.finding_id, verdict: 'NOT_FIXED', quoted_lines: '', reasoning: 'implementer null' };
    if (!implResult.applied) {
      return { finding_id: item.finding_id, verdict: 'CONFIRMED_CLEAN', quoted_lines: '', reasoning: implResult.notes || 'no-op' };
    }
    const prompt = [
      'INDEPENDENT post-verifier. Implementer just claimed a fix. Read the file fresh.',
      'Project root: ' + PROJECT_ROOT,
      '',
      'Finding: ' + item.finding_id + ' (' + item.severity + ')',
      'Files: ' + (implResult.files_modified || []).join(', '),
      'Diff: ' + (implResult.diff_summary || ''),
      '',
      'Quote 5-15 actual disk lines (with line numbers). Verdict:',
      '- FIXED: change closes the bug/hardens the gap',
      '- PARTIAL: incomplete',
      '- NOT_FIXED: ghost, not on disk',
      '- REGRESSION_INTRODUCED: broke something',
      'No disk quotes = invalid.',
    ].join('\\n');
    return agent(prompt, { label: 'post:' + item.finding_id, phase: 'VerifyPost', schema: POST, model: 'sonnet' });
  },
);

const valid = pipelineResults.filter(Boolean);
const tally = {};
for (const v of valid) tally[v.verdict] = (tally[v.verdict] || 0) + 1;
log('Ultra recheck done. ' + JSON.stringify(tally));

phase('Synthesise');
const SYNTH = {
  type: 'object',
  properties: {
    total: { type: 'integer' },
    fixed: { type: 'integer' },
    confirmed_clean: { type: 'integer' },
    partial: { type: 'integer' },
    not_fixed: { type: 'integer' },
    regressions: { type: 'integer' },
    fixed_ids: { type: 'array', items: { type: 'string' } },
    needs_manual: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, verdict: { type: 'string' }, why: { type: 'string' } }, required: ['id', 'verdict', 'why'] } },
  },
  required: ['total', 'fixed', 'confirmed_clean', 'partial', 'not_fixed', 'regressions', 'fixed_ids', 'needs_manual'],
};
const synth = await agent(
  'Synthesise the v12 ultra-recheck. Roll up verdicts. List FIXED ids and remaining gaps with concrete followups.\\n\\n' + JSON.stringify(valid),
  { label: 'synth', phase: 'Synthesise', schema: SYNTH },
);

return { pipelineResults: valid, synth };
`;

const outPath = 'c:/Users/Ibrahim Elmur/Desktop/BGroup Super App/super-app/scripts/v12_ultra_recheck.js';
fs.writeFileSync(outPath, script);
console.log('Wrote', outPath, script.length, 'chars');
