export const meta = {
  name: 'v12-ultra-recheck',
  description: 'THIRD-pass adversarial recheck of 17 items two earlier verifiers cleared. User directive: do not stop until every single finding is closed or proven clean with quoted disk evidence. This pass is maximally skeptical — implementer is told to apply a hardening fix if the originally described bug is truly absent.',
  phases: [
    { title: 'UltraVerify', detail: 'Adversarial: prove the bug is closed OR find related weakness' },
    { title: 'Implement', detail: 'Apply fix for any real or hardenable concern' },
    { title: 'VerifyPost', detail: 'Confirm disk lines' },
    { title: 'Synthesise', detail: 'Final tally' },
  ],
};

const ITEMS = [{"finding_id":"HIGH-43","files_modified":["src/app/api/cron/alert-rules/route.ts"],"summary":"Suppression row written unconditionally even when no notification was created (channels=['slack'], targetUserId null) — silent forever-skip.","severity":"HIGH","file":"src/app/api/cron/alert-rules/route.ts:138-168","domain":"alert-rules"},{"finding_id":"HIGH-45","files_modified":["c:\\Users\\Ibrahim Elmur\\Desktop\\BGroup Super App\\super-app\\src\\app\\(dashboard)\\crm\\calls\\actions.ts"],"summary":"GET /api/crm/calls?repId= overrides REP role-scope; rep can read any rep's calls.","severity":"HIGH","file":"src/app/(dashboard)/crm/calls/actions.ts:131-163","domain":"calls"},{"finding_id":"HIGH-55","files_modified":["c:\\Users\\Ibrahim Elmur\\Desktop\\BGroup Super App\\super-app\\src\\app\\api\\hr\\employees\\route.ts"],"summary":"Employee create silently hijacks an existing User account when work_email matches — forces hrAccess=true and binds the new HrEmployee.userId.","severity":"HIGH","file":"src/app/api/hr/employees/route.ts:197-216","domain":"hr-employees"},{"finding_id":"HIGH-58","files_modified":["c:\\Users\\Ibrahim Elmur\\Desktop\\BGroup Super App\\super-app\\src\\app\\api\\hr\\attendance\\leave-requests\\[id]\\route.ts"],"summary":"PATCH lets HR rewrite dates of an already-APPROVED leave — no status guard, no attendance-log re-fan.","severity":"HIGH","file":"src/app/api/hr/attendance/leave-requests/[id]/route.ts:66-103","domain":"hr-leave"},{"finding_id":"HIGH-59","files_modified":["c:\\Users\\Ibrahim Elmur\\Desktop\\BGroup Super App\\super-app\\src\\app\\api\\hr\\attendance\\leave-requests\\[id]\\deny\\route.ts"],"summary":"Deny route was not given the updateMany race-gate that approve has — concurrent denies double-fire notifications.","severity":"HIGH","file":"src/app/api/hr/attendance/leave-requests/[id]/deny/route.ts:26-41","domain":"hr-leave"},{"finding_id":"HIGH-60","files_modified":["c:\\Users\\Ibrahim Elmur\\Desktop\\BGroup Super App\\super-app\\src\\app\\api\\hr\\attendance\\leave-requests\\[id]\\approve\\route.ts","c:\\Users\\Ibrahim Elmur\\Desktop\\BGroup Super App\\super-app\\src\\app\\api\\hr\\attendance\\leave-requests\\[id]\\deny\\route.ts"],"summary":"Leave approve has no cross-company gate — HR manager in Company A can approve leave for Company B (same hole on deny).","severity":"HIGH","file":"src/app/api/hr/attendance/leave-requests/[id]/approve/route.ts:10-24","domain":"hr-leave"},{"finding_id":"MED-13","severity":"MEDIUM","domain":"comments-mentions","file":"src/app/api/crm/users/mentionable/route.ts:42-52","summary":"Mention picker entity scope uses CALLER's entity, but the POST handler validates against the OPP's entity — picker can suggest users the server will silently drop","files_modified":[]},{"finding_id":"MED-14","severity":"MEDIUM","domain":"comments-mentions","file":"src/app/api/crm/users/mentionable/route.ts:43-52","summary":"When the caller has no crmEntityId (null), the picker returns only users with null entityId plus mgrs/admins — non-mgr/admin users with no entity see an empty roster","files_modified":[]},{"finding_id":"MED-20","severity":"MEDIUM","domain":"dashboards-sharing","file":"src/app/api/crm/dashboards/route.ts:187-196 vs 253-280","summary":"POST silently degrades SPECIFIC-with-no-targets to OWNER while PATCH returns 422 — inconsistent error contract for the same logical input.","files_modified":[]},{"finding_id":"MED-22","severity":"MEDIUM","domain":"dashboards-sharing","file":"src/app/api/crm/dashboards/route.ts:225-328","summary":"PATCH silently ignores sharedWithIds when visibility moves to EVERYONE/OWNER — no warning that the list was discarded.","files_modified":[]},{"finding_id":"MED-24","severity":"MEDIUM","domain":"dashboards-sharing","file":"src/app/(dashboard)/crm/admin/dashboards/client.tsx:107,476","summary":"Self-exclusion in SpecificPeoplePicker depends on useSession() being ready — initial render of the picker briefly shows the owner in their own roster until the session hook resolves.","files_modified":[]},{"finding_id":"MED-25","severity":"MEDIUM","domain":"dashboards-sharing","file":"src/app/(dashboard)/crm/admin/dashboards/client.tsx:140-164","summary":"Roster fetch failure toast surfaces — but the picker still gets stuck rendering 'Loading users…' indefinitely; there's no retry button or visible empty-state for the failure path.","files_modified":[]},{"finding_id":"MED-44","severity":"MEDIUM","domain":"overtime","file":"src/app/api/hr/overtime/requests/[id]/approve/route.ts:11-70","summary":"Single-row OT approve has no cross-company gate even though the v11-fixed bulk-approve does — team_lead can approve OT for a foreign employee.","files_modified":[]},{"finding_id":"MED-51","severity":"MEDIUM","domain":"admin-auth","file":"src/app/api/admin/users/[id]/reset-password/route.ts:86-101","summary":"Non-HR-linked admin reset-password creates a stub HrUserProfile with isActive=false outside the transaction — leaves orphan stubs if the transaction fails","files_modified":[]},{"finding_id":"MED-62","severity":"MEDIUM","domain":"cold-leads","file":"src/app/api/crm/cold-leads/export/route.ts:50-89","summary":"Cold-leads export GET filter params (industry, category, location, q, assignedToId, status) are unbounded — opposite of the bounded list GET in route.ts:53-57","files_modified":[]},{"finding_id":"LOW-9","severity":"LOW","domain":"dashboard","file":"src/app/(dashboard)/hr/dashboard/page.tsx:367-405","summary":"Dashboard error banner uses a tautological count formula and Arabic locale never sees the real count.","files_modified":[]},{"finding_id":"LOW-16","severity":"LOW","domain":"ux","file":"src/app/(dashboard)/hr/dashboard/page.tsx:373-378","summary":"Dashboard failed-widgets banner message hardcodes a denominator of 6 but only 5 queries exist for non-super-admin (payrollSummaryQuery is disabled).","files_modified":[]}];
const PROJECT_ROOT = 'c:\\Users\\Ibrahim Elmur\\Desktop\\BGroup Super App\\super-app';

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
      'You are the THIRD adversarial verifier for this v12 ' + item.severity + ' item. Two prior agents cleared it. The user explicitly directed: "fix every single thing you skipped, don\'t stop unless everything is complete."',
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
    ].join('\n');
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
    ].join('\n');
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
    ].join('\n');
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
  'Synthesise the v12 ultra-recheck. Roll up verdicts. List FIXED ids and remaining gaps with concrete followups.\n\n' + JSON.stringify(valid),
  { label: 'synth', phase: 'Synthesise', schema: SYNTH },
);

return { pipelineResults: valid, synth };
