export const meta = {
  name: 'v12-high-verify-batch-1',
  description: 'Adversarial verification of 10 v12 HIGH implementations that were left unverified after the previous workflow hit the session limit.',
  phases: [
    { title: 'Verify', detail: '10 parallel independent verifiers' },
    { title: 'Synthesise', detail: 'Roll-up verdict' },
  ],
};

const ITEMS = [{"finding_id":"HIGH-30","files_modified":["c:\\Users\\Ibrahim Elmur\\Desktop\\BGroup Super App\\super-app\\src\\app\\api\\crm\\cold-leads\\distribute\\route.ts","c:\\Users\\Ibrahim Elmur\\Desktop\\BGroup Super App\\super-app\\src\\app\\api\\crm\\cold-leads\\redistribute\\route.ts"],"summary":"Fixed null crmProfileId crash in disposition writers. In distribute/route.ts (lines 98-112) replaced `crmProfileId!` with a spread conditional that omits the disposition op entirely when crmProfileId is null, preventing the non-null assertion from throwing inside the transaction and rolling back the whole round-robin distribute. In redistribute/route.ts (lines 87-105) wrapped the audit insert in an `if (session.user.crmProfileId)` guard plus a try/catch that logs but does not rethrow, so both a null crmProfileId and any other audit insert failure leave the primary crmColdLead.update intact. Bo"},{"finding_id":"HIGH-32","files_modified":["c:\\Users\\Ibrahim Elmur\\Desktop\\BGroup Super App\\super-app\\src\\components\\crm\\opportunities\\OpportunityComments.tsx"],"summary":"Fixed cuid leak in renderBody: when byId.get(id) returns undefined (server-filtered mention, cross-entity cuid, deleted user), the renderer now emits the placeholder string \"@?\" instead of the raw @&lt;cuid&gt; token. This mirrors the server's previewBody approach and prevents internal ids from being exposed to every viewer of the comment thread. Change is tagged with \"audit v12 HIGH\" comment at lines 92-97."},{"finding_id":"HIGH-33","files_modified":["c:\\Users\\Ibrahim Elmur\\Desktop\\BGroup Super App\\super-app\\src\\components\\crm\\opportunities\\OpportunityComments.tsx"],"summary":"Fixed the optimistic/poll race that produced two React rows with the same id. At line 383-384 (the POST-resolution setComments call), added a .filter step that removes any row whose id already equals data.comment.id — except the optimistic placeholder itself (which is about to be swapped). This prevents the scenario where a background poll inserts the canonical row while the POST is still in-flight, and the subsequent map then turns the still-present optimistic row into a second copy of the same canonical id."},{"finding_id":"HIGH-34","files_modified":["c:\\Users\\Ibrahim Elmur\\Desktop\\BGroup Super App\\super-app\\src\\app\\api\\crm\\dashboards\\route.ts"],"summary":"Added an ADMIN role gate in the POST handler before accepting visibility=EVERYONE. Any caller whose session.user.crmRole is not 'ADMIN' now receives a 403 when they attempt to create a dashboard with EVERYONE visibility, preventing a REP from broadcasting a dashboard to every CRM user's feed. A clarifying comment was also added noting that SPECIFIC sharedWithIds are already scoped to active CRM profiles via the existing resolveShareTargets call. The change is tagged with a comment referencing audit v12 HIGH #34."},{"finding_id":"HIGH-35","files_modified":["c:\\Users\\Ibrahim Elmur\\Desktop\\BGroup Super App\\super-app\\src\\app\\api\\saved-views\\route.ts"],"summary":"Replaced POST's cross-module `isAdmin` OR (lines 101-105) with the same per-scope `isModuleAdmin` block that PATCH uses. The old code allowed any module admin (e.g. partners-admin) to set `isShared=true` for scopes owned by a different module (e.g. crm-opportunities). The new code derives `isModuleAdmin` from only the module that owns the requested scope — crm requires `crmRole === \"ADMIN\"`, hr requires `hrRoles` includes `super_admin`, partners requires the user has no `partnerId`. A platform-level `super_admin` (hr role) still spans all modules. An explicit 403 is returned early if `isShared"}];
const PROJECT_ROOT = 'c:\\Users\\Ibrahim Elmur\\Desktop\\BGroup Super App\\super-app';

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
    ].join('\n');
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
  'Synthesise these 10 v12 HIGH verifier verdicts. List anything that needs a followup fix.\n\n' + JSON.stringify(verifyResults),
  { label: 'synth', phase: 'Synthesise', schema: SYNTH },
);

return { verifyResults, synth };
