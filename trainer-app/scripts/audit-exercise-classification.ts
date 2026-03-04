import fs from "node:fs";
import path from "node:path";
import * as stimulus from "@/lib/engine/stimulus";

type JsonExercise = {
  name: string;
  movementPatterns: string[];
  splitTag: string;
  isCompound: boolean;
  isMainLiftEligible: boolean;
  jointStress: string;
  equipment: string[];
  fatigueCost: number;
  sfrScore: number;
  lengthPositionScore: number;
  stimulusBias: string[];
  contraindications: Record<string, unknown> | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  difficulty?: string;
  unilateral?: boolean;
  repRangeRecommendation?: { min: number; max: number };
};

type JsonExerciseLibrary = { exercises: JsonExercise[] };

const HYPERTROPHY_SPLITS = new Set(["push", "pull", "legs"]);

const MUSCLE_SPLIT_MAP: Record<string, "push" | "pull" | "legs"> = {
  Chest: "push",
  "Front Delts": "push",
  "Side Delts": "push",
  Triceps: "push",
  Lats: "pull",
  "Upper Back": "pull",
  "Rear Delts": "pull",
  Biceps: "pull",
  Forearms: "pull",
  Quads: "legs",
  Hamstrings: "legs",
  Glutes: "legs",
  Calves: "legs",
  Adductors: "legs",
  Abductors: "legs",
  Core: "legs",
  Abs: "legs",
  "Lower Back": "legs",
};

function csvEscape(value: unknown): string {
  const serialized = String(value ?? "");
  if (
    serialized.includes(",") ||
    serialized.includes('"') ||
    serialized.includes("\n")
  ) {
    return `"${serialized.replace(/"/g, '""')}"`;
  }
  return serialized;
}

function bumpCount(map: Record<string, number>, key: string) {
  map[key] = (map[key] ?? 0) + 1;
}

