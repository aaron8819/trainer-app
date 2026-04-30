import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

type JsonRecord = Record<string, unknown>;

type CompareValue =
  | { status: "value"; value: string | number | boolean | JsonRecord }
  | { status: "missing" }
  | { status: "n/a" };

export type MesocycleExplainCompareArtifactSummary = {
  artifactPath: string;
  mainBytes: number;
  sidecar?: {
    status: "loaded" | "missing" | "not_linked" | "disabled";
    path?: string;
    bytes?: number;
    sha256?: string;
  };
  values: Record<string, CompareValue>;
};

export type MesocycleExplainCompareMetric = {
  key: string;
  label: string;
  before: CompareValue;
  after: CompareValue;
  delta: string;
};

export type MesocycleExplainCompareSummary = {
  beforePath: string;
  afterPath: string;
  includeSidecar: boolean;
  warnings: string[];
  before: MesocycleExplainCompareArtifactSummary;
  after: MesocycleExplainCompareArtifactSummary;
  metrics: MesocycleExplainCompareMetric[];
};

type LoadedArtifact = {
  path: string;
  raw: string;
  json: JsonRecord;
};

type SidecarLoadResult = {
  status: "loaded" | "missing" | "not_linked" | "disabled";
  path?: string;
  bytes?: number;
  sha256?: string;
  json?: JsonRecord;
  warning?: string;
};

type MetricDefinition = {
  key: string;
  label: string;
  read: (artifact: JsonRecord, sidecar: JsonRecord | null) => CompareValue;
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord | null {
  return isRecord(value) ? value : null;
}

function asRecordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function getPath(value: unknown, keys: string[]): unknown {
  let current = value;
  for (const key of keys) {
    const record = asRecord(current);
    if (!record || !(key in record)) {
      return undefined;
    }
    current = record[key];
  }
  return current;
}

function valueOf(value: unknown): CompareValue {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return { status: "value", value };
  }
  if (isRecord(value)) {
    return { status: "value", value };
  }
  return { status: "missing" };
}

function firstValue(...values: unknown[]): CompareValue {
  for (const value of values) {
    const candidate = valueOf(value);
    if (candidate.status === "value") {
      return candidate;
    }
  }
  return { status: "missing" };
}

function countArray(value: unknown): CompareValue {
  if (!Array.isArray(value)) {
    return { status: "missing" };
  }
  return { status: "value", value: value.length };
}

function arrayCountValue(value: unknown): number | undefined {
  return Array.isArray(value) ? value.length : undefined;
}

function countHighExerciseConcentration(artifact: JsonRecord): CompareValue {
  const rows = asRecordArray(
    getPath(artifact, [
      "mesocycleExplain",
      "preview",
      "projectionDiagnostics",
      "planningReality",
      "exerciseConcentration",
    ])
  );
  if (rows.length === 0) {
    const raw = getPath(artifact, [
      "mesocycleExplain",
      "preview",
      "projectionDiagnostics",
      "planningReality",
      "exerciseConcentration",
    ]);
    return Array.isArray(raw) ? { status: "value", value: 0 } : { status: "missing" };
  }

  const count = rows.filter((row) =>
    (Array.isArray(row.flags) ? row.flags : []).some(
      (flag) =>
        typeof flag === "string" &&
        (flag === "COMPOUND_GT_5_SETS" ||
          flag === "ISOLATION_GT_5_SETS" ||
          flag.includes("EXERCISE_SUPPLIES_OVER"))
    )
  ).length;
  return { status: "value", value: count };
}

function noRepairSource(artifact: JsonRecord, sidecar: JsonRecord | null): JsonRecord | null {
  return (
    asRecord(getPath(artifact, ["mesocycleExplain", "plannerOnlyNoRepair"])) ??
    asRecord(getPath(sidecar, ["plannerOnlyNoRepair"]))
  );
}

function sidecarNoRepairSource(sidecar: JsonRecord | null): JsonRecord | null {
  return asRecord(getPath(sidecar, ["plannerOnlyNoRepair"]));
}

function sidecarValue(
  sidecar: JsonRecord | null,
  read: (noRepair: JsonRecord) => unknown
): CompareValue {
  const noRepair = sidecarNoRepairSource(sidecar);
  if (!noRepair) {
    return { status: "n/a" };
  }
  return valueOf(read(noRepair));
}

