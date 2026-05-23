# BGroup Super App — Admin-Perspective Upgrade Plan + REP Interface Health

Run date: 2026-05-20
Inputs: 5 research agents (CRMs, pipelines, prospects, selling methodology, dashboards) + 3 REP-interface testing agents
AI scope: deferred per prior direction. UX polish: separate workstream.

---

## Part 1 — REP Interface Health (TL;DR: REPs can do their job)

**Status: ✅ green after one real fix and two false-positive verifications.**

### Real fix made this run

- **CallLogDrawer dropped field-level validation errors**. The calls endpoint was the only CRM write route returning `{ error, details: <flatten> }` (non-standard shape), and the client only read `err.error`. Now: server uses `describeZodError` like every other route ([calls/route.ts:120](src/app/api/crm/calls/route.ts#L120)), and the drawer surfaces each field's message in the toast ([CallLogDrawer.tsx:207](src/components/crm/calls/CallLogDrawer.tsx#L207)). Reps now see "duration: must be at least 1" instead of "Validation failed".

### False positives verified (worth recording)

The testing agents fired two HIGH-severity claims that I verified against actual code and dismissed:

1. **Agent 1 — "session-type mismatch on opp detail page"** ([page.tsx:15](src/app/(dashboard)/crm/opportunities/[id]/page.tsx#L15))
   Claim: page calls `auth()` instead of `getRequiredSession()`, breaking `canStartWorkflow`.
   Reality: line 21 correctly reads `session?.user?.crmRole`. The session shape from `auth()` includes `crmRole`. No bug.

2. **Agent 2 — "TOCTOU race on opportunity update"** ([actions.ts:330](src/app/(dashboard)/crm/opportunities/actions.ts#L330))
   Claim: REP A edits opp X, manager transfers to REP B mid-edit, REP A submits and silently writes to REP B's opp.
   Reality: the scope helper IS the at-write check. After transfer, `findFirst({ id, ownerId: REP_A_id })` returns null, and `if (!existing) throw "Opportunity not found"` fires. Write rejected. The race exists in theory only — the very check the agent thought was insufficient is the one that catches it.

### Per-surface verdicts (REP role)

| Surface | Status |
|---|---|
| `/crm/my` | ✓ tight, friendly empty state |
| `/crm/opportunities` (list, detail, new, edit) | ✓ scoped by `ownerId`, manager buttons hidden |
| `/crm/pipeline` (kanban + list, drag-drop stage) | ✓ scoped, soft-delete filter added previously |
| `/crm/cold-leads` + folder drill-down | ✓ scoped by `assignedToId`; folder grid hidden from REP |
| `/crm/calls` (log + list) | ✓ scoped — calls endpoint `session.id` bug fixed last session |
| `/crm/meetings` | ⚠ Org-wide read by deliberate design (double-booking prevention) — flagged in TEST_REPORT_v6 but not a REP-isolation bug |
| `/crm/contacts` (directory + opp-attached) | ✓ scoped on both sources |
| `/crm/reports` (daily activity + Excel export) | ✓ forced to own `repId` regardless of any `?repId=` param |
| Transfer flows (opp, cold lead, contact, company) | ✓ visibility flips A→B immediately (smoke: 27/27 in `smoke-rep-isolation.mjs`) |

### Forms — every REP-facing mutation behaves correctly

Create opp, edit opp, move stage, log call, book meeting, update disposition, edit cold lead, convert cold lead, submit daily report, add contact, update next action — all REP-allowed, all surface field-level errors, all `revalidatePath` their list views, all safe against mid-flight ownership change (scope helper rejects the write).

**Bottom line: nothing blocks a REP from doing their job today.** The MEDIUM "no field-level errors on call log" was the only real issue and it's fixed.

---

## Part 2 — Admin-Perspective Upgrade Plan

Synthesized from the 5 research streams. Items are grouped by **tier** (impact × admin-time savings), then ordered within each tier by ROI. AI/predictive features and integrations (email, calendar, e-sign) are deferred. Pure UX polish is its own workstream.

### Tier 0 — Quick wins (each ≤ 1 week, fixes the biggest "running CRM by hand" pain)

| # | Feature | Why admins benefit |
|---|---|---|
| 1 | **Stage required-fields gating** | Block drag-drop into a stage unless configured fields (amount, next step, decision-maker contact) are populated. Stops the "deals magically advance with nothing in them" hygiene problem at the source. Implementation: `requiredFieldsJson` column on `CrmStageConfig`, enforced in `changeStage` action. |
| 2 | **Stage type + forecast category mapping** | Each `CrmStageConfig` gets `stageType` (`open` / `won` / `lost` / `abandoned`) and `forecastCategory` (`pipeline` / `bestCase` / `commit` / `closed` / `omitted`). Replaces hardcoded `stage === "WON"` checks; powers a proper forecast roll-up. |
| 3 | **Days-in-stage + stalled-deal flags** | Already have `CrmStageHistory`. Add `targetDays` + `maxDays` to `CrmStageConfig`, surface a "stalled X days" badge on opp cards in the kanban, and a "stuck deals" widget on the group dashboard. |
| 4 | **Loss-reason analytics report** | Loss reasons table already exists. Build a report: loss rate × reason × stage × rep × source. Tells admins *where* deals die, which is the lever they actually control. |
| 5 | **Bulk-edit on list views** | Multi-select reassign, change stage, change priority, soft-delete from the opportunities/cold-leads/contacts lists. Replaces 50 individual clicks during reorgs. |
| 6 | **Saved smart views (URL-shareable)** | Admin-curated filters ("My team's HOT > 50k stuck >7d") that anyone can pin. Schema: `CrmSavedView { id, name, scope, filtersJson, isShared }`. Eliminates daily re-filter churn for managers. |
| 7 | **Bulk territory reassignment wizard** | When a rep leaves: pick their opps/leads/companies, pick destination rep(s), preview impact, confirm. Single transaction, audit entry per row. Today this is dozens of individual updates. |
| 8 | **Audit log surface** | Activity helpers (`HrAuditLog`, etc.) exist but no admin UI to filter "who changed what when" across stages, owners, amounts, settings tables. Required for any compliance conversation. |
| 9 | **Coverage-ratio widget on group dashboard** | `open_pipeline / remaining_quota` per rep/team/segment, color-coded against admin-set thresholds (3x SMB / 4x mid-market). Single number that tells you if the quarter is at risk. |
| 10 | **Anti-gaming flags on leaderboard** | "Suspicious patterns" tab: end-of-month activity spike, stage bounce-back, abnormally low ACV with high close count, calls <30s. Manager-visible only. |

### Tier 1 — Strategic depth (each 1-4 weeks; pick from this once Tier 0 lands)

| # | Feature | Why admins benefit |
|---|---|---|
| 11 | **MEDDPICC field block on opportunities** | 8 structured fields (Metrics, Economic Buyer, Decision Criteria, Decision Process, Paper Process, Identify Pain, Champion, Competition) + 0-10 score per field rolling up to a deal-health score. Admin configures which fields are required per stage. Normalize as `CrmOpportunityMeddpicc` (1:1 with opp) so historical snapshots audit score decay. |
| 12 | **Stakeholder role taxonomy on opp contacts** | Multi-contact roster already exists. Add `roleType` (Champion / Economic Buyer / Decision Maker / Influencer / Blocker / End User / Coach) + influence 1-5 + sentiment (For/Neutral/Against). Admin configures which roles are required by stage. |
| 13 | **Per-stage rotting threshold + alerts** | `CrmDealStallAlert` table; nightly job flags deals where time-since-last-activity > admin-set per-stage threshold. Notifies owner + escalates to manager. |
| 14 | **SLA policies on cold leads** | `CrmLeadSlaPolicy { status, targetMinutes, reminderPct, breachAction }`. Speed-to-lead targets (first touch within 5 min for NEW), reminder at 50% elapsed, breach action = notify / reassign / unassign. |
| 15 | **Rep working-capacity caps** | `maxOpenLeads` per rep, round-robin skips reps over cap, manager override flag. Industry best-practice cap is ~20-25 open records. |
| 16 | **Recycle/cooldown policy engine** | Replace single `recycleEligibleAt` with `CrmLeadRecyclePolicy { status, cooldownDays, maxAttempts, recycleTarget }`. Auto-archive after N attempts; recycled leads return to original rep or general pool per admin choice. |
| 17 | **Weighted round-robin with skill tags** | Rep weights (ramping=0.5, senior=2), skill tags (language / segment / vertical), auto-pause when over cap. Replaces flat rotation. |
| 18 | **Quota periodization + ramping** | Extend `monthlyTargetEGP` to support quarterly/annual + ramping curves (new hire 50/75/100% over months 1-3) + splits (new business vs expansion). Pace-to-quota widget = `actual / days_elapsed × days_in_period` vs. target. |
| 19 | **Deal inspection view** | Single-opp deep-dive panel for managers: full timeline of stage moves + activity + product changes, "stuck since" badge, stakeholder list, manager-only notes field. Where forecast disputes get resolved without leaving the CRM. |
| 20 | **Configurable validation rules + duplicate detection** | Admin-defined required/format rules + fuzzy dedupe (email exact = 100, phone normalized = 80, name+company fuzzy = 60) gated at import + manual create. Today the Excel upload happily ingests dirty data. |
| 21 | **Win-rate cube** | Same number sliced by stage / segment / rep / product / lead source / deal-size band. One pivot with dimension selectors. Currently only have leaderboard attainment. |
| 22 | **Activity-to-outcome correlations** | "Reps making >40 calls/week close 2.3× more." Scatter / regression over the existing daily-reports data. No new collection — just a new view. |
| 23 | **Mutual action plans (close plans)** | Templated checklist of milestones (technical validation, security review, legal redline, signature) with owner (us/them) + due dates. Public read-only link for buyer. `CrmClosePlan` + `CrmClosePlanItem` tables. |
| 24 | **Stage-scoped playbooks** | Admin attaches rich-text "what to do / questions to ask / battle cards" per stage; rep sees it inline on the opp sidebar. `CrmStagePlaybook` keyed by stage id. |
| 25 | **Activity quota per stage** | Minimum count of calls/meetings/emails required IN a stage before advance is allowed. Pulls from existing daily reports. |
| 26 | **Loss debrief workflow (beyond reason picklist)** | Closing as Lost triggers a structured form: primary + secondary reason, competitor (from list), stage-at-loss, free-text retro, manager sign-off. Status flows `pending_manager_review → closed`. |
| 27 | **Competitor tracking** | `CrmCompetitor` master + many-to-many `CrmOpportunityCompetitor` (with `wasPrimary` flag). Powers loss-by-competitor reports. |
| 28 | **Forecast category override + manager judgement overlay** | Each manager submits a `commit` / `bestCase` number per period that overrides the math. Admin sees variance: system roll-up vs manager commit vs actuals. `CrmForecastSubmission { userId, period, commit, bestCase, submittedAt }`. |
| 29 | **Field-level permissions matrix** | Per role, mark Opportunity fields as `editable` / `readonly` / `hidden`. Prevents reps from rewriting amount/close date/owner. |
| 30 | **Admin "login-as" / impersonation** | Reproduce a rep's view to debug visibility while every action is audited as "Admin acting as RepX". |

### Tier 2 — Foundational platform work (multi-week each; spread across the year)

| # | Feature | Why admins benefit |
|---|---|---|
| 31 | **Multiple named pipelines** | Separate pipelines for New Business / Renewal / Expansion, each with its own stages + probabilities + required fields + rotting rules. New `CrmPipeline` table; FK on `CrmStageConfig` + `CrmOpportunity`; default pipeline for back-compat. **The single biggest 2026 gap.** |
| 32 | **Auto-create renewal opp on closed-won** | Per-pipeline rule that spawns a follow-on opp in the Renewal pipeline N days before contract end. `CrmPipelineAutomation { trigger, offsetDays, targetPipelineId }`. |
| 33 | **Lead-to-account matching** | Connect a cold lead to existing company/opp before assignment so reps see prior history (LeanData/Demandbase pattern). Match on email domain / normalized company / website. Excludes free-email domains. |
| 34 | **Configurable lead status state machine** | `CrmLeadStatusTransition { fromStatus, toStatus, requiresReason, allowedRoles[] }`. Replaces the hardcoded enum transitions. |
| 35 | **Quote + e-sign artifact on opp** | Generate quote PDF from products-on-opp, route through approval if discount > admin-configured threshold, send for e-sign, write-back signed status. Phase 1: PDF + manual approval. Phase 2: integration. |
| 36 | **Workflow / automation builder (event → condition → action)** | No-code rules: "when stage=Won, create renewal task in 11mo"; "when lead unassigned >2h, reassign". Triggers, filters, actions, suppression. **The highest-leverage admin feature in HubSpot/Salesforce.** |
| 37 | **Custom fields per object** | Admin UI to add typed fields (text/number/picklist/date/lookup) to opportunity/contact/lead without code. Survives new business lines without engineering. |
| 38 | **Custom dashboard builder + scheduled digests** | Drag widgets from a library onto a grid; save layouts; share with roles/teams. Plus scheduled "email this dashboard as PDF every Monday 8am to sales-leads@". |
| 39 | **Configurable alert rules engine** | UI to build rules: trigger (stage-slip, no-activity-N-days, amount > X, probability dropped, close-date pushed) + filter + channel (in-app/email/Slack). Suppression to prevent fatigue. |
| 40 | **Slippage tracking** | Log every `expectedCloseDate` change in `CrmCloseDateHistory`. Admin sets "slip alert" threshold (>2 slips OR >30d cumulative). |
| 41 | **Cohort conversion matrix** | Rows = deal-creation month, columns = months-since-creation, cells = cumulative win %. "Of Q1-created deals, what % closed by Q3?" |
| 42 | **Sequence/cadence hooks on disposition** | Disposition write triggers downstream actions: `NO_ANSWER` + attempt=3 → add to nurture cadence; `NOT_INTERESTED` → exit all cadences. `CrmLeadAutomation` rule table. |
| 43 | **Import quality gates + reject queue** | Validation profiles (required fields, regex, blocked domains, duplicate behavior) attached to each upload. Rejected rows go to `CrmColdLeadImportReject` for re-review. |
| 44 | **Conversion field mapping + audit** | Admin maps lead fields → opportunity/account fields including custom fields; conversion endpoint reads the map; writes full snapshot to `CrmColdLeadConversionAudit`. |

---

## Recommended sequencing

**Month 1 — Tier 0 (10 items, ~5 weeks parallel):**
Stage required-fields, stage type + forecast category, stalled-deal flags, loss-reason analytics, bulk-edit, saved smart views, territory reassignment wizard, audit log UI, coverage-ratio widget, anti-gaming leaderboard. Total: 4-5 weeks with one or two engineers.

**Month 2-3 — Tier 1 high-ROI subset:**
MEDDPICC fields (#11) + stakeholder roles (#12) + per-stage rotting alerts (#13) + SLA policies (#14) + quota periodization (#18) + deal inspection view (#19) + win-rate cube (#21). These together transform the system from "tracks deals" to "enforces methodology and surfaces risk."

**Month 4-6 — Tier 2 foundation:**
Multiple pipelines (#31) is the gatekeeper for everything else (renewal auto-create, separate stage configs). Workflow builder (#36) and custom fields (#37) are the big two unlock-the-future items.

**Month 7+ — Remaining Tier 1 + 2 in priority order, AI features come back into scope here.**

---

## Sources cited by research agents

The research outputs cited industry references for each recommendation. Key clusters:
- Stage gating + forecast categories: Salesforce, HubSpot, Pipedrive, Salesforce Spring '26 forecasting guide
- MEDDPICC enforcement + close plans: Outreach Success Plans, Clari Inspect, Accord, ARPEDIO, MEDDICC.com
- Lead routing + SLA: LeanData, Salesloft, Chili Piper, Kubaru
- Dashboards + forecasting: Clari, Outreach Commit, Salesforce Ben forecast guide, HubSpot reporting
- Lead deduplication + matching: Apollo, ZoomInfo, RingLead, Marketo
- Workflow + automation: HubSpot workflows, Salesforce flow, Attio workflows

(Full URL list lives in each research agent's transcript; can be regenerated on request.)

---

## What did NOT make the list

- Email integration / inbox sync — deferred (separate Q2 work)
- Calendar two-way sync — deferred (Q2)
- AI: lead scoring, forecast, deal coaching, conversation intelligence — deferred per direction
- Native mobile app — separate workstream
- SAML SSO, SOC 2, observability — Q4 enterprise-readiness work
- Pure UX polish (skeleton loaders, microcopy, animation) — separate sweep
