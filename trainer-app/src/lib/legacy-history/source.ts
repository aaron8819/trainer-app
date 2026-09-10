import { canonicalJson, integrityHash } from "../api/trainer2/integrity";
import { legacyLinks } from "./relations";
import { sourceFixtureSchema, sourceAssertionSchema, sourceCaptureSchema, type RawSource, type SourceAssertion, type SourceCapture, type SourceReference, type SourceIdentity } from "../trainer2-contracts/legacy-source";

export const sourceHash = (value: unknown) => integrityHash(`trainer2-legacy-source-v1\n${canonicalJson(value)}`);
export const recordKey = (row: Pick<RawSource, "family" | "record">) => canonicalJson([row.family, row.record]);
export const identityKey = (identity: SourceIdentity) => canonicalJson(identity);
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export const sourceLimitations = [
  "Synthetic reference dry-run only; no imports, acceptance, reconciliation, or production verification.",
  "Repository schema and synthetic rows do not establish deployed schema, counts, grants, writer eras, devices, backups, or completeness.",
  "Direct PostgreSQL column text preserves surviving stored values (including SQL NULL versus JSON null), not original user entry spelling, pre-rounding float values, JSONB whitespace, or overwritten/deleted history.",
  "Complete means owner-reachable rows in declared families only. Ownerless orphan rows cannot be attributed or exported. Unavailable references may be absent, foreign, or outside scope; no foreign lookup is performed.",
  "Device storage, backup histories, provider data, muscle/scoring metadata, finisher routine definitions/decisions/library, and mesocycle exercise roles are not database capture families in v1.",
  "Connected source component (including catalog links) is the conservative revision dependency basis; related changes may revise multiple references. No content-based record deduplication.",
  "All references remain quantitatively unqualified. External assertions are preserved claims, not independently verified historical truth.",
];