function countLaneStatus(
  artifact: JsonRecord,
  sidecar: JsonRecord | null,
  compactKey: string,
  fullKey: string
): CompareValue {
  const noRepair = noRepairSource(artifact, sidecar);
  if (!noRepair) {
    return { status: "missing" };
  }
  return firstValue(
    getPath(noRepair, ["v2Summary", "laneCounts", compactKey]),
    getPath(noRepair, ["v2TargetVsNoRepairDiff", "summary", fullKey])
  );
}

function compactGateStatus(noRepair: JsonRecord, key: string): unknown {
  const gate = asRecord(noRepair.crossWeekProjectionGate);
  if (!gate) {
    return undefined;
  }
  if (key === "safeToPromoteBehavior") {
    return gate.safeToPromoteBehavior;
  }
  return getPath(gate, [key, "status"]) ?? gate[key];
}

const METRICS: MetricDefinition[] = [
  {
    key: "planningShape",
    label: "planningShape",
    read: (artifact) =>
      valueOf(
        getPath(artifact, [
          "mesocycleExplain",
          "preview",
          "projectionDiagnostics",
          "planningReality",
          "summary",
          "planningShape",
        ])
      ),
  },
  {
    key: "materialRepairCount",
    label: "materialRepairCount",
    read: (artifact) =>
      firstValue(
        getPath(artifact, [
          "mesocycleExplain",
          "preview",
          "projectionDiagnostics",
          "planningReality",
          "shadowRepairSummary",
          "materialRepairCount",
        ]),
        getPath(artifact, [
          "mesocycleExplain",
          "preview",
          "projectionDiagnostics",
          "planningReality",
          "summary",
          "materialRepairCount",
        ])
      ),
  },
  {
    key: "majorRepairCount",
    label: "majorRepairCount",
    read: (artifact) =>
      firstValue(
        getPath(artifact, [
          "mesocycleExplain",
          "preview",
          "projectionDiagnostics",
          "planningReality",
          "shadowRepairSummary",
          "majorRepairCount",
        ]),
        getPath(artifact, [
          "mesocycleExplain",
          "preview",
          "projectionDiagnostics",
          "planningReality",
          "summary",
          "majorRepairCount",
        ])
      ),
  },
  {
    key: "likelyAvoidableMaterialRepairCount",
    label: "likelyAvoidableMaterialRepairCount",
    read: (artifact) =>
      valueOf(
        getPath(artifact, [
          "mesocycleExplain",
          "preview",
          "projectionDiagnostics",
          "planningReality",
          "shadowRepairSummary",
          "likelyAvoidableMaterialRepairCount",
        ])
      ),
  },
  {
    key: "remainingMaterialRepairCount",
    label: "remainingMaterialRepairCount",
    read: (artifact) =>
      valueOf(
        getPath(artifact, [
          "mesocycleExplain",
          "preview",
          "projectionDiagnostics",
          "planningReality",
          "shadowRepairSummary",
          "remainingMaterialRepairCount",
        ])
      ),
  },
  {
    key: "suspiciousRepairsNotEligibleForPromotion",
    label: "suspiciousRepairsNotEligibleForPromotion",
    read: (artifact) =>
      countArray(
        getPath(artifact, [
          "mesocycleExplain",
          "preview",
          "projectionDiagnostics",
          "planningReality",
          "suspiciousRepairsNotEligibleForPromotion",
        ])
      ),
  },
  {
    key: "basicMesocycleShapeStatus",
    label: "plannerOnlyNoRepair.summary.basicMesocycleShapeStatus",
    read: (artifact, sidecar) => {
      const noRepair = noRepairSource(artifact, sidecar);
      return noRepair
        ? firstValue(
            getPath(noRepair, ["summary", "basicMesocycleShapeStatus"]),
            getPath(noRepair, ["acceptanceClassification", "basicMesocycleShapeStatus"])
          )
        : { status: "missing" };
    },
  },
  {
    key: "canReplaceRepairedProjection",
    label: "plannerOnlyNoRepair.replacementReadiness.canReplaceRepairedProjection",
    read: (artifact, sidecar) => {
      const noRepair = noRepairSource(artifact, sidecar);
      return noRepair
        ? firstValue(
            getPath(noRepair, ["replacementReadiness", "canReplaceRepairedProjection"]),
            noRepair.canReplaceRepairedProjection
          )
        : { status: "missing" };
    },
  },
  {
    key: "nextBestMigrationSlice",
    label: "plannerOnlyNoRepair.summary.nextBestMigrationSlice",
    read: (artifact, sidecar) => {
      const noRepair = noRepairSource(artifact, sidecar);
      return noRepair
        ? firstValue(
            getPath(noRepair, ["summary", "nextBestMigrationSlice"]),
            getPath(noRepair, [
              "v2TargetVsNoRepairDiff",
              "replacementReadinessImpact",
              "nextBestMigrationSlice",
            ])
          )
        : { status: "missing" };
    },
  },
  {
    key: "targetVsNoRepairSummary",
    label: "plannerOnlyNoRepair.v2Summary.targetVsNoRepairSummary",
    read: (artifact, sidecar) => {
      const noRepair = noRepairSource(artifact, sidecar);
      return noRepair
        ? firstValue(
            getPath(noRepair, ["v2Summary", "targetVsNoRepairSummary"]),
            getPath(noRepair, ["v2TargetVsNoRepairDiff", "summary"])
          )
        : { status: "missing" };
    },
  },
  {
    key: "migrationScoreboard",
    label: "plannerOnlyNoRepair.v2Summary.migrationScoreboard",
    read: (artifact, sidecar) => {
      const noRepair = noRepairSource(artifact, sidecar);
      return noRepair
        ? firstValue(
            getPath(noRepair, ["v2Summary", "migrationScoreboard"]),
            getPath(noRepair, ["acceptanceClassification", "migrationScoreboard"])
          )
        : { status: "missing" };
    },
  },
  {
    key: "crossWeekWeek1Status",
    label: "crossWeekProjectionGate.week1Status",
    read: (_artifact, sidecar) =>
      sidecarValue(sidecar, (noRepair) => compactGateStatus(noRepair, "week1Status")),
  },
  {
    key: "crossWeekAccumulationWeeksStatus",
    label: "crossWeekProjectionGate.accumulationWeeksStatus",
    read: (_artifact, sidecar) =>
      sidecarValue(sidecar, (noRepair) =>
        compactGateStatus(noRepair, "accumulationWeeksStatus")
      ),
  },
  {
    key: "crossWeekDeloadStatus",
    label: "crossWeekProjectionGate.deloadStatus",
    read: (_artifact, sidecar) =>
      sidecarValue(sidecar, (noRepair) => compactGateStatus(noRepair, "deloadStatus")),
  },
  {
    key: "crossWeekReplacementReadinessStatus",
    label: "crossWeekProjectionGate.replacementReadinessStatus",
    read: (_artifact, sidecar) =>
      sidecarValue(sidecar, (noRepair) =>
        compactGateStatus(noRepair, "replacementReadinessStatus")
      ),
  },
  {
    key: "crossWeekSafeToPromoteBehavior",
    label: "crossWeekProjectionGate.safeToPromoteBehavior",
    read: (_artifact, sidecar) =>
      sidecarValue(sidecar, (noRepair) =>
        compactGateStatus(noRepair, "safeToPromoteBehavior")
      ),
  },
  {
    key: "v2ExerciseSelectionPlanDiagnosticStatus",
    label: "v2ExerciseSelectionPlanDiagnostic.status",
    read: (_artifact, sidecar) =>
      sidecarValue(sidecar, (noRepair) =>
        getPath(noRepair, ["v2ExerciseSelectionPlanDiagnostic", "status"])
      ),
  },
  {
    key: "v2DeloadProjectionDiagnosticStatus",
    label: "v2DeloadProjectionDiagnostic.status",
    read: (_artifact, sidecar) =>
      sidecarValue(sidecar, (noRepair) =>
        getPath(noRepair, ["v2DeloadProjectionDiagnostic", "status"])
      ),
  },
  {
    key: "highExerciseConcentrationCount",
    label: "highExerciseConcentrationCount",
    read: (artifact) => countHighExerciseConcentration(artifact),
  },
  {
    key: "artifactSemanticWarningCount",
    label: "warningSummary.counts.semanticWarnings",
    read: (artifact) =>
      valueOf(getPath(artifact, ["warningSummary", "counts", "semanticWarnings"])),
  },
  {
    key: "artifactBlockingErrorCount",
    label: "warningSummary.counts.blockingErrors",
    read: (artifact) =>
      valueOf(getPath(artifact, ["warningSummary", "counts", "blockingErrors"])),
  },
  {
    key: "plannerWarningCount",
    label: "plannerOnlyNoRepair.summary.warningCount",
    read: (artifact, sidecar) => {
      const noRepair = noRepairSource(artifact, sidecar);
      return noRepair
        ? firstValue(
            getPath(noRepair, ["summary", "warningCount"]),
            arrayCountValue(
              getPath(noRepair, ["acceptanceClassification", "qualityWarnings"])
            )
          )
        : { status: "missing" };
    },
  },
  {
    key: "plannerBlockerCount",
    label: "plannerOnlyNoRepair.summary.hardBlockerCount",
    read: (artifact, sidecar) => {
      const noRepair = noRepairSource(artifact, sidecar);
      return noRepair
        ? firstValue(
            getPath(noRepair, ["summary", "hardBlockerCount"]),
            arrayCountValue(
              getPath(noRepair, ["acceptanceClassification", "hardBlockers"])
            )
          )
        : { status: "missing" };
    },
  },
  {
    key: "migrationCandidateCount",
    label: "migrationCandidateCount",
    read: (artifact, sidecar) =>
      countLaneStatus(
        artifact,
        sidecar,
        "migrationCandidates",
        "migrationCandidateCount"
      ),
  },
  {
    key: "blockedLaneCount",
    label: "blockedLaneCount",
    read: (artifact, sidecar) =>
      countLaneStatus(artifact, sidecar, "blocked", "blockedLaneCount"),
  },
  {
    key: "repairDependentLaneCount",
    label: "repairDependentLaneCount",
    read: (artifact, sidecar) =>
      countLaneStatus(
        artifact,
        sidecar,
        "repairDependent",
        "repairDependentLaneCount"
      ),
  },
  {
    key: "mainArtifactBytes",
    label: "main artifact bytes",
    read: () => ({ status: "missing" }),
  },
  {
    key: "sidecarBytes",
    label: "sidecar bytes",
    read: () => ({ status: "missing" }),
  },
  {
    key: "sidecarSha256",
    label: "sidecar sha256",
    read: () => ({ status: "missing" }),
  },
];

