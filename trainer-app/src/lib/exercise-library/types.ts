import type {
  Difficulty,
  EquipmentType,
  JointStress,
  MovementPatternV2,
  SplitTag,
  StimulusBias,
} from "@/lib/engine/types";

export type MuscleGroup = "chest" | "back" | "shoulders" | "arms" | "legs" | "core";

export type ExerciseListItem = {
  id: string;
  name: string;
  isCompound: boolean;
  isMainLiftEligible?: boolean;
  movementPatterns: MovementPatternV2[];
  splitTags: SplitTag[];
  jointStress: JointStress;
  equipment: EquipmentType[];
  primaryMuscles: string[];
  secondaryMuscles: string[];
  fatigueCost: number;
  sfrScore: number;
  lengthPositionScore: number;
  difficulty?: Difficulty;
  isUnilateral?: boolean;
  isFavorite: boolean;
  isAvoided: boolean;
};

export type ExerciseDetail = ExerciseListItem & {
  isMainLiftEligible: boolean;
  stimulusBias: StimulusBias[];
  contraindications?: Record<string, unknown>;
  timePerSetSec: number;
  repRangeMin?: number;
  repRangeMax?: number;
  aliases: string[];
  variations: { id: string; name: string; description?: string }[];
  substitutes: { id: string; name: string; primaryMuscles: string[] }[];
  baseline?: {
    id: string;
    context: string;
    workingWeightMin?: number;
    workingWeightMax?: number;
    workingRepsMin?: number;
    workingRepsMax?: number;
    topSetWeight?: number;
    topSetReps?: number;
    notes?: string;
  };
};

export type SortField = "name" | "fatigueCost" | "sfrScore" | "lengthPositionScore" | "muscleGroup";
export type SortDirection = "asc" | "desc";
export type ExerciseTypeFilter = "compound" | "isolation";

export type ExerciseFilters = {
  search?: string;
  muscleGroups?: MuscleGroup[];
  muscles?: string[];
  exerciseTypes?: ExerciseTypeFilter[];
  movementPatterns?: MovementPatternV2[];
  equipment?: EquipmentType;
  splitTag?: SplitTag;
  favoritesOnly?: boolean;
};

export type ExerciseSort = {
  field: SortField;
  direction: SortDirection;
};