function classify(row: RawSource, identity: SourceIdentity, dependencyHash: string, assertions: SourceAssertion[], relationshipIssues: string[]): SourceReference {
  const f = row.fields;
  const issues = [...relationshipIssues];
  const claim = <K extends keyof SourceAssertion["claims"]>(field: K) => {
    const values = assertions.flatMap(a => a.claims[field] === undefined ? [] : [String(a.claims[field])]);
    const distinct = [...new Set(values)];
    return { value: distinct.length === 1 ? distinct[0] : null, conflict: distinct.length > 1,
      basis: assertions.filter(a => a.claims[field] !== undefined).map(a => `${a.artifactId}:${sourceHash(a)}`).sort(compare) };
  };
  const performance = claim("confirmedPerformance");
  let kind: SourceReference["interpretation"]["kind"] = "source-context";
  if (["WorkoutSet", "WorkoutTemplate", "WorkoutTemplateExercise", "HypertrophyPlanDraft", "MesocycleSeedRevision"].includes(row.family)) kind = "prescription-reference";
  if (row.family === "Workout") kind = "session-reference";
  if (row.family === "DeviceDraft") kind = "unconfirmed-draft";
  if (row.family.startsWith("Finisher")) kind = "unsupported-timed-reference";
  if (row.family === "SetLog") {
    kind = f.wasSkipped === "true" ? "skipped-log" : performance.value === "true" && f.wasSkipped === "false" ? "source-asserted-performance" : "recorded-log-unconfirmed";
    if (f.wasSkipped === "true" && performance.value) issues.push("CONFLICTING_SKIPPED_PERFORMANCE");
    if (kind === "recorded-log-unconfirmed") issues.push("PERFORMANCE_ORIGIN_UNCONFIRMED");
    issues.push("LATEST_VALUES_WITHOUT_CORRECTION_CHAIN", "RPE_ORIGIN_NOT_RIR");
    if (f.actualLoad === "0") issues.push("ZERO_REQUIRES_PROVENANCE");
  }
  if (kind === "prescription-reference" || row.family.endsWith("Snapshot") || row.family === "Workout") issues.push("PRESCRIPTION_NOT_VERIFIED_START");
  if (kind === "unconfirmed-draft") issues.push("DRAFT_OR_PREFILL_NOT_PERFORMANCE");
  if (kind === "unsupported-timed-reference") issues.push("TIMED_FINISHER_REFERENCE_ONLY");
  const finalityClaim = claim("finality");
  let finality: SourceReference["interpretation"]["finality"] = "not-applicable";
  if (row.family === "Workout") {
    finality = f.status === "COMPLETED" ? "source-completed" : f.status === "SKIPPED" ? "source-skipped" : "unresolved";
    if (finalityClaim.conflict) { finality = "unresolved"; issues.push("CONFLICTING_FINALITY"); }
    else if (finalityClaim.value && f.status !== "SKIPPED") finality = finalityClaim.value === "finished" ? "source-asserted-finished" : "source-asserted-finished-partial";
    else if (finalityClaim.value) issues.push("CONFLICTING_FINALITY");
    if (finality === "unresolved") issues.push("SESSION_FINALITY_UNRESOLVED");
  }
  const measurement = {} as SourceReference["interpretation"]["measurement"];
  for (const dimension of ["unit", "convention", "repBasis", "equipment", "zeroMeaning"] as const) {
    const c = claim(dimension);
    const storedField = { unit: "", convention: "loadConvention", repBasis: "repBasis", equipment: "", zeroMeaning: "zeroLoadMeaning" }[dimension];
    const stored = row.family === "WorkoutExercise" && storedField ? f[storedField] : null;
    const conflict = c.conflict || !!(c.value && stored && c.value !== stored);
    measurement[dimension] = { value: conflict ? null : c.value ?? stored ?? null,
      confidence: conflict ? "conflicting" : c.value ? "external-source-assertion" : stored ? "stored-reference" : "unknown",
      basis: [...c.basis, ...(stored ? [`${recordKey(row)}.${storedField}`] : [])] };
    if (["WorkoutExercise", "SetLog"].includes(row.family) && (conflict || !measurement[dimension].value)) issues.push(`${dimension.toUpperCase()}_${conflict ? "CONFLICTING" : "UNKNOWN"}`);
  }
  const date = claim("performedDate"), instant = claim("performedInstant");
  const timeConflict = date.conflict || instant.conflict;
  if (timeConflict) issues.push("PERFORMED_TIME_CONFLICTING");
  if (["Workout", "SetLog", "DeviceDraft"].includes(row.family) && !date.value && !instant.value) issues.push("PERFORMED_TIME_UNKNOWN");
  const payloadHash = sourceHash(row);
  return { schemaVersion: 1, identity, payloadHash, dependencyHash,
    revision: sourceHash({ identity, payloadHash, dependencyHash }), raw: row, assertions,
    interpretation: { kind, finality, measurement,
      time: { performedDate: timeConflict ? null : date.value, performedInstant: timeConflict ? null : instant.value, confidence: timeConflict ? "conflicting" : date.value || instant.value ? "external-source-assertion" : "unknown" },
      actualEffort: "raw-RPE-only-no-RIR-conversion", startingPrescription: "not-verified-start",
      corrections: "surviving-values-only-no-demonstrated-correction-chain", quantitativelyQualified: false },
    discrepancies: [...new Set(issues)].sort(compare) };
}