function compareValueToJson(value: CompareValue): unknown {
  if (value.status === "value") {
    return value.value;
  }
  return value.status;
}

function compactString(value: string, maxLength = 96): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function summarizeRecord(value: JsonRecord): string {
  const entries = Object.entries(value).slice(0, 8);
  const body = entries
    .map(([key, entry]) => {
      if (
        typeof entry === "string" ||
        typeof entry === "number" ||
        typeof entry === "boolean"
      ) {
        return `${key}=${compactString(String(entry))}`;
      }
      return `${key}=${compactString(JSON.stringify(entry))}`;
    })
    .join(", ");
  const omitted = Object.keys(value).length - entries.length;
  return omitted > 0 ? `${body}, +${omitted} more` : body;
}

function stableValue(value: CompareValue): string {
  if (value.status !== "value") {
    return value.status;
  }
  if (typeof value.value === "object") {
    return summarizeRecord(value.value);
  }
  return String(value.value);
}

function buildDelta(before: CompareValue, after: CompareValue): string {
  if (before.status !== "value" || after.status !== "value") {
    return before.status === after.status ? "unchanged" : `${before.status} -> ${after.status}`;
  }
  if (typeof before.value === "number" && typeof after.value === "number") {
    const delta = after.value - before.value;
    return delta === 0 ? "0" : delta > 0 ? `+${delta}` : String(delta);
  }
  const beforeSerialized = stableValue(before);
  const afterSerialized = stableValue(after);
  return beforeSerialized === afterSerialized
    ? "unchanged"
    : `${beforeSerialized} -> ${afterSerialized}`;
}

