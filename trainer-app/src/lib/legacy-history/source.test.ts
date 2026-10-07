import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import fixture from "./fixtures/source-matrix.json";
import { captureSource, compareSourceCaptures, discrepancyReport, renderSourceReport, sourceHash } from "./source";
import { sourceAssertionSchema, sourceCaptureSchema, sourceFixtureSchema, type SourceAssertion } from "../trainer2-contracts/legacy-source";
import { validateLegacySourceTarget } from "../api/trainer2/legacy-source";

const observation = { batchId: "synthetic-batch", capturedAt: "2026-09-10T12:00:00Z", databaseSnapshot: null };
const capture = () => captureSource(fixture, observation);
const find = (record: string, result = capture()) => result.references.find(r => r.identity.record === record)!;
function assertion(record: string, claims: SourceAssertion["claims"]): SourceAssertion {
  const r = find(record);
  return { schemaVersion: 1, identity: r.identity, payloadHash: r.payloadHash, artifactId: `synthetic-test-protocol:${record}`, artifactText: "Synthetic test author explicitly supplied these facts. Not real user history or a production writer-era claim.", claims };
}
describe("read-only legacy source references", () => {
  it("rejects unknown versions, fields, duplicate identity and foreign account rows", () => {
    expect(() => captureSource({ ...fixture, schemaVersion: 2 }, observation)).toThrow();
    expect(() => captureSource({ ...fixture, acceptance: true }, observation)).toThrow();
    expect(() => captureSource({ ...fixture, rows: [...fixture.rows, fixture.rows[0]] }, observation)).toThrow("DUPLICATE");
    expect(() => captureSource({ ...fixture, rows: [{ family: "Workout", record: "foreign", fields: { userId: "foreign" } }] }, observation)).toThrow("CROSS_ACCOUNT");
    expect(() => sourceAssertionSchema.parse({ ...assertion("log-known", {}), claims: { rir: "2" } })).toThrow();
  });
  it("preserves zero, null, missing, decimals and arbitrary non-UUID source IDs", () => {
    expect(find("log-known").raw.fields.actualLoad).toBe("40.00");
    expect(find("log-zero").raw.fields.actualLoad).toBe("0");
    expect(find("log-null").raw.fields.actualLoad).toBeNull();
    expect(find("log-missing").raw.fields).not.toHaveProperty("actualLoad");
    const rendered = renderSourceReport(capture());
    expect(rendered).toContain('"actualLoad":"40.00"');
    expect(rendered).toContain('"actualLoad":null');
  });
  it("does not promote targets, drafts, partial sessions, timer work or logs without provenance", () => {
    expect(find("target-known").interpretation.kind).toBe("prescription-reference");
    expect(find("draft_set_session-known_target-known").interpretation.kind).toBe("unconfirmed-draft");
    expect(find("session-lookalike-1").interpretation.finality).toBe("unresolved");
    expect(find("log-known").interpretation.kind).toBe("recorded-log-unconfirmed");
    expect(find("log-skipped").interpretation.kind).toBe("skipped-log");
    expect(find("timer-known").interpretation.kind).toBe("unsupported-timed-reference");
    expect(capture().references.every(r => !r.interpretation.quantitativelyQualified)).toBe(true);
  });
  it("preserves source assertions for demonstrated synthetic performance without quantitative admission", () => {
    const a = assertion("log-known", { confirmedPerformance: true, unit: "kg", convention: "BARBELL_TOTAL", repBasis: "TOTAL", equipment: "synthetic-bar-A", performedDate: "2026-01-01" });
    const r = find("log-known", captureSource(fixture, observation, [a]));
    expect(r.interpretation.kind).toBe("source-asserted-performance");
    expect(r.interpretation.measurement.unit).toMatchObject({ value: "kg", confidence: "external-source-assertion" });
    expect(r.interpretation.time).toEqual({ performedDate: "2026-01-01", performedInstant: null, confidence: "external-source-assertion" });
    expect(r.interpretation.quantitativelyQualified).toBe(false);
    expect(r.assertions).toEqual([a]);
  });
  it("does not invent performed times from scheduled, completed/update/upload or observation times", () => {
    for (const id of ["log-known", "session-known", "draft_set_session-known_target-known"])
      expect(find(id).interpretation.time).toEqual({ performedDate: null, performedInstant: null, confidence: "unknown" });
    expect(find("review-known").interpretation.startingPrescription).toBe("not-verified-start");
    expect(find("log-known").interpretation.actualEffort).toBe("raw-RPE-only-no-RIR-conversion");
    expect(find("log-known").interpretation.corrections).toContain("no-demonstrated-correction-chain");
  });
  it("binds assertions to account, identity and exact payload; reports conflicting claims", () => {
    const a = assertion("log-known", { unit: "kg" });
    expect(() => captureSource(fixture, observation, [{ ...a, payloadHash: "0".repeat(64) }])).toThrow("BASIS_MISMATCH");
    expect(() => captureSource(fixture, observation, [{ ...a, identity: { ...a.identity, account: "foreign" } }])).toThrow("BASIS_MISMATCH");
    const r = find("log-known", captureSource(fixture, observation, [a, assertion("log-known", { unit: "lb" })]));
    expect(r.interpretation.measurement.unit).toMatchObject({ value: null, confidence: "conflicting" });
    expect(r.discrepancies).toContain("UNIT_CONFLICTING");
  });
  it("keeps source identities independent of values and canonicalizes order", () => {
    const a = find("session-lookalike-1"), b = find("session-lookalike-2");
    expect(a.raw.fields).toEqual(b.raw.fields);
    expect(a.identity).not.toEqual(b.identity);
    expect(a.revision).not.toBe(b.revision);
    const reversed = { ...fixture, scope: { ...fixture.scope, families: [...fixture.scope.families].reverse() }, rows: [...fixture.rows].reverse().map(r => ({ ...r, fields: Object.fromEntries(Object.entries(r.fields).reverse()) })) };
    expect(captureSource(reversed, observation)).toEqual(capture());
  });
  it("recaptures unchanged content deterministically, separating observation metadata", () => {
    const again = captureSource(fixture, { ...observation, batchId: "later", capturedAt: "2026-09-11T12:00:00Z" });
    expect(again.references).toEqual(capture().references);
    expect(discrepancyReport(again)).toEqual(discrepancyReport(capture()));
    expect(renderSourceReport(again)).toBe(renderSourceReport(capture()));
  });
  it("revises connected source dependencies and preserved provenance without changing source identity", () => {
    const changed = sourceFixtureSchema.parse(fixture);
    changed.rows.find(r => r.record === "target-known")!.fields.targetLoad = "41.000";
    const after = captureSource(changed, observation);
    expect(find("log-known", after).identity).toEqual(find("log-known").identity);
    expect(find("log-known", after).payloadHash).toBe(find("log-known").payloadHash);
    expect(find("log-known", after).revision).not.toBe(find("log-known").revision);
    expect(find("session-lookalike-2", after).revision).toBe(find("session-lookalike-2").revision);
    expect(find("log-known", captureSource(fixture, observation, [assertion("log-known", { unit: "kg" })])).revision).not.toBe(find("log-known").revision);
  });
  it("reports unavailable/orphan links without claiming foreign or deleted rows", () => {
    expect(find("log-null").discrepancies).toContain("UNAVAILABLE_RELATION:workoutSetId:WorkoutSet");
    expect(find("target-known").discrepancies).toContain("AMBIGUOUS_POSITION_LINEAGE");
    const missing = captureSource({ ...fixture, rows: fixture.rows.filter(r => r.record !== "log-known") }, observation);
    expect(compareSourceCaptures(capture(), missing).disappeared.map(i => i.record)).toEqual(["log-known"]);
    const partial = captureSource({ ...fixture, scope: { ...fixture.scope, completeness: "partial" }, rows: fixture.rows.filter(r => r.record !== "log-known") }, observation);
    expect(compareSourceCaptures(capture(), partial).disappeared).toEqual([]);
    const other = captureSource({ ...fixture, scope: { ...fixture.scope, account: "other" }, rows: [] }, observation);
    expect(compareSourceCaptures(capture(), other).comparableCompleteScopes).toBe(false);
  });
  it("counts distinct records separately from discrepancies, sessions and logs", () => {
    const report = discrepancyReport(capture());
    expect(report.totals.records).toBe(fixture.rows.length);
    expect(report.totals.sessions).toBe(3);
    expect(report.totals.sets).toBe(5);
    expect(report.byFamily.reduce((n, f) => n + f.records, 0)).toBe(report.totals.records);
    expect(report.totals.discrepancies).toBeGreaterThan(report.totals.recordsWithDiscrepancies);
    expect(sourceCaptureSchema.parse(JSON.parse(JSON.stringify(capture())))).toEqual(capture());
    expect(sourceHash({ decimal: "1.0" })).not.toBe(sourceHash({ decimal: "1.00" }));
    const tampered = capture(); tampered.references[0].raw.fields.injected = "changed";
    expect(() => discrepancyReport(tampered)).toThrow("INTEGRITY");
  });
  it("preserves contradictory seed references as discrepancies rather than repairing lineage", () => {
    const input = sourceFixtureSchema.parse(fixture);
    input.scope.families.push("MesocycleSeedRevision");
    input.rows.push({ family: "MesocycleSeedRevision", record: "missing-seed", fields: { mesocycleId: "other-meso", revision: "2", payloadHash: "stored-hash" } });
    const session = input.rows.find(r => r.record === "session-known")!;
    session.fields.mesocycleId = "intended-meso";
    session.fields.seedRevisionNumber = "1";
    const result = find("session-known", captureSource(input, observation));
    expect(result.discrepancies).toContain("CONFLICTING_SEED_LINEAGE");
    expect(result.discrepancies).toContain("CONFLICTING_SEED_REVISION_REFERENCE");
    expect(result.raw.fields.seedRevisionNumber).toBe("1");
  });
  it("rejects shared targets, privileged roles, libpq query overrides and hosted target names", () => {
    expect(validateLegacySourceTarget("postgresql://trainer2_legacy_reader:p@127.0.0.1:5432/trainer2_disposable_test").hostname).toBe("127.0.0.1");
    for (const url of ["postgresql://postgres:p@127.0.0.1:5432/trainer2_disposable_test", "postgresql://trainer2_legacy_reader:p@db.example:5432/trainer2_disposable_test", "postgresql://trainer2_legacy_reader:p@127.0.0.1:5432/production", "postgresql://trainer2_legacy_reader:p@127.0.0.1:5432/trainer2_disposable_test?host=db.example"])
      expect(() => validateLegacySourceTarget(url)).toThrow();
  });
  it("traverses adapter/CLI imports and permits only source contracts, hashing, pg and read-only source owners", () => {
    const allowed = ["scripts/capture-trainer2-legacy-source.ts", "src/lib/api/trainer2/legacy-source.ts", "src/lib/api/trainer2/legacy-source-queries.ts", "src/lib/api/trainer2/integrity.ts", "src/lib/trainer2-contracts/canonical-json.ts", "src/lib/legacy-history/source.ts", "src/lib/legacy-history/relations.ts", "src/lib/trainer2-contracts/legacy-source.ts", "src/lib/operations/test-environment-preflight.ts"];
    const seen = new Set<string>();
    function walk(path: string) {
      if (seen.has(path)) return; seen.add(path);
      expect(allowed.map(p => resolve(p))).toContain(path);
      const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
      function visit(node: ts.Node) {
        let specifier: string | undefined;
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specifier = node.moduleSpecifier.text;
        if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(source) === "require")) {
          expect(node.arguments.length).toBe(1); expect(ts.isStringLiteral(node.arguments[0])).toBe(true);
          if (ts.isStringLiteral(node.arguments[0])) specifier = node.arguments[0].text;
        }
        if (specifier?.startsWith(".")) walk(resolve(dirname(path), specifier + ".ts"));
        else if (specifier) expect(["pg", "zod", "node:crypto", "node:fs", "node:path"]).toContain(specifier);
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
    walk(resolve("scripts/capture-trainer2-legacy-source.ts"));
    expect(seen.size).toBe(9);
  });
});