export function captureSource(input: unknown, observation: SourceCapture["observation"], assertionInput: unknown[] = []): SourceCapture {
  const fixture = sourceFixtureSchema.parse(input);
  fixture.scope.families.sort(compare);
  const rows = [...fixture.rows].sort((a, b) => compare(recordKey(a), recordKey(b)));
  const byKey = new Map(rows.map(r => [recordKey(r), r]));
  if (byKey.size !== rows.length) throw new Error("DUPLICATE_SOURCE_IDENTITY");
  for (const row of rows) {
    if (!fixture.scope.families.includes(row.family)) throw new Error("ROW_OUTSIDE_DECLARED_SCOPE");
    for (const field of ["userId", "ownerId"]) if (row.fields[field] != null && row.fields[field] !== fixture.scope.account) throw new Error("CROSS_ACCOUNT_SOURCE_ROW");
  }
  const identity = (row: RawSource): SourceIdentity => ({ system: fixture.scope.system, account: fixture.scope.account, family: row.family, record: row.record });
  const assertions = assertionInput.map(a => sourceAssertionSchema.parse(a)).sort((a, b) => compare(canonicalJson(a), canonicalJson(b)));
  for (const a of assertions) {
    const row = byKey.get(recordKey(a.identity));
    if (!row || identityKey(identity(row)) !== identityKey(a.identity) || sourceHash(row) !== a.payloadHash) throw new Error("ASSERTION_SOURCE_BASIS_MISMATCH");
  }
  const graph = new Map(rows.map(r => [recordKey(r), new Set<string>()]));
  const issues = new Map(rows.map(r => [recordKey(r), [] as string[]]));
  for (const row of rows) for (const [field, family] of Object.entries(legacyLinks[row.family] ?? {})) {
    const target = row.fields[field];
    if (target == null) continue;
    const key = recordKey({ family, record: target });
    if (!byKey.has(key)) issues.get(recordKey(row))!.push(`UNAVAILABLE_RELATION:${field}:${family}`);
    else { graph.get(recordKey(row))!.add(key); graph.get(key)!.add(recordKey(row)); }
  }
  for (const row of rows) {
    const seedId = row.fields[row.family === "Mesocycle" ? "currentSeedRevisionId" : "seedRevisionId"];
    const seed = seedId ? byKey.get(recordKey({ family: "MesocycleSeedRevision", record: seedId })) : undefined;
    const mesocycleId = row.family === "Mesocycle" ? row.record : row.fields.mesocycleId ?? row.fields.activeMesocycleId;
    if (seed && mesocycleId && seed.fields.mesocycleId !== mesocycleId) issues.get(recordKey(row))!.push("CONFLICTING_SEED_LINEAGE");
    if (seed && ((row.fields.seedRevisionNumber != null && row.fields.seedRevisionNumber !== seed.fields.revision) || (row.fields.seedPayloadHash != null && row.fields.seedPayloadHash !== seed.fields.payloadHash)))
      issues.get(recordKey(row))!.push("CONFLICTING_SEED_REVISION_REFERENCE");
  }
  // Duplicate positions are ambiguity, not identity continuity or deduplication.
  for (const family of ["WorkoutExercise", "WorkoutSet"] as const) {
    const buckets = new Map<string, RawSource[]>();
    for (const row of rows.filter(r => r.family === family)) {
      const key = canonicalJson([row.fields[family === "WorkoutSet" ? "workoutExerciseId" : "workoutId"] ?? null, row.fields[family === "WorkoutSet" ? "setIndex" : "orderIndex"] ?? null]);
      buckets.set(key, [...(buckets.get(key) ?? []), row]);
    }
    for (const bucket of buckets.values()) if (bucket.length > 1) for (const row of bucket) issues.get(recordKey(row))!.push("AMBIGUOUS_POSITION_LINEAGE");
  }
  const dependencies = new Map<string, string>();
  for (const row of rows) {
    const start = recordKey(row);
    if (dependencies.has(start)) continue;
    const connected = new Set<string>(), pending = [start];
    while (pending.length) { const key = pending.pop()!; if (connected.has(key)) continue; connected.add(key); pending.push(...graph.get(key)!); }
    const basis = [...connected].sort(compare).map(key => ({ identity: identity(byKey.get(key)!), payloadHash: sourceHash(byKey.get(key)),
      assertions: assertions.filter(a => recordKey(a.identity) === key) }));
    const hash = sourceHash({ scope: fixture.scope, basis });
    for (const key of connected) dependencies.set(key, hash);
  }
  const references = rows.map(row => classify(row, identity(row), dependencies.get(recordKey(row))!, assertions.filter(a => recordKey(a.identity) === recordKey(row)), issues.get(recordKey(row))!));
  return sourceCaptureSchema.parse({ schemaVersion: 1, scope: { ...fixture.scope, families: [...fixture.scope.families].sort(compare) }, observation,
    sourceHash: sourceHash({ scope: fixture.scope, records: references.map(r => ({ identity: r.identity, revision: r.revision })) }), references, limitations: sourceLimitations });
}

