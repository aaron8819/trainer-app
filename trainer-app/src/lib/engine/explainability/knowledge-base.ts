/**
 * Knowledge Base - Research Citations Database
 *
 * Phase 4.1: Core evidence-based citations for exercise selection
 *
 * Source: docs/knowledgebase/hypertrophyandstrengthtraining_researchreport.md
 *
 * Citations are organized by topic and used to provide research-backed
 * rationale for exercise selection and programming decisions.
 */

import type { Citation } from "./types";

/**
 * Citation database
 *
 * Organized by topic for efficient matching
 */
export const KB_CITATIONS = {
  /**
   * Lengthened-position training advantage
   */
  lengthened: {
    maeo_2023_overhead_triceps: {
      id: "maeo_2023_overhead_triceps",
      authors: "Maeo et al.",
      year: 2023,
      title: "Triceps brachii hypertrophy is substantially greater after elbow extension training performed in the overhead versus neutral arm position",
      finding: "Overhead extensions produced ~40% more total triceps growth than pushdowns over 12 weeks",
      relevance: "Supports prioritizing overhead triceps extensions for lengthened-position loading",
      url: undefined,
    } as Citation,

    pedrosa_2022_leg_extension: {
      id: "pedrosa_2022_leg_extension",
      authors: "Pedrosa et al.",
      year: 2022,
      title: "Partial range of motion training elicits favorable improvements in muscular adaptations when carried out at long muscle lengths",
      finding: "Lengthened partial leg extensions produced ~2× quad hypertrophy vs shortened partials",
      relevance: "Supports exercises that load quads at long muscle lengths (deep squats, leg press)",
      url: undefined,
    } as Citation,

    wolf_2023_lengthened_meta: {
      id: "wolf_2023_lengthened_meta",
      authors: "Wolf et al.",
      year: 2023,
      title: "Lengthened partial range of motion resistance training: A systematic review and meta-analysis",
      finding: "Lengthened partials trend toward superior hypertrophy vs full ROM (SME = −0.28)",
      relevance: "Meta-analytic support for prioritizing exercises with deep stretch under load",
      url: undefined,
    } as Citation,

    pedrosa_2023_incline_curls: {
      id: "pedrosa_2023_incline_curls",
      authors: "Pedrosa et al.",
      year: 2023,
      title: "Training in the initial range of motion promotes greater muscle adaptations than at final in the arm curl",
      finding: "Incline dumbbell curls (lengthened ROM) produced greater biceps hypertrophy",
      relevance: "Supports incline curls at 45° for lengthened-position bicep training",
      url: undefined,
    } as Citation,

    kassiano_2023_calf_lengthened: {
      id: "kassiano_2023_calf_lengthened",
      authors: "Kassiano et al.",
      year: 2023,
      title: "Greater gastrocnemius muscle hypertrophy with lengthened versus shortened partial range of motion resistance training",
      finding: "Lengthened partial calf raises produced 15.2% growth vs 3.4% shortened partials",
      relevance: "Strongest evidence for lengthened-position training; emphasizes deep dorsiflexion stretch",
      url: undefined,
    } as Citation,

    maeo_2021_seated_curls: {
      id: "maeo_2021_seated_curls",
      authors: "Maeo et al.",
      year: 2021,
      title: "Greater hamstrings muscle hypertrophy but similar damage protection after training at long versus short muscle lengths",
      finding: "Seated leg curls (hip flexed) produced significantly greater hamstring hypertrophy than prone curls",
      relevance: "Supports seated leg curls for loading hamstrings at longer muscle length",
      url: undefined,
    } as Citation,

    kinoshita_2023_standing_calves: {
      id: "kinoshita_2023_standing_calves",
      authors: "Kinoshita/Maeo et al.",
      year: 2023,
      title: "Comparison of muscle hypertrophy following standing and seated calf raises",
      finding: "Standing calf raises produced greater gastrocnemius hypertrophy than seated",
      relevance: "Knee-extended position stretches the biarticular gastrocnemius; seated targets soleus",
      url: undefined,
    } as Citation,
  },

  /**
   * Volume dose-response
   */
  volume: {
    schoenfeld_2017_volume_dose: {
      id: "schoenfeld_2017_volume_dose",
      authors: "Schoenfeld, Ogborn & Krieger",
      year: 2017,
      title: "Dose-response relationship between weekly resistance training volume and increases in muscle mass",
      finding: "Each additional weekly set increases hypertrophy by ~0.37% (ES increase of 0.023/set)",
      relevance: "Foundational evidence for volume progression strategy",
      url: undefined,
    } as Citation,

    pelland_2024_volume_bayesian: {
      id: "pelland_2024_volume_bayesian",
      authors: "Pelland et al.",
      year: 2024,
      title: "Volume and strength training: A Bayesian meta-analysis",
      finding: "100% posterior probability that volume increases hypertrophy, with diminishing returns",
      relevance: "Confirms volume dose-response with clear diminishing returns beyond ~20 sets/week",
      url: undefined,
    } as Citation,
  },

  /**
   * Proximity to failure
   */
  rir: {
    robinson_2024_proximity_failure: {
      id: "robinson_2024_proximity_failure",
      authors: "Robinson et al.",
      year: 2024,
      title: "Proximity-to-failure and resistance training outcomes: A meta-regression",
      finding: "Hypertrophy significantly increases as sets approach failure (clear dose-response)",
      relevance: "Supports RIR progression from 3-4 to 0-1 across mesocycle",
      url: undefined,
    } as Citation,

    refalo_2023_failure_vs_reserve: {
      id: "refalo_2023_failure_vs_reserve",
      authors: "Refalo et al.",
      year: 2023,
      title: "The effects of resistance training performed to repetition failure on muscular strength",
      finding: "Only trivial advantage (ES=0.19) for failure training vs reserve",
      relevance: "Supports leaving 1-2 RIR on most sets to preserve set quality",
      url: undefined,
    } as Citation,

    refalo_2024_rir_quad: {
      id: "refalo_2024_rir_quad",
      authors: "Refalo et al.",
      year: 2024,
      title: "Similar muscle hypertrophy following eight weeks of resistance training to volitional failure or leaving two repetitions in reserve",
      finding: "0 RIR and 1-2 RIR produced similar quadriceps hypertrophy over 8 weeks",
      relevance: "Confirms 1-2 RIR is sufficient for hypertrophy while reducing fatigue",
      url: undefined,
    } as Citation,
  },

  /**
   * Rest periods
   */
  rest: {
    schoenfeld_2016_rest_periods: {
      id: "schoenfeld_2016_rest_periods",
      authors: "Schoenfeld et al.",
      year: 2016,
      title: "Longer interset rest periods enhance muscle strength and hypertrophy in resistance-trained men",
      finding: "3-minute rest produced significantly greater strength and hypertrophy than 1-minute rest",
      relevance: "Supports 2-3 min rest for compounds, 1-2 min for isolation",
      url: undefined,
    } as Citation,
  },

  /**
   * Periodization
   */
  periodization: {
    rhea_2004_periodization: {
      id: "rhea_2004_periodization",
      authors: "Rhea & Alderman",
      year: 2004,
      title: "A meta-analysis of periodized versus nonperiodized strength and power training programs",
      finding: "Periodized training produces superior results to non-periodized (ES = 0.84)",
      relevance: "Foundational support for block periodization approach (accumulation, intensification, realization)",
      url: undefined,
    } as Citation,
  },

  /**
   * Exercise modality
   */
  modality: {
    haugen_2023_free_vs_machine: {
      id: "haugen_2023_free_vs_machine",
      authors: "Haugen et al.",
      year: 2023,
      title: "The effects of free-weight versus machine-based resistance training on muscle mass and strength",
      finding: "No significant hypertrophy difference between free-weight and machine training (n=1,016)",
      relevance: "Supports using a combination of free weights, machines, and cables",
      url: undefined,
    } as Citation,

    plotkin_2023_squat_vs_thrust: {
      id: "plotkin_2023_squat_vs_thrust",
      authors: "Plotkin et al.",
      year: 2023,
      title: "Hip thrust and back squat training elicit similar gluteus muscle hypertrophy and transfer similarly to the deadlift",
      finding: "9 weeks of squats and hip thrusts produced similar upper/mid/lower glute CSA growth",
      relevance: "Landmark finding: EMG doesn't predict growth; deep squats match hip thrusts for glutes",
      url: undefined,
    } as Citation,
  },
};

