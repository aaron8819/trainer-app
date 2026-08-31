---
name: receipt-integrity
description: Protect Trainer session-decision receipt meaning and consistency. Use when a change can alter `selectionMetadata.sessionDecisionReceipt` creation, parsing, normalization, persistence, reconciliation, schema, or a consumer whose result is derived from receipt fields. Do not trigger for generic generation, save, audit, dashboard, history, or read-side work that leaves receipt meaning and consumption unchanged.
---

# Receipt Integrity

Preserve the original generated decision receipt while keeping post-generation structure explicit.

## Trace the boundary

Before editing, identify:

- the receipt builder/parser in `trainer-app/src/lib/evidence/session-decision-receipt.ts`
- metadata stamping or sanitization in `trainer-app/src/lib/ui/selection-metadata.ts`
- the generation/finalization write path
- the save or mutation path
- every affected receipt-derived consumer
- the exact receipt fields or contracts that may change

Read the receipt-relevant canonical docs and nearby tests. Use `architecture-guard` when the change crosses ownership boundaries.

## Canonical truth

- `selectionMetadata.sessionDecisionReceipt` stores the original session decision and its evidence.
- `selectionMetadata.workoutStructureState` records the current workout structure after supported mutations. It is a reconciliation companion, not a replacement receipt.
- `selectionMetadata.runtimeEditReconciliation` may record supported edit facts without rewriting the original decision.
- Generation/finalization creates original receipt truth.
- Save and mutation paths preserve that receipt and update reconciliation state separately.
- Read-side consumers derive meaning from persisted receipt fields and shared semantic helpers.
- For an authorized capacity reduction, `sessionAuditSnapshot.generated` preserves the full generated plan, persisted workout rows preserve the offered reduced structure, set logs preserve performed truth, and `runtimeEditReconciliation.reduce_session_capacity` records the deliberate omission without rewriting the original receipt.

## Guardrails

Do not:

- add top-level or consumer-local mirrors of receipt meaning
- rewrite the receipt to resemble post-save structure
- recompute persisted receipt facts from current catalog or planner state
- place receipt policy in routes, pages, or components
- let explainability, review, history, dashboard, or audit consumers interpret the same receipt field differently
- treat current workout structure as proof of the original generated decision
- collapse full generated, offered reduced, performed, receipt, or reconciliation evidence into one structure
- let a receipt become executable plan composition

## Required change record

State:

- receipt owner and affected write path
- affected consumers
- fields or validation contracts touched
- original-receipt versus current-structure impact
- mirror or drift risks
- focused verification and any output-level audit gate

Generate the deterministic verification plan with `.\scripts\codex\Invoke-TrainerVerification.ps1 -BaseRef <authorized-base>` and interpret the resulting evidence against the receipt claim. Treat an unavailable required check as unresolved. Route an authorized output-level reconciliation question to `audit-workflow`; the need for an audit does not grant permission to run it.

## Exit criteria

Confirm what receipt truth remains canonical, which consumers were checked, whether receipt shape or meaning changed, and that no mirror was introduced.
