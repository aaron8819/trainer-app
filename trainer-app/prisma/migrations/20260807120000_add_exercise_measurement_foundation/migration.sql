CREATE TYPE "MeasurementProfile" AS ENUM (
  'REPS_EXTERNAL_LOAD',
  'REPS_BODYWEIGHT',
  'REPS_BODYWEIGHT_PLUS_LOAD',
  'REPS_ASSISTED'
);

CREATE TYPE "LoadConvention" AS ENUM (
  'BARBELL_TOTAL',
  'IMPLEMENT_WEIGHT',
  'MACHINE_DISPLAYED',
  'ADDED_EXTERNAL_LOAD',
  'DISPLAYED_ASSISTANCE'
);

CREATE TYPE "RepBasis" AS ENUM ('TOTAL', 'PER_SIDE');

ALTER TABLE "Exercise"
  ADD COLUMN "measurementProfile" "MeasurementProfile",
  ADD COLUMN "loadConvention" "LoadConvention",
  ADD COLUMN "repBasis" "RepBasis";

ALTER TABLE "WorkoutExercise"
  ADD COLUMN "measurementProfile" "MeasurementProfile",
  ADD COLUMN "loadConvention" "LoadConvention",
  ADD COLUMN "repBasis" "RepBasis";

ALTER TABLE "Exercise"
  ADD CONSTRAINT "Exercise_measurement_tuple_check" CHECK (
    ("measurementProfile" IS NULL AND "loadConvention" IS NULL AND "repBasis" IS NULL)
    OR
    (
      "measurementProfile" IS NOT NULL
      AND "repBasis" IS NOT NULL
      AND (
        ("measurementProfile" = 'REPS_BODYWEIGHT' AND "loadConvention" IS NULL)
        OR
        (
          "measurementProfile" = 'REPS_EXTERNAL_LOAD'
          AND "loadConvention" IS NOT NULL
          AND "loadConvention" IN ('BARBELL_TOTAL', 'IMPLEMENT_WEIGHT', 'MACHINE_DISPLAYED')
        )
        OR
        (
          "measurementProfile" = 'REPS_BODYWEIGHT_PLUS_LOAD'
          AND "loadConvention" IS NOT NULL
          AND "loadConvention" = 'ADDED_EXTERNAL_LOAD'
        )
        OR
        (
          "measurementProfile" = 'REPS_ASSISTED'
          AND "loadConvention" IS NOT NULL
          AND "loadConvention" = 'DISPLAYED_ASSISTANCE'
        )
      )
    )
  );

ALTER TABLE "WorkoutExercise"
  ADD CONSTRAINT "WorkoutExercise_measurement_tuple_check" CHECK (
    ("measurementProfile" IS NULL AND "loadConvention" IS NULL AND "repBasis" IS NULL)
    OR
    (
      "measurementProfile" IS NOT NULL
      AND "repBasis" IS NOT NULL
      AND (
        ("measurementProfile" = 'REPS_BODYWEIGHT' AND "loadConvention" IS NULL)
        OR
        (
          "measurementProfile" = 'REPS_EXTERNAL_LOAD'
          AND "loadConvention" IS NOT NULL
          AND "loadConvention" IN ('BARBELL_TOTAL', 'IMPLEMENT_WEIGHT', 'MACHINE_DISPLAYED')
        )
        OR
        (
          "measurementProfile" = 'REPS_BODYWEIGHT_PLUS_LOAD'
          AND "loadConvention" IS NOT NULL
          AND "loadConvention" = 'ADDED_EXTERNAL_LOAD'
        )
        OR
        (
          "measurementProfile" = 'REPS_ASSISTED'
          AND "loadConvention" IS NOT NULL
          AND "loadConvention" = 'DISPLAYED_ASSISTANCE'
        )
      )
    )
  );
