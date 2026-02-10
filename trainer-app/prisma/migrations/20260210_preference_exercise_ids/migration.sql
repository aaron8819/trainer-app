ALTER TABLE "UserPreference"
ADD COLUMN "favoriteExerciseIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "UserPreference"
ADD COLUMN "avoidExerciseIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
