/**
 * Explainability Utilities Tests
 *
 * Phase 4.1: Test formatting and helper functions
 */

import { describe, it, expect } from "vitest";
import {
  formatBlockPhase,
  formatVolumeStatus,
  formatReadinessLevel,
  formatCitation,
  formatCitationWithLink,
  formatPercentage,
  formatScoreTier,
  formatWeekInMesocycle,
  formatProgressionType,
  formatRestPeriod,
  pluralize,
  formatLoadChange,
} from "./utils";
import type { Citation } from "./types";

describe("formatBlockPhase", () => {
  it("formats accumulation", () => {
    expect(formatBlockPhase("accumulation")).toBe("Accumulation");
  });

  it("formats intensification", () => {
    expect(formatBlockPhase("intensification")).toBe("Intensification");
  });

  it("formats realization", () => {
    expect(formatBlockPhase("realization")).toBe("Realization");
  });

  it("formats deload", () => {
    expect(formatBlockPhase("deload")).toBe("Deload");
  });
});

describe("formatVolumeStatus", () => {
  it("formats below_mev", () => {
    expect(formatVolumeStatus("below_mev")).toBe("Below minimum effective volume");
  });

  it("formats at_mev", () => {
    expect(formatVolumeStatus("at_mev")).toBe("At minimum effective volume");
  });

  it("formats optimal", () => {
    expect(formatVolumeStatus("optimal")).toBe("In optimal volume range");
  });

  it("formats approaching_mrv", () => {
    expect(formatVolumeStatus("approaching_mrv")).toBe("Approaching maximum recoverable volume");
  });

  it("formats at_mrv", () => {
    expect(formatVolumeStatus("at_mrv")).toBe("At maximum recoverable volume");
  });
});

describe("formatReadinessLevel", () => {
  it("formats fresh", () => {
    expect(formatReadinessLevel("fresh")).toBe("Well-recovered");
  });

  it("formats moderate", () => {
    expect(formatReadinessLevel("moderate")).toBe("Moderately recovered");
  });

  it("formats fatigued", () => {
    expect(formatReadinessLevel("fatigued")).toBe("Elevated fatigue");
  });
});

describe("formatCitation", () => {
  it("formats citation without URL", () => {
    const citation: Citation = {
      id: "test_2023",
      authors: "Test et al.",
      year: 2023,
      title: "Test Study",
      finding: "Test finding",
      relevance: "Test relevance",
    };
    expect(formatCitation(citation)).toBe("Test et al. (2023): Test finding");
  });

  it("formats real Maeo citation", () => {
    const citation: Citation = {
      id: "maeo_2023",
      authors: "Maeo et al.",
      year: 2023,
      title: "Overhead triceps study",
      finding: "Overhead extensions produced ~40% more growth",
      relevance: "Lengthened position",
    };
    expect(formatCitation(citation)).toBe("Maeo et al. (2023): Overhead extensions produced ~40% more growth");
  });
});

describe("formatCitationWithLink", () => {
  it("formats citation without URL", () => {
    const citation: Citation = {
      id: "test_2023",
      authors: "Test et al.",
      year: 2023,
      title: "Test Study",
      finding: "Test finding",
      relevance: "Test relevance",
    };
    expect(formatCitationWithLink(citation)).toBe("Test et al. 2023: Test finding");
  });

  it("formats citation with URL as markdown link", () => {
    const citation: Citation = {
      id: "test_2023",
      authors: "Test et al.",
      year: 2023,
      title: "Test Study",
      finding: "Test finding",
      relevance: "Test relevance",
      url: "https://example.com/study",
    };
    expect(formatCitationWithLink(citation)).toBe("[Test et al. 2023](https://example.com/study): Test finding");
  });
});

describe("formatPercentage", () => {
  it("formats whole percentages", () => {
    expect(formatPercentage(0.5)).toBe("50%");
    expect(formatPercentage(1.0)).toBe("100%");
    expect(formatPercentage(0.0)).toBe("0%");
  });

  it("rounds to nearest integer", () => {
    expect(formatPercentage(0.67)).toBe("67%");
    expect(formatPercentage(0.674)).toBe("67%");
    expect(formatPercentage(0.675)).toBe("68%");
  });

  it("handles edge cases", () => {
    expect(formatPercentage(0.999)).toBe("100%");
    expect(formatPercentage(0.001)).toBe("0%");
  });
});