function main() {
  const sourcePath = path.resolve(
    process.cwd(),
    "prisma/exercises_comprehensive.json"
  );
  const outputDir = path.resolve(process.cwd(), "artifacts/audits");
  fs.mkdirSync(outputDir, { recursive: true });

  const source = JSON.parse(
    fs.readFileSync(sourcePath, "utf8")
  ) as JsonExerciseLibrary;
  const exercises = source.exercises ?? [];

  const counts = {
    splitTag: {} as Record<string, number>,
    movementPattern: {} as Record<string, number>,
    jointStress: {} as Record<string, number>,
    difficulty: {} as Record<string, number>,
    stimulusBias: {} as Record<string, number>,
    equipment: {} as Record<string, number>,
  };

  const rows: Array<Record<string, string | number | boolean | null>> = [];
  const flagged: Array<{ name: string; flags: string[] }> = [];

  for (const exercise of exercises) {
    bumpCount(counts.splitTag, exercise.splitTag);
    bumpCount(counts.jointStress, exercise.jointStress);
    bumpCount(counts.difficulty, exercise.difficulty ?? "beginner");

    for (const pattern of exercise.movementPatterns ?? []) {
      bumpCount(counts.movementPattern, pattern);
    }
    for (const bias of exercise.stimulusBias ?? []) {
      bumpCount(counts.stimulusBias, bias);
    }
    for (const equipment of exercise.equipment ?? []) {
      bumpCount(counts.equipment, equipment);
    }

    const flags: string[] = [];
    if ((exercise.primaryMuscles?.length ?? 0) === 0) {
      flags.push("missing_primary_muscles");
    }
    if ((exercise.movementPatterns?.length ?? 0) === 0) {
      flags.push("missing_movement_patterns");
    }
    if ((exercise.equipment?.length ?? 0) === 0) {
      flags.push("missing_equipment");
    }
    if ((exercise.stimulusBias?.length ?? 0) === 0) {
      flags.push("missing_stimulus_bias");
    }

    // Split mismatch checks apply only to canonical hypertrophy splits.
    // Core/conditioning/prehab are distinct tracks and should not be forced
    // into push/pull/legs semantic checks.
    if (HYPERTROPHY_SPLITS.has(exercise.splitTag)) {
      const primarySplits = [
        ...new Set(
          (exercise.primaryMuscles ?? [])
            .map((muscle) => MUSCLE_SPLIT_MAP[muscle])
            .filter((value): value is "push" | "pull" | "legs" => Boolean(value))
        ),
      ];

      if (primarySplits.length > 0 && !primarySplits.includes(exercise.splitTag as "push" | "pull" | "legs")) {
        flags.push(`split_vs_primary_mismatch:${primarySplits.join("|")}`);
      }
    }

    const repMin = exercise.repRangeRecommendation?.min ?? null;
    const repMax = exercise.repRangeRecommendation?.max ?? null;
    if (repMin != null && repMax != null && repMin > repMax) {
      flags.push("invalid_rep_range");
    }

    const exerciseId = exercise.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");

    const resolvedStimulusProfile = (
      stimulus.resolveStimulusProfile(
        {
          id: exerciseId,
          name: exercise.name,
          primaryMuscles: exercise.primaryMuscles,
          secondaryMuscles: exercise.secondaryMuscles,
          stimulusProfile: undefined,
        },
        { logFallback: false }
      ) ?? {}
    );

    const resolvedProfileSummary = Object.entries(resolvedStimulusProfile)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([muscle, weight]) => `${muscle}:${weight}`)
      .join("|");

    rows.push({
      name: exercise.name,
      splitTag: exercise.splitTag,
      movementPatterns: (exercise.movementPatterns ?? []).join("|"),
      isCompound: Boolean(exercise.isCompound),
      isMainLiftEligible: Boolean(exercise.isMainLiftEligible),
      jointStress: exercise.jointStress,
      equipment: (exercise.equipment ?? []).join("|"),
      fatigueCost: exercise.fatigueCost,
      sfrScore: exercise.sfrScore,
      lengthPositionScore: exercise.lengthPositionScore,
      stimulusBias: (exercise.stimulusBias ?? []).join("|"),
      primaryMuscles: (exercise.primaryMuscles ?? []).join("|"),
      secondaryMuscles: (exercise.secondaryMuscles ?? []).join("|"),
      difficulty: exercise.difficulty ?? "beginner",
      unilateral: Boolean(exercise.unilateral),
      repMin,
      repMax,
      explicitStimulusProfile: Boolean(
        stimulus.hasExplicitStimulusProfile({
          id: exerciseId,
          name: exercise.name,
          primaryMuscles: exercise.primaryMuscles,
          secondaryMuscles: exercise.secondaryMuscles,
          stimulusProfile: undefined,
        })
      ),
      resolvedStimulusProfile: resolvedProfileSummary,
      flags: flags.join("|"),
    });

    if (flags.length > 0) {
      flagged.push({ name: exercise.name, flags });
    }
  }

  rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  flagged.sort((a, b) => a.name.localeCompare(b.name));

  const summary = {
    generatedAt: new Date().toISOString(),
    exerciseCount: exercises.length,
    classificationCounts: counts,
    flaggedCount: flagged.length,
    flagged,
    explicitStimulusProfileCount: rows.filter((row) => row.explicitStimulusProfile === true).length,
    fallbackStimulusProfileCount: rows.filter((row) => row.explicitStimulusProfile !== true).length,
  };

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(outputDir, `${stamp}-exercise-classification-audit.json`);
  const csvPath = path.join(outputDir, `${stamp}-exercise-classification-audit.csv`);

  fs.writeFileSync(jsonPath, JSON.stringify({ summary, rows }, null, 2));

  const headers = Object.keys(rows[0] ?? {});
  const csvLines = [headers.join(",")];
  for (const row of rows) {
    csvLines.push(headers.map((header) => csvEscape(row[header])).join(","));
  }
  fs.writeFileSync(csvPath, csvLines.join("\n"));

  console.log(jsonPath);
  console.log(csvPath);
  console.log(
    `rows=${rows.length} flagged=${flagged.length} explicit=${summary.explicitStimulusProfileCount} fallback=${summary.fallbackStimulusProfileCount}`
  );
}

main();