function resolveSidecarCandidatePaths(mainPath: string, relativePath: string): string[] {
  const mainDir = path.dirname(mainPath);
  const candidates = [
    path.resolve(mainDir, relativePath),
    path.resolve(mainDir, path.basename(relativePath)),
    path.resolve(process.cwd(), relativePath),
  ];
  return Array.from(new Set(candidates));
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonArtifact(filePath: string): Promise<LoadedArtifact> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid artifact path: ${filePath} (${message})`);
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      throw new Error("top-level JSON value is not an object");
    }
    return { path: filePath, raw, json: parsed };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in artifact: ${filePath} (${message})`);
  }
}

function mergeShardDataIntoNoRepair(
  noRepair: JsonRecord,
  data: JsonRecord,
): void {
  const directKeys = [
    "crossWeekProjectionGate",
    "plannerOwnedAccumulationProjection",
    "repairPromotionScoreboard",
    "v2DeloadProjectionDiagnostic",
    "v2ExerciseSelectionPlanDiagnostic",
    "v2MesocyclePlan",
    "v2MesocycleStrategyDiagnostic",
    "v2SelectionCapacityPlanDiagnostic",
    "v2SetDistributionIntent",
    "v2SupportLanePolicy",
    "v2SupportLaneProjectionDiagnostic",
    "v2TargetVsNoRepairDiff",
    "lowAxialHipExtensionLimitation",
  ];

  for (const key of directKeys) {
    if (key in data) {
      noRepair[key] = data[key];
    }
  }

  if ("strategyHypothesisPromotionReadiness" in data) {
    const existingStrategy =
      asRecord(noRepair.v2MesocycleStrategyDiagnostic) ?? {};
    noRepair.v2MesocycleStrategyDiagnostic = {
      ...existingStrategy,
      strategyHypothesisPromotionReadiness:
        data.strategyHypothesisPromotionReadiness,
    };
  }

  if ("strategyHypothesisPromotionDiff" in data) {
    const existingStrategy =
      asRecord(noRepair.v2MesocycleStrategyDiagnostic) ?? {};
    noRepair.v2MesocycleStrategyDiagnostic = {
      ...existingStrategy,
      strategyHypothesisPromotionDiff: data.strategyHypothesisPromotionDiff,
    };
  }
}

