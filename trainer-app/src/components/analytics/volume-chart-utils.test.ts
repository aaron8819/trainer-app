import { describe, expect, it } from "vitest";
import {
  buildMuscleVolumeChartData,
  groupMusclesForVolumeSelector,
  shouldShowVolumeLandmarks,
  type WeeklyVolumePoint,
} from "./volume-chart-utils";

describe("volume chart helpers", () => {
  const weeklyVolume: WeeklyVolumePoint[] = [
    {
      weekStart: "2026-02-16",
      muscles: {
        Chest: { directSets: 8, indirectSets: 2, effectiveSets: 9.2 },
        Biceps: { directSets: 4, indirectSets: 2, effectiveSets: 4.6 },
      },
    },
    {
      weekStart: "2026-02-23",
      muscles: {
        Chest: { directSets: 6, indirectSets: 3, effectiveSets: 7.1 },
        Biceps: { directSets: 3, indirectSets: 3, effectiveSets: 3.9 },
      },
    },
    {
      weekStart: "2026-03-02",
      muscles: {
        Chest: { directSets: 10, indirectSets: 1, effectiveSets: 10.5 },
      },
    },
  ];

  it("switches primary values by chart mode and preserves a rolling average", () => {
    const effective = buildMuscleVolumeChartData(weeklyVolume, "Chest", "effective");
    const combined = buildMuscleVolumeChartData(weeklyVolume, "Chest", "combined");
    const direct = buildMuscleVolumeChartData(weeklyVolume, "Chest", "direct");

    expect(effective[2]).toMatchObject({
      effective: 10.5,
      primaryValue: 10.5,
      rollingAverage: 8.9,
    });
    expect(combined[2]).toMatchObject({
      combined: 11,
      primaryValue: 11,
      rollingAverage: 10,
    });
    expect(direct[2]).toMatchObject({
      direct: 10,
      primaryValue: 10,
      rollingAverage: 8,
    });
    expect(shouldShowVolumeLandmarks("effective")).toBe(true);
    expect(shouldShowVolumeLandmarks("combined")).toBe(false);
  });

  it("groups muscles into push, pull, and legs selector sections", () => {
    expect(
      groupMusclesForVolumeSelector(["Hamstrings", "Chest", "Biceps", "Quads"])
    ).toEqual([
      { label: "Push", muscles: ["Chest"] },
      { label: "Pull", muscles: ["Biceps"] },
      { label: "Legs", muscles: ["Hamstrings", "Quads"] },
    ]);
  });
});