describe("formatScoreTier", () => {
  it("returns low for scores < 0.33", () => {
    expect(formatScoreTier(0.0)).toBe("low");
    expect(formatScoreTier(0.1)).toBe("low");
    expect(formatScoreTier(0.32)).toBe("low");
  });

  it("returns medium for scores 0.33-0.67", () => {
    expect(formatScoreTier(0.33)).toBe("medium");
    expect(formatScoreTier(0.5)).toBe("medium");
    expect(formatScoreTier(0.66)).toBe("medium");
  });

  it("returns high for scores >= 0.67", () => {
    expect(formatScoreTier(0.67)).toBe("high");
    expect(formatScoreTier(0.8)).toBe("high");
    expect(formatScoreTier(1.0)).toBe("high");
  });
});

describe("formatWeekInMesocycle", () => {
  it("formats week in mesocycle", () => {
    expect(formatWeekInMesocycle(1, 4)).toBe("Week 1 of 4");
    expect(formatWeekInMesocycle(2, 6)).toBe("Week 2 of 6");
    expect(formatWeekInMesocycle(5, 5)).toBe("Week 5 of 5");
  });
});

describe("formatProgressionType", () => {
  it("formats linear", () => {
    expect(formatProgressionType("linear")).toBe("Linear progression");
  });

  it("formats double", () => {
    expect(formatProgressionType("double")).toBe("Double progression");
  });

  it("formats autoregulated", () => {
    expect(formatProgressionType("autoregulated")).toBe("Autoregulated");
  });
});

describe("formatRestPeriod", () => {
  it("formats whole minutes", () => {
    expect(formatRestPeriod(60)).toBe("1 min");
    expect(formatRestPeriod(120)).toBe("2 min");
    expect(formatRestPeriod(180)).toBe("3 min");
  });

  it("formats fractional minutes", () => {
    expect(formatRestPeriod(90)).toBe("1.5 min");
    expect(formatRestPeriod(150)).toBe("2.5 min");
    expect(formatRestPeriod(45)).toBe("0.8 min");
  });
});

describe("pluralize", () => {
  it("uses singular for count=1", () => {
    expect(pluralize(1, "set")).toBe("1 set");
    expect(pluralize(1, "rep")).toBe("1 rep");
  });

  it("uses plural for count≠1", () => {
    expect(pluralize(0, "set")).toBe("0 sets");
    expect(pluralize(2, "set")).toBe("2 sets");
    expect(pluralize(10, "rep")).toBe("10 reps");
  });

  it("uses custom plural form when provided", () => {
    expect(pluralize(1, "exercise", "exercises")).toBe("1 exercise");
    expect(pluralize(3, "exercise", "exercises")).toBe("3 exercises");
  });

  it("handles irregular plurals", () => {
    expect(pluralize(1, "analysis", "analyses")).toBe("1 analysis");
    expect(pluralize(5, "analysis", "analyses")).toBe("5 analyses");
  });
});

describe("formatLoadChange", () => {
  it("formats positive load change", () => {
    expect(formatLoadChange(70, 72.5)).toBe("+3.6%");
    expect(formatLoadChange(100, 105)).toBe("+5.0%");
  });

  it("formats negative load change", () => {
    expect(formatLoadChange(80, 75)).toBe("-6.3%"); // (75-80)/80 = -6.25% rounds to -6.3%
    expect(formatLoadChange(100, 90)).toBe("-10.0%");
  });

  it("formats zero change", () => {
    expect(formatLoadChange(70, 70)).toBe("+0.0%");
  });

  it("rounds to 1 decimal place", () => {
    expect(formatLoadChange(70, 72.4)).toBe("+3.4%");
    expect(formatLoadChange(70, 72.6)).toBe("+3.7%");
  });
});