async function loadV2DebugIndexAsSidecar(input: {
  index: JsonRecord;
  artifactPath: string;
}): Promise<{ json: JsonRecord; warning?: string }> {
  const noRepair = {
    ...(asRecord(input.index.plannerOnlyNoRepair) ?? {}),
  };
  const missingShards: string[] = [];

  for (const shard of asRecordArray(input.index.shards)) {
    if (shard.status !== "written") {
      continue;
    }
    const relativePath = shard.relativePath;
    if (typeof relativePath !== "string" || relativePath.length === 0) {
      continue;
    }

    const candidatePaths = resolveSidecarCandidatePaths(
      input.artifactPath,
      relativePath,
    );
    let existingPath: string | undefined;
    for (const candidate of candidatePaths) {
      if (await pathExists(candidate)) {
        existingPath = candidate;
        break;
      }
    }
    if (!existingPath) {
      missingShards.push(relativePath);
      continue;
    }

    const loadedShard = await readJsonArtifact(existingPath);
    const shardData = asRecord(loadedShard.json.data);
    if (shardData) {
      mergeShardDataIntoNoRepair(noRepair, shardData);
    }
  }

  return {
    json: {
      ...input.index,
      plannerOnlyNoRepair: noRepair,
    },
    warning:
      missingShards.length > 0
        ? `Missing linked V2 debug shard(s) for ${input.artifactPath}: ${missingShards.join(", ")}`
        : undefined,
  };
}

async function loadLinkedSidecar(input: {
  artifact: JsonRecord;
  artifactPath: string;
  includeSidecar: boolean;
}): Promise<SidecarLoadResult> {
  if (!input.includeSidecar) {
    return { status: "disabled" };
  }

  const manifest = asRecord(
    getPath(input.artifact, [
      "mesocycleExplain",
      "plannerOnlyNoRepair",
      "debugArtifact",
    ])
  );
  const relativePath = manifest?.relativePath;
  if (typeof relativePath !== "string" || relativePath.length === 0) {
    return { status: "not_linked" };
  }

  const linkedSha256 =
    typeof manifest?.sha256 === "string" ? manifest.sha256 : undefined;
  const candidatePaths = resolveSidecarCandidatePaths(input.artifactPath, relativePath);
  const sidecarPath = candidatePaths[0];
  let existingPath: string | undefined;
  for (const candidate of candidatePaths) {
    if (await pathExists(candidate)) {
      existingPath = candidate;
      break;
    }
  }
  if (!existingPath) {
    return {
      status: "missing",
      path: sidecarPath,
      sha256: linkedSha256,
      warning: `Missing linked V2 sidecar for ${input.artifactPath}: ${sidecarPath}`,
    };
  }

  const loaded = await readJsonArtifact(existingPath);
  const loadedJson =
    loaded.json.kind === "v2_debug_index"
      ? await loadV2DebugIndexAsSidecar({
          index: loaded.json,
          artifactPath: input.artifactPath,
        })
      : { json: loaded.json, warning: undefined };

  return {
    status: "loaded",
    path: existingPath,
    bytes: Buffer.byteLength(loaded.raw, "utf8"),
    sha256:
      linkedSha256
        ? linkedSha256
        : createHash("sha256").update(loaded.raw, "utf8").digest("hex"),
    json: loadedJson.json,
    warning: loadedJson.warning,
  };
}