export function verifySourceCapture(input: unknown): SourceCapture {
  const capture = sourceCaptureSchema.parse(input);
  const expected = captureSource({ schemaVersion: 1, synthetic: true, scope: capture.scope, rows: capture.references.map(r => r.raw) }, capture.observation, capture.references.flatMap(r => r.assertions));
  if (canonicalJson(expected) !== canonicalJson(capture)) throw new Error("SOURCE_CAPTURE_INTEGRITY_MISMATCH");
  return capture;
}

export function discrepancyReport(input: SourceCapture) {
  const capture = verifySourceCapture(input);
  const records = capture.references;
  const byFamily = capture.scope.families.map(family => {
    const rows = records.filter(r => r.identity.family === family);
    return { family, records: rows.length, recordsWithDiscrepancies: rows.filter(r => r.discrepancies.length > 0).length, discrepancies: rows.reduce((n, r) => n + r.discrepancies.length, 0) };
  });
  return { schemaVersion: 1, kind: "source-reference-dry-run", scope: capture.scope, sourceHash: capture.sourceHash,
    countingUnits: { records: "distinct system/account/family/record identities", sessions: "Workout records", sets: "SetLog records, including skipped/unconfirmed; never targets", discrepancies: "distinct record/code pairs; multiple per record allowed" },
    totals: { records: records.length, sessions: records.filter(r => r.identity.family === "Workout").length,
      sets: records.filter(r => r.identity.family === "SetLog").length, recordsWithDiscrepancies: records.filter(r => r.discrepancies.length).length,
      discrepancies: byFamily.reduce((n, f) => n + f.discrepancies, 0) }, byFamily,
    classifications: records.map(r => ({ identity: r.identity, revision: r.revision, interpretation: r.interpretation, discrepancies: r.discrepancies })),
    exclusions: ["All rows excluded from quantitative qualification and import acceptance in this slice.", "Targets and device drafts excluded from performed facts.", "Timed/finisher evidence retained as unsupported reference."],
    limitations: capture.limitations };
}

export function renderSourceReport(capture: SourceCapture): string {
  const report = discrepancyReport(capture);
  const text = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return [`# Legacy source reference dry-run`, `Source: ${JSON.stringify(report.scope.system)} / account ${JSON.stringify(report.scope.account)}`, `Scope: ${report.scope.completeness}; hash ${report.sourceHash}`,
    `${report.totals.records} distinct records; ${report.totals.sessions} sessions; ${report.totals.sets} stored set logs; ${report.totals.recordsWithDiscrepancies} distinct records with ${report.totals.discrepancies} discrepancies.`,
    ...report.byFamily.map(f => `${f.family}: ${f.records} records; ${f.recordsWithDiscrepancies} affected; ${f.discrepancies} discrepancies.`),
    ...capture.references.map(r => {
      const raw = canonicalJson(r.raw.fields);
      const summary = Object.entries(r.interpretation.measurement).map(([dimension, v]) => `${dimension}=${v.value ?? "unknown"} (${v.confidence})`).join("; ");
      return text(`${r.identity.family} ${JSON.stringify(r.identity.record)} | ${r.interpretation.kind} | ${r.interpretation.finality}\nRaw stored fields: ${raw.length > 400 ? raw.slice(0, 400) + "… [full raw fields in capture JSON]" : raw}\n${summary}; performed date=${r.interpretation.time.performedDate ?? "unknown"}; performed instant=${r.interpretation.time.performedInstant ?? "unknown"}\nUnresolved: ${r.discrepancies.join(", ") || "none identified within this scope"}`);
    }),
    ...report.exclusions, ...report.limitations].join("\n\n") + "\n";
}

export function compareSourceCaptures(before: SourceCapture, after: SourceCapture) {
  verifySourceCapture(before); verifySourceCapture(after);
  const comparable = before.scope.completeness === "complete-within-declared-families" && after.scope.completeness === "complete-within-declared-families" && canonicalJson(before.scope) === canonicalJson(after.scope);
  const current = new Set(after.references.map(r => identityKey(r.identity)));
  return { comparableCompleteScopes: comparable, disappeared: comparable ? before.references.filter(r => !current.has(identityKey(r.identity))).map(r => r.identity) : [],
    limitation: "Only disappearance within comparable declared synthetic scopes; never deletion authority or deployed coverage." };
}
