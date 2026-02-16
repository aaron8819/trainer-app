/**
 * Knowledge Base Tests
 *
 * Phase 4.1: Test citation retrieval and matching
 */

import { describe, it, expect } from "vitest";
import {
  KB_CITATIONS,
  getCitationsByExercise,
  getCitationsByTopic,
  getCitationById,
} from "./knowledge-base";

describe("KB_CITATIONS", () => {
  it("has lengthened-position citations", () => {
    expect(KB_CITATIONS.lengthened).toBeDefined();
    expect(KB_CITATIONS.lengthened.maeo_2023_overhead_triceps).toBeDefined();
    expect(KB_CITATIONS.lengthened.pedrosa_2022_leg_extension).toBeDefined();
  });

  it("has volume citations", () => {
    expect(KB_CITATIONS.volume).toBeDefined();
    expect(KB_CITATIONS.volume.schoenfeld_2017_volume_dose).toBeDefined();
  });

  it("has RIR citations", () => {
    expect(KB_CITATIONS.rir).toBeDefined();
    expect(KB_CITATIONS.rir.robinson_2024_proximity_failure).toBeDefined();
  });

  it("all citations have required fields", () => {
    for (const topic of Object.values(KB_CITATIONS)) {
      for (const citation of Object.values(topic)) {
        expect(citation.id).toBeDefined();
        expect(citation.authors).toBeDefined();
        expect(citation.year).toBeGreaterThan(1990);
        expect(citation.title).toBeDefined();
        expect(citation.finding).toBeDefined();
        expect(citation.relevance).toBeDefined();
      }
    }
  });
});

describe("getCitationsByExercise", () => {
  it("returns overhead triceps citation for overhead extensions", () => {
    const citations = getCitationsByExercise("Overhead Triceps Extension", 5);
    expect(citations.length).toBeGreaterThan(0);
    expect(citations.some((c) => c.id === "maeo_2023_overhead_triceps")).toBe(true);
  });

  it("returns incline curl citation for incline dumbbell curls", () => {
    const citations = getCitationsByExercise("Incline Dumbbell Curl", 5);
    expect(citations.length).toBeGreaterThan(0);
    expect(citations.some((c) => c.id === "pedrosa_2023_incline_curls")).toBe(true);
  });

  it("returns leg extension citation for quad extensions", () => {
    const citations = getCitationsByExercise("Leg Extension", 4);
    expect(citations.length).toBeGreaterThan(0);
    expect(citations.some((c) => c.id === "pedrosa_2022_leg_extension")).toBe(true);
  });

  it("returns seated leg curl citation for seated hamstring curls", () => {
    const citations = getCitationsByExercise("Seated Leg Curl", 5);
    expect(citations.length).toBeGreaterThan(0);
    expect(citations.some((c) => c.id === "maeo_2021_seated_curls")).toBe(true);
  });

  it("returns calf citations for standing calf raises", () => {
    const citations = getCitationsByExercise("Standing Calf Raise", 5);
    expect(citations.length).toBeGreaterThan(0);
    expect(
      citations.some((c) => c.id === "kinoshita_2023_standing_calves" || c.id === "kassiano_2023_calf_lengthened")
    ).toBe(true);
  });

  it("returns squat citation for deep squats", () => {
    const citations = getCitationsByExercise("Back Squat", 4);
    expect(citations.length).toBeGreaterThan(0);
    expect(citations.some((c) => c.id === "plotkin_2023_squat_vs_thrust")).toBe(true);
  });

  it("returns general lengthened citation as fallback for high lengthPositionScore", () => {
    const citations = getCitationsByExercise("Some Lengthened Exercise", 5);
    expect(citations.length).toBeGreaterThan(0);
    expect(citations.some((c) => c.id === "wolf_2023_lengthened_meta")).toBe(true);
  });

  it("returns empty array for low lengthPositionScore", () => {
    const citations = getCitationsByExercise("Bench Press", 2);
    expect(citations).toEqual([]);
  });

  it("returns empty array when lengthPositionScore is undefined", () => {
    const citations = getCitationsByExercise("Bench Press", undefined);
    expect(citations).toEqual([]);
  });

  it("handles case-insensitive matching", () => {
    const citations1 = getCitationsByExercise("OVERHEAD TRICEPS EXTENSION", 5);
    const citations2 = getCitationsByExercise("overhead triceps extension", 5);
    expect(citations1.length).toBe(citations2.length);
  });
});

describe("getCitationsByTopic", () => {
  it("returns all lengthened citations", () => {
    const citations = getCitationsByTopic("lengthened");
    expect(citations.length).toBeGreaterThan(5);
    expect(citations.some((c) => c.id === "maeo_2023_overhead_triceps")).toBe(true);
    expect(citations.some((c) => c.id === "wolf_2023_lengthened_meta")).toBe(true);
  });

  it("returns all volume citations", () => {
    const citations = getCitationsByTopic("volume");
    expect(citations.length).toBeGreaterThan(0);
    expect(citations.some((c) => c.id === "schoenfeld_2017_volume_dose")).toBe(true);
  });

  it("returns all RIR citations", () => {
    const citations = getCitationsByTopic("rir");
    expect(citations.length).toBeGreaterThan(0);
    expect(citations.some((c) => c.id === "robinson_2024_proximity_failure")).toBe(true);
  });

  it("returns all rest citations", () => {
    const citations = getCitationsByTopic("rest");
    expect(citations.length).toBeGreaterThan(0);
    expect(citations.some((c) => c.id === "schoenfeld_2016_rest_periods")).toBe(true);
  });

  it("returns all periodization citations", () => {
    const citations = getCitationsByTopic("periodization");
    expect(citations.length).toBeGreaterThan(0);
    expect(citations.some((c) => c.id === "rhea_2004_periodization")).toBe(true);
  });

  it("returns all modality citations", () => {
    const citations = getCitationsByTopic("modality");
    expect(citations.length).toBeGreaterThan(0);
    expect(citations.some((c) => c.id === "haugen_2023_free_vs_machine")).toBe(true);
  });
});

describe("getCitationById", () => {
  it("returns citation when found", () => {
    const citation = getCitationById("maeo_2023_overhead_triceps");
    expect(citation).toBeDefined();
    expect(citation?.id).toBe("maeo_2023_overhead_triceps");
    expect(citation?.authors).toBe("Maeo et al.");
  });

  it("returns undefined when not found", () => {
    const citation = getCitationById("nonexistent_citation");
    expect(citation).toBeUndefined();
  });

  it("works for all topics", () => {
    const lengthened = getCitationById("wolf_2023_lengthened_meta");
    expect(lengthened).toBeDefined();

    const volume = getCitationById("schoenfeld_2017_volume_dose");
    expect(volume).toBeDefined();

    const rir = getCitationById("robinson_2024_proximity_failure");
    expect(rir).toBeDefined();

    const rest = getCitationById("schoenfeld_2016_rest_periods");
    expect(rest).toBeDefined();

    const periodization = getCitationById("rhea_2004_periodization");
    expect(periodization).toBeDefined();

    const modality = getCitationById("haugen_2023_free_vs_machine");
    expect(modality).toBeDefined();
  });
});
