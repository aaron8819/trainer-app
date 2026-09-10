import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { draftDocument, measurement, type DraftDocument, type EditDraftCommand } from "../../trainer2-contracts/draft";
import { editDocument, identities } from "./planning";
import { canonicalJson, commandBinding } from "../../api/trainer2/integrity";

function fixture() {
  const stageId = randomUUID();
  const doc: DraftDocument = { schemaVersion: 1, name: "draft", endpoint: "endOfOrderedOccurrences", stages: [{ id: stageId, name: "first" }], occurrences: [{ id: randomUUID(), stageId, name: "session", positions: [] }] };
  const command: EditDraftCommand = { schemaVersion: 1, commandType: "EditDraft", actionId: randomUUID(), originatingAccountId: randomUUID(), deviceId: randomUUID(), ownershipEpoch: 0, dependsOn: [], target: { planId: randomUUID() }, expected: { planRevisionId: randomUUID() }, intent: { operations: [] } };
  return { doc, command };
}
describe("Trainer2 immutable draft policy", () => {
  it("permits incomplete finite drafts but rejects invalid references and duplicate IDs", () => {
    const { doc } = fixture(); expect(draftDocument.safeParse(doc).success).toBe(true);
    expect(draftDocument.safeParse({ ...doc, unexpected: true }).success).toBe(false);
    doc.occurrences[0].stageId = randomUUID(); expect(draftDocument.safeParse(doc).success).toBe(false);
    doc.occurrences[0].stageId = doc.stages[0].id; doc.occurrences[0].id = doc.stages[0].id;
    expect(draftDocument.safeParse(doc).success).toBe(false);
  });
  it("keeps decimal spelling and measurement kind; rejects ambiguous combinations", () => {
    const load = { kind: "assistance", value: "0.00", unit: "kg", convention: "displayedAssistance", zeroMeaning: "noAssistance" };
    expect(measurement.parse(load)).toEqual(load);
    for (const patch of [{ value: 0 }, { value: "1e2" }, { convention: "barbellTotal" }, { unit: "lbs" }])
      expect(measurement.safeParse({ ...load, ...patch }).success).toBe(false);
    expect(measurement.safeParse({ ...load, kind: "externalLoad", convention: "barbellTotal", zeroMeaning: "notAllowed" }).success).toBe(false);
    expect(canonicalJson({ value: "20.00" })).not.toBe(canonicalJson({ value: "20.0" }));
  });
  it("canonicalizes only object order and binds ordered arrays", () => {
    expect(commandBinding({ a: 1, b: "2.00" })).toEqual(commandBinding({ b: "2.00", a: 1 }));
    expect(commandBinding({ a: ["a", "b"] }).envelopeHash).not.toBe(commandBinding({ a: ["b", "a"] }).envelopeHash);
    expect(() => canonicalJson({ a: undefined })).toThrow();
  });
  it("explicitly moves occurrences between stages and rejects incomplete reorders", () => {
    const { doc, command } = fixture(); const second = { id: randomUUID(), name: "second" };
    command.intent.operations = [{ op: "addStage", stage: second }, { op: "editOccurrence", occurrenceId: doc.occurrences[0].id, stageId: second.id, name: "renamed" }, { op: "removeStage", stageId: doc.stages[0].id }];
    const edited = editDocument(doc, command, new Set(identities(doc).map(i => i.id)));
    expect(edited.occurrences[0].id).toBe(doc.occurrences[0].id); expect(doc.stages).toHaveLength(1);
    command.intent.operations = [{ op: "reorderOccurrences", occurrenceIds: [] }];
    expect(() => editDocument(doc, command, new Set(identities(doc).map(i => i.id)))).toThrow("INVALID_OPERATION");
  });
  it("rejects remove and reintroduce in the same action, even before persistence", () => {
    const { doc, command } = fixture();
    command.intent.operations = [{ op: "removeOccurrence", occurrenceId: doc.occurrences[0].id }, { op: "addOccurrence", occurrence: doc.occurrences[0] }];
    expect(() => editDocument(doc, command, new Set(identities(doc).map(i => i.id)))).toThrow("IDENTITY_REUSED");
  });
});
