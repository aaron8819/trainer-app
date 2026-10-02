# Trainer2 swap migration checksum provenance

Investigated October 1, 2026 America/Chicago, with production access restricted to read-only transactions. Classification: **harmless evidenced mixed LF/CRLF byte variant**. No SQL statement differs from reviewed source. This establishes a bounded local validation correction, not permission to change the ledger or resume hosted release without its remaining gates.

## Recovered bytes and execution evidence

Migration: `20260930010000_trainer2_exercise_swap`.

| Evidence | SHA-256 / fact |
| --- | --- |
| Retained applied file, 25,551 bytes | `7eb597895c8c9655a353fbac25ac252288589b4c3a6da4fb79fcaec1f72219b9` |
| Canonical LF blob, 25,363 bytes | `07dd467143b8b2b09aba088f11a6e9505c7b55dcb4824b9b1634c247b2329af9` |
| Current all-CRLF checkout, 25,651 bytes | `f0b8309e6df873fab750ecf64e302091c8f0095f54ef8f177784be75717b9187` |
| Original source before/after manifest | `3e58847340b1b88f1ba1a4705b2ab7ad58c4d3ec60253277e3b53e1cc21347aa` |
| Original source report | `b6cfa7d655d9cd5f9e5522ea39d8d3f6160a454a5b5aa402d38de956cba3bb24` |
| Original release report | `1955bd170f2c9b35b5397c875087391b03dc4eca12542a42706f7ef1f5c5fa51` |
| Original release checksum manifest | `0813c13e02925dfe88437c0bec1aef48e6ce4b3fa45b83dcf1d598b63cbe99d9` |
| Original Prisma deploy log | `0979f45b354b88a5664f813d913710af4f841a078e95901aaf7eeda76ea5ce09` |
| Original after-migration ledger artifact | `8253f044cac91f9bbb890058fb1283dffca1af5f690ad9afd2f8aba1785d2b9c` |
| Original independent review | `41b5e1591273f413947067863fc7ec53924b85c1808d189bbc546ceb0ca9dea1` |
| Independent review source report | `ab7a506a671ee55ba860655acc668e78032a0fbde76da39caa42a740700e4380` |

Recovered file: `C:/Users/aabloch/claude/vibe-coding/.worktrees/trainer/trainer2-exercise-swap-final/trainer-app/prisma/migrations/20260930010000_trainer2_exercise_swap/migration.sql`. The same worktree's `artifacts/trainer2/swap-evidence/report.json` records its exact raw hash, LF-normalized hash and byte count in both source captures, bound to commit `c240e06cbf30037fb36bcfb2352ad42407017043`, tree `40dc68eb8d0434b3230e8d6a6f42c55015b6dd44`, empty dirty state. All 15 files in the original `swap-release/sha256.json` still match. Its release report and after-migration evidence record the recovered raw checksum. Prisma's retained log records successful application of this migration through `migrate deploy`, without an SQL execution transformation.

The original independent review is in the sibling `trainer2-exercise-swap-review` worktree. Its checksum-bound report captures that review checkout's all-CRLF source, so it has a different report hash from the candidate report. All 1,518 paths/LF-normalized source hashes match the candidate captures. The hash-bound review text separately records recalculation of the supplied raw hashes and exact original manifest hash. These reports are not conflated.

Git blobs at the reviewed swap commit, hosted catalog baseline `7affad657eb041c56ee6b3fe50aad1dde9bba5d0`, and approved Add set candidate `0b6ff4af02f931d4b4bfa7127e427c97eaab5a77` are byte-identical canonical LF SQL. The retained applied file is valid UTF-8 without a BOM, with 188 CRLF and 100 LF endings. Removing only CR in CRLF pairs produces exact canonical bytes. All 19 ordered SQL statements match after that transformation, including the transaction wrapper and dollar-quoted bodies. Whole-file byte equality is stronger corroboration than the diagnostic statement splitter.

Retained applied-file CRLF line ranges, inclusive: 72–78, 87–115, 121–122, 124–128, 137–152, 154–171, 173–187, 189–197, 199–212, 214–260, 263–288. All other line endings are LF. Regression coverage reconstructs this exact variant and verifies its raw hash. Git `core.autocrlf=true` explains the new checkout's all-CRLF representation; the original mixed-file authoring sequence was not reconstructed.

## Live read-only corroboration

Target was pinned to project `siqmohcbvnbdrssgofzu`, session pooler `aws-1-us-east-1.pooler.supabase.com:5432`, database `postgres`, PostgreSQL 17.6. Client certificate and hostname validation passed with authorized TLSv1.3. The backend reported `transaction_read_only=on`; no database mutation was issued.

The single live ledger entry has ID `02ab8111-b38a-4873-87fe-d9a4b5b05d55`, the recovered applied checksum, start `2026-09-30T15:14:08.615Z`, finish `2026-09-30T15:14:09.017Z`, `applied_steps_count=1`, null rollback and null logs. Available execution metadata does not contain original SQL text or a complete statement log.

All nine created/replaced function bodies exactly match recovered SQL after CRLF normalization and all are SECURITY INVOKER. Swap table constraints, trigger identities/enabled states, RLS, policies and six-role effective privilege results match the original release postchecks. Live full trigger/function definitions and catalog were captured. PUBLIC has zero table ACL entries. Schema evidence corroborates the recovered bytes; current schema equivalence alone was not used to establish historical execution provenance.

Machine-readable investigation evidence is retained under `trainer-app/artifacts/swap-checksum/` in the isolated investigation worktree: `applied-swap.sql`, `provenance.json`, `live.json`, `catalog.json`, `integrity-before.json`, `integrity-after.json`, and reproducible read-only inspection/comparison scripts. `provenance.json` records every evidence hash and all 19 statement hashes. No secret URLs/passwords, owner emails or real training records are included. These are retained operational artifacts, not committed application inputs.

## Bounded correction and resumption condition

`loadCheckedInMigrations` admits only the specific recovered hash above, for this exact migration name, when the current file's LF-normalized SHA-256 still equals the canonical reviewed hash above. It does not add arbitrary mixed-ending acceptance to Prisma's existing compatibility rules, alter SQL, weaken ledger/schema checks, or authorize ledger changes. Edited SQL, BOMs, different migration names, unrelated mixed-ending ledger hashes and incomplete entries remain rejected. Accepted compatibility stays visible in the existing `line_ending_compatible_checksum` warning.

On the same captured live catalog/ledger, checksum qualification changes from 35/36 to 36/36; no checksum mismatch remains. The owning integrity report passes and retains representation warnings, with exactly Add set pending. Required focused independent review must qualify the exact local correction commit/tree before integration. Preserve the reviewed Add set product/migration/grant source; integrate only this validator, its tests and provenance documentation. The release's ad hoc checksum-only probe must use the owning loader/matcher rather than duplicate the old three-hash rule. Re-read live ledger/target and run the owning read-only integrity check immediately before the release window. Any new mismatch still stops release.

No release was resumed during this investigation. Add-set-compatible recovery, V1 pause/restore, reviewed migration/grants, effective postchecks, exact protected deployment binding, synthetic smoke and preservation checks remain required by the separately authorized release procedure. This correction is not a real-training cutover and makes no repository-wide success claim.

Limit: retained bytes, pre/post manifests, independent source review, release records and matching Prisma ledger establish matching content. There is no signed execution transcript or complete PostgreSQL statement log; this report does not claim either exists.
