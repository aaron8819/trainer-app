# Local activation contract and pre-test matrix

Base: 5865cb9dec901d55a9c0afdad1ea397dd1b7347e / tree 489d23475a3a5a1c8da85a2b4cf50a1461610619.

Authority: PRODUCT_BLUEPRINT_FINAL §§7–9,24; DOMAIN_ARCHITECTURE §§6,7,12,17; IMPLEMENTATION_PLAN §§6.2,7.1; progression correction re-review next-slice specification.

Planning's account-serialized acceptance transaction is the canonical activation owner. Pure review and instruction applicability live in engine/trainer2; immutable revisions, lifecycle constraints and decisions live in Prisma/SQL. Thin HTTP adapters and Workbench consume these owners. No V1, hosted admission, execution, logging, replacement, pause/end or automated progression changes.

ActivatePlan uses the existing immutable action envelope, target planId, expected planRevisionId and a complete reviewed binding: account, plan, immutable revision, full intent/content and progression hashes, supported review/activation policy, current instruction epoch/document hash and applicability result. The trusted server principal is resolved/revalidated through the existing boundary, including after acquiring the account lock; request account is only a consistency assertion. Ownership epoch must match. Local synthetic admission stays the only supported admission.

Prerequisites: live Draft, exact current revision, supported saved intent/policies, saved readiness passes, current exclusions resolved, and no other Active/Paused plan. New equal-valued revisions are stale. Existing execution is outside this slice and is not queried as an activation prerequisite.

Persist atomically: Draft -> Active, initialApprovedRevisionId equals unchanged currentRevisionId, immutable ActivatePlan decision referencing the revision and reviewed instruction provenance, accepted sequence and durable action/outcome. No new plan revision or execution capture. Approved intent, endpoint, prescriptions, order and identities remain in the existing immutable revision. All Draft edits reject non-Draft lifecycle; SQL backstops freeze activated state for this slice.

Instructions: independently owned immutable account instruction revisions support named AddRestriction, ClearRestriction and AddScopedException commands under the same lock and expected instruction epoch. The bounded exclusion selector is an exact catalog exercise; authored descriptions produce explicit uncertainty rather than certified compliance. Scope is account or one plan, with explicit validity dates. Exceptions name one current restriction revision, exact plan/positions and validity, and preserve an explicit reason. No diagnosis, inferred restrictions, copied authority or general instruction editor. Review exposes these records and blocked positions; editing or a named narrow exception resolves conflicts.

Retries: exact action/envelope replay returns historical outcome after authorization, before current-state checks. Different payload under the same action is a collision. A fresh activation of Active returns ALREADY_ACTIVATED. Stale review and current-plan conflict are durable conflicts. Malformed envelopes reject at HTTP parsing without writes. Infrastructure failure rolls back action/effects/counters; retry retains the original envelope. UI always reloads authoritative state after accepted/replayed outcomes.

Implementation order: contracts/schema; common transaction extension and pure instruction policy; read/HTTP; review action and active display; focused tests and real PostgreSQL/browser matrix; canonical docs and handoff.

| State/path | Required assertion | Result |
| --- | --- | --- |
| Template and independent mixed plan save/review/activate/reload | Exact immutable document, IDs, sequence and decision preserved | Pending |
| Missing/malformed/mismatched binding; unknown intent/policy | No activation effects | Pending |
| Readiness issues; wrong account/cross-plan references | Rejected, isolated | Pending |
| New changed or equal-valued revision | Stale review | Pending |
| Existing Active/Paused plan | Actionable conflict; no replacement | Pending |
| Same action twice, changed payload, lost response | One effect, historical replay/collision | Pending |
| Distinct actions same plan; competing plans | One accepted activation | Pending |
| Save vs activation, both serial orders | Stale activation or rejected editor; no active mutation | Pending |
| Restriction/exception vs activation | Current epoch/applicability checked in serial order | Pending |
| Transaction failure | No partial decision/state/outcome | Pending |
| Unsaved edits, delayed response after switch | Input retained; wrong screen unchanged | Pending |
| Uncertain outcome; stale review recovery; reload | Exact retry then authoritative state | Pending |
| Fresh migration and accepted-base upgrade | Constraints/grants/data preserved | Pending |
| Desktop/mobile browser/API/database | Screenshots inspected; exact schedule | Pending |

Hosting remains paused; Phase 0 incomplete. This is implementation evidence, not independent acceptance.