function extractValues(artifact: JsonRecord, sidecar: JsonRecord | null): Record<string, CompareValue> {
  return Object.fromEntries(
    METRICS.map((metric) => [metric.key, metric.read(artifact, sidecar)])
  );
}

async function summarizeArtifact(input: {
  artifactPath: string;
  includeSidecar: boolean;
}): Promise<{
  summary: MesocycleExplainCompareArtifactSummary;
  warnings: string[];
}> {
  const artifact = await readJsonArtifact(input.artifactPath);
  const sidecar = await loadLinkedSidecar({
    artifact: artifact.json,
    artifactPath: input.artifactPath,
    includeSidecar: input.includeSidecar,
  });
  const values = extractValues(
    artifact.json,
    sidecar.status === "loaded" ? sidecar.json ?? null : null
  );
  values.mainArtifactBytes = {
    status: "value",
    value: Buffer.byteLength(artifact.raw, "utf8"),
  };
  values.sidecarBytes =
    typeof sidecar.bytes === "number"
      ? { status: "value", value: sidecar.bytes }
      : { status: sidecar.status === "not_linked" || sidecar.status === "disabled" ? "n/a" : "missing" };
  values.sidecarSha256 =
    typeof sidecar.sha256 === "string"
      ? { status: "value", value: sidecar.sha256 }
      : { status: sidecar.status === "not_linked" || sidecar.status === "disabled" ? "n/a" : "missing" };

  return {
    summary: {
      artifactPath: input.artifactPath,
      mainBytes: Buffer.byteLength(artifact.raw, "utf8"),
      sidecar: {
        status: sidecar.status,
        path: sidecar.path,
        bytes: sidecar.bytes,
        sha256: sidecar.sha256,
      },
      values,
    },
    warnings: sidecar.warning ? [sidecar.warning] : [],
  };
}

export async function compareMesocycleExplainArtifacts(input: {
  beforePath: string;
  afterPath: string;
  includeSidecar?: boolean;
}): Promise<MesocycleExplainCompareSummary> {
  const includeSidecar = input.includeSidecar ?? true;
  const [beforeResult, afterResult] = await Promise.all([
    summarizeArtifact({
      artifactPath: input.beforePath,
      includeSidecar,
    }),
    summarizeArtifact({
      artifactPath: input.afterPath,
      includeSidecar,
    }),
  ]);

  const metrics = METRICS.map((definition) => {
    const before = beforeResult.summary.values[definition.key] ?? { status: "missing" as const };
    const after = afterResult.summary.values[definition.key] ?? { status: "missing" as const };
    return {
      key: definition.key,
      label: definition.label,
      before,
      after,
      delta: buildDelta(before, after),
    };
  });

  return {
    beforePath: input.beforePath,
    afterPath: input.afterPath,
    includeSidecar,
    warnings: [...beforeResult.warnings, ...afterResult.warnings],
    before: beforeResult.summary,
    after: afterResult.summary,
    metrics,
  };
}

export function formatMesocycleExplainCompareTable(
  summary: MesocycleExplainCompareSummary
): string {
  const rows = [
    ["metric", "before", "after", "delta"],
    ...summary.metrics.map((metric) => [
      metric.label,
      stableValue(metric.before),
      stableValue(metric.after),
      metric.delta,
    ]),
  ];
  const widths = rows[0].map((_, columnIndex) =>
    Math.max(...rows.map((row) => row[columnIndex].length))
  );
  const formatRow = (row: string[]): string =>
    row.map((cell, index) => cell.padEnd(widths[index])).join("  ");
  return [
    "Mesocycle Explain Compare",
    `before: ${summary.beforePath}`,
    `after:  ${summary.afterPath}`,
    "",
    formatRow(rows[0]),
    formatRow(widths.map((width) => "-".repeat(width))),
    ...rows.slice(1).map(formatRow),
  ].join("\n");
}

export function stringifyMesocycleExplainCompareJson(
  summary: MesocycleExplainCompareSummary
): string {
  return JSON.stringify(
    {
      beforePath: summary.beforePath,
      afterPath: summary.afterPath,
      includeSidecar: summary.includeSidecar,
      warnings: summary.warnings,
      sidecars: {
        before: summary.before.sidecar,
        after: summary.after.sidecar,
      },
      metrics: summary.metrics.map((metric) => ({
        key: metric.key,
        label: metric.label,
        before: compareValueToJson(metric.before),
        after: compareValueToJson(metric.after),
        delta: metric.delta,
      })),
    },
    null,
    2
  );
}