/**
 * Get citations by exercise name
 *
 * Returns relevant KB citations for an exercise based on its characteristics
 *
 * @param exerciseName - Exercise name
 * @param lengthPositionScore - Length position score (1-5)
 * @returns Relevant citations
 */
export function getCitationsByExercise(
  exerciseName: string,
  lengthPositionScore?: number
): Citation[] {
  const citations: Citation[] = [];
  const normalizedName = exerciseName.toLowerCase();

  // Lengthened-position exercises (score >= 4)
  if (lengthPositionScore !== undefined && lengthPositionScore >= 4) {
    // Triceps overhead
    if (normalizedName.includes("overhead") && (normalizedName.includes("extension") || normalizedName.includes("triceps"))) {
      citations.push(KB_CITATIONS.lengthened.maeo_2023_overhead_triceps);
    }

    // Incline curls
    if (normalizedName.includes("incline") && normalizedName.includes("curl")) {
      citations.push(KB_CITATIONS.lengthened.pedrosa_2023_incline_curls);
    }

    // Leg extension (deep/lengthened)
    if (normalizedName.includes("leg extension") || normalizedName.includes("quad extension")) {
      citations.push(KB_CITATIONS.lengthened.pedrosa_2022_leg_extension);
    }

    // Seated leg curls
    if (normalizedName.includes("seated") && normalizedName.includes("curl") && normalizedName.includes("leg")) {
      citations.push(KB_CITATIONS.lengthened.maeo_2021_seated_curls);
    }

    // Calf raises
    if (normalizedName.includes("calf") && normalizedName.includes("raise")) {
      if (normalizedName.includes("standing")) {
        citations.push(KB_CITATIONS.lengthened.kinoshita_2023_standing_calves);
      }
      citations.push(KB_CITATIONS.lengthened.kassiano_2023_calf_lengthened);
    }

    // Deep squats
    if (normalizedName.includes("squat") && !normalizedName.includes("leg")) {
      citations.push(KB_CITATIONS.modality.plotkin_2023_squat_vs_thrust);
    }

    // General lengthened-position meta-analysis (fallback)
    if (citations.length === 0) {
      citations.push(KB_CITATIONS.lengthened.wolf_2023_lengthened_meta);
    }
  }

  return citations;
}

/**
 * Get citations by topic
 *
 * @param topic - Citation topic
 * @returns All citations for topic
 */
export function getCitationsByTopic(
  topic: "lengthened" | "volume" | "rir" | "rest" | "periodization" | "modality"
): Citation[] {
  return Object.values(KB_CITATIONS[topic]);
}

/**
 * Get citation by ID
 *
 * @param id - Citation ID
 * @returns Citation or undefined
 */
export function getCitationById(id: string): Citation | undefined {
  for (const topic of Object.values(KB_CITATIONS)) {
    for (const citation of Object.values(topic)) {
      if (citation.id === id) {
        return citation;
      }
    }
  }
  return undefined;
}
