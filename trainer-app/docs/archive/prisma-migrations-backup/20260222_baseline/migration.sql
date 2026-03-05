-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TrainingAge" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED');

-- CreateEnum
CREATE TYPE "PrimaryGoal" AS ENUM ('HYPERTROPHY', 'STRENGTH', 'FAT_LOSS', 'ATHLETICISM', 'GENERAL_HEALTH');

-- CreateEnum
CREATE TYPE "SecondaryGoal" AS ENUM ('POSTURE', 'CONDITIONING', 'INJURY_PREVENTION', 'NONE');

-- CreateEnum
CREATE TYPE "SplitType" AS ENUM ('PPL', 'UPPER_LOWER', 'FULL_BODY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "MovementPatternV2" AS ENUM ('HORIZONTAL_PUSH', 'VERTICAL_PUSH', 'HORIZONTAL_PULL', 'VERTICAL_PULL', 'SQUAT', 'HINGE', 'LUNGE', 'CARRY', 'ROTATION', 'ANTI_ROTATION', 'FLEXION', 'EXTENSION', 'ABDUCTION', 'ADDUCTION', 'ISOLATION');

-- CreateEnum
CREATE TYPE "SplitTag" AS ENUM ('PUSH', 'PULL', 'LEGS', 'CORE', 'MOBILITY', 'PREHAB', 'CONDITIONING');

-- CreateEnum
CREATE TYPE "JointStress" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "EquipmentType" AS ENUM ('BARBELL', 'DUMBBELL', 'MACHINE', 'CABLE', 'BODYWEIGHT', 'KETTLEBELL', 'BAND', 'SLED', 'BENCH', 'RACK', 'EZ_BAR', 'TRAP_BAR', 'OTHER');

-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED');

-- CreateEnum
CREATE TYPE "WorkoutStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'PARTIAL', 'COMPLETED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "WorkoutSelectionMode" AS ENUM ('AUTO', 'MANUAL', 'BONUS', 'INTENT');

-- CreateEnum
CREATE TYPE "WorkoutSessionIntent" AS ENUM ('PUSH', 'PULL', 'LEGS', 'UPPER', 'LOWER', 'FULL_BODY', 'BODY_PART');

-- CreateEnum
CREATE TYPE "WorkoutExerciseSection" AS ENUM ('WARMUP', 'MAIN', 'ACCESSORY');

-- CreateEnum
CREATE TYPE "StimulusBias" AS ENUM ('MECHANICAL', 'METABOLIC', 'STRETCH', 'STABILITY');

-- CreateEnum
CREATE TYPE "SplitDay" AS ENUM ('PUSH', 'PULL', 'LEGS', 'UPPER', 'LOWER', 'FULL_BODY');

-- CreateEnum
CREATE TYPE "MuscleRole" AS ENUM ('PRIMARY', 'SECONDARY');

-- CreateEnum
CREATE TYPE "VariationType" AS ENUM ('TEMPO', 'PAUSED', 'SINGLE_ARM', 'SINGLE_LEG', 'GRIP', 'ANGLE', 'RANGE_OF_MOTION', 'OTHER');

-- CreateEnum
CREATE TYPE "TemplateIntent" AS ENUM ('FULL_BODY', 'UPPER_LOWER', 'PUSH_PULL_LEGS', 'BODY_PART', 'CUSTOM');

-- CreateEnum
CREATE TYPE "BlockType" AS ENUM ('ACCUMULATION', 'INTENSIFICATION', 'REALIZATION', 'DELOAD');

-- CreateEnum
CREATE TYPE "VolumeTarget" AS ENUM ('LOW', 'MODERATE', 'HIGH', 'PEAK');

-- CreateEnum
CREATE TYPE "IntensityBias" AS ENUM ('STRENGTH', 'HYPERTROPHY', 'ENDURANCE');

-- CreateEnum
CREATE TYPE "AdaptationType" AS ENUM ('NEURAL_ADAPTATION', 'MYOFIBRILLAR_HYPERTROPHY', 'SARCOPLASMIC_HYPERTROPHY', 'WORK_CAPACITY', 'RECOVERY');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPreference" (
    "userId" TEXT NOT NULL,
    "favoriteExerciseIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "avoidExerciseIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Profile" (
    "userId" TEXT NOT NULL,
    "age" INTEGER,
    "sex" TEXT,
    "heightIn" INTEGER,
    "weightLb" DOUBLE PRECISION,
    "trainingAge" "TrainingAge" NOT NULL DEFAULT 'INTERMEDIATE',

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Constraints" (
    "userId" TEXT NOT NULL,
    "daysPerWeek" INTEGER NOT NULL,
    "splitType" "SplitType" NOT NULL,

    CONSTRAINT "Constraints_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Goals" (
    "userId" TEXT NOT NULL,
    "primaryGoal" "PrimaryGoal" NOT NULL,
    "secondaryGoal" "SecondaryGoal" NOT NULL,

    CONSTRAINT "Goals_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Injury" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bodyPart" TEXT NOT NULL,
    "description" TEXT,
    "severity" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Injury_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Equipment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "EquipmentType" NOT NULL,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Muscle" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mv" INTEGER NOT NULL DEFAULT 0,
    "mev" INTEGER NOT NULL DEFAULT 0,
    "mav" INTEGER NOT NULL DEFAULT 0,
    "mrv" INTEGER NOT NULL DEFAULT 0,
    "sraHours" INTEGER NOT NULL DEFAULT 48,

    CONSTRAINT "Muscle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exercise" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "movementPatterns" "MovementPatternV2"[] DEFAULT ARRAY[]::"MovementPatternV2"[],
    "splitTags" "SplitTag"[] DEFAULT ARRAY[]::"SplitTag"[],
    "jointStress" "JointStress" NOT NULL,
    "isMainLiftEligible" BOOLEAN NOT NULL DEFAULT false,
    "isCompound" BOOLEAN NOT NULL DEFAULT false,
    "fatigueCost" INTEGER NOT NULL DEFAULT 3,
    "stimulusBias" "StimulusBias"[] DEFAULT ARRAY[]::"StimulusBias"[],
    "contraindications" JSONB,
    "timePerSetSec" INTEGER NOT NULL DEFAULT 120,
    "sfrScore" INTEGER NOT NULL DEFAULT 3,
    "lengthPositionScore" INTEGER NOT NULL DEFAULT 3,
    "difficulty" "Difficulty" NOT NULL DEFAULT 'BEGINNER',
    "isUnilateral" BOOLEAN NOT NULL DEFAULT false,
    "repRangeMin" INTEGER NOT NULL DEFAULT 1,
    "repRangeMax" INTEGER NOT NULL DEFAULT 20,

    CONSTRAINT "Exercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExerciseVariation" (
    "id" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "variationType" "VariationType",
    "metadata" JSONB,

    CONSTRAINT "ExerciseVariation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExerciseAlias" (
    "id" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,

    CONSTRAINT "ExerciseAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExerciseMuscle" (
    "exerciseId" TEXT NOT NULL,
    "muscleId" TEXT NOT NULL,
    "role" "MuscleRole" NOT NULL,

    CONSTRAINT "ExerciseMuscle_pkey" PRIMARY KEY ("exerciseId","muscleId")
);

-- CreateTable
CREATE TABLE "ExerciseEquipment" (
    "exerciseId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,

    CONSTRAINT "ExerciseEquipment_pkey" PRIMARY KEY ("exerciseId","equipmentId")
);

-- CreateTable
CREATE TABLE "SubstitutionRule" (
    "id" TEXT NOT NULL,
    "fromExerciseId" TEXT NOT NULL,
    "toExerciseId" TEXT NOT NULL,
    "reason" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 50,
    "constraints" JSONB,
    "preserves" JSONB,

    CONSTRAINT "SubstitutionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workout" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "templateId" TEXT,
    "scheduledDate" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "status" "WorkoutStatus" NOT NULL DEFAULT 'PLANNED',
    "estimatedMinutes" INTEGER,
    "notes" TEXT,
    "selectionMode" "WorkoutSelectionMode" NOT NULL DEFAULT 'AUTO',
    "sessionIntent" "WorkoutSessionIntent",
    "selectionMetadata" JSONB,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "forcedSplit" "SplitDay",
    "advancesSplit" BOOLEAN NOT NULL DEFAULT true,
    "trainingBlockId" TEXT,
    "weekInBlock" INTEGER,
    "wasAutoregulated" BOOLEAN NOT NULL DEFAULT false,
    "autoregulationLog" JSONB,

    CONSTRAINT "Workout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutExercise" (
    "id" TEXT NOT NULL,
    "workoutId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "section" "WorkoutExerciseSection",
    "isMainLift" BOOLEAN NOT NULL,
    "movementPatterns" "MovementPatternV2"[] DEFAULT ARRAY[]::"MovementPatternV2"[],
    "notes" TEXT,

    CONSTRAINT "WorkoutExercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutSet" (
    "id" TEXT NOT NULL,
    "workoutExerciseId" TEXT NOT NULL,
    "setIndex" INTEGER NOT NULL,
    "targetReps" INTEGER NOT NULL,
    "targetRepMin" INTEGER,
    "targetRepMax" INTEGER,
    "targetRpe" DOUBLE PRECISION,
    "targetLoad" DOUBLE PRECISION,
    "restSeconds" INTEGER,

    CONSTRAINT "WorkoutSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FilteredExercise" (
    "id" TEXT NOT NULL,
    "workoutId" TEXT NOT NULL,
    "exerciseId" TEXT,
    "exerciseName" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "userFriendlyMessage" TEXT NOT NULL,

    CONSTRAINT "FilteredExercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetLog" (
    "id" TEXT NOT NULL,
    "workoutSetId" TEXT NOT NULL,
    "actualReps" INTEGER,
    "actualRpe" DOUBLE PRECISION,
    "actualLoad" DOUBLE PRECISION,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "wasSkipped" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SetLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionCheckIn" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workoutId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "readiness" INTEGER NOT NULL,
    "painFlags" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionCheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReadinessSignal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "whoopRecovery" DOUBLE PRECISION,
    "whoopStrain" DOUBLE PRECISION,
    "whoopHrv" DOUBLE PRECISION,
    "whoopSleepQuality" DOUBLE PRECISION,
    "whoopSleepHours" DOUBLE PRECISION,
    "subjectiveReadiness" INTEGER NOT NULL,
    "subjectiveMotivation" INTEGER NOT NULL,
    "subjectiveSoreness" JSONB NOT NULL,
    "subjectiveStress" INTEGER,
    "performanceRpeDeviation" DOUBLE PRECISION NOT NULL,
    "performanceStalls" INTEGER NOT NULL,
    "performanceCompliance" DOUBLE PRECISION NOT NULL,
    "fatigueScoreOverall" DOUBLE PRECISION NOT NULL,
    "fatigueScoreBreakdown" JSONB NOT NULL,

    CONSTRAINT "ReadinessSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserIntegration" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutTemplate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetMuscles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isStrict" BOOLEAN NOT NULL DEFAULT false,
    "intent" "TemplateIntent" NOT NULL DEFAULT 'CUSTOM',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkoutTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutTemplateExercise" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "supersetGroup" INTEGER,

    CONSTRAINT "WorkoutTemplateExercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MacroCycle" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "durationWeeks" INTEGER NOT NULL,
    "trainingAge" "TrainingAge" NOT NULL,
    "primaryGoal" "PrimaryGoal" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MacroCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mesocycle" (
    "id" TEXT NOT NULL,
    "macroCycleId" TEXT NOT NULL,
    "mesoNumber" INTEGER NOT NULL,
    "startWeek" INTEGER NOT NULL,
    "durationWeeks" INTEGER NOT NULL,
    "focus" TEXT NOT NULL,
    "volumeTarget" "VolumeTarget" NOT NULL,
    "intensityBias" "IntensityBias" NOT NULL,
    "completedSessions" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Mesocycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingBlock" (
    "id" TEXT NOT NULL,
    "mesocycleId" TEXT NOT NULL,
    "blockNumber" INTEGER NOT NULL,
    "blockType" "BlockType" NOT NULL,
    "startWeek" INTEGER NOT NULL,
    "durationWeeks" INTEGER NOT NULL,
    "volumeTarget" "VolumeTarget" NOT NULL,
    "intensityBias" "IntensityBias" NOT NULL,
    "adaptationType" "AdaptationType" NOT NULL,

    CONSTRAINT "TrainingBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExerciseExposure" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "exerciseName" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3) NOT NULL,
    "timesUsedL4W" INTEGER NOT NULL DEFAULT 0,
    "timesUsedL8W" INTEGER NOT NULL DEFAULT 0,
    "timesUsedL12W" INTEGER NOT NULL DEFAULT 0,
    "avgSetsPerWeek" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgVolumePerWeek" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExerciseExposure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Injury_userId_isActive_idx" ON "Injury"("userId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Equipment_name_key" ON "Equipment"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Muscle_name_key" ON "Muscle"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Exercise_name_key" ON "Exercise"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ExerciseAlias_alias_key" ON "ExerciseAlias"("alias");

-- CreateIndex
CREATE INDEX "ExerciseMuscle_muscleId_idx" ON "ExerciseMuscle"("muscleId");

-- CreateIndex
CREATE INDEX "SubstitutionRule_fromExerciseId_idx" ON "SubstitutionRule"("fromExerciseId");

-- CreateIndex
CREATE INDEX "SubstitutionRule_toExerciseId_idx" ON "SubstitutionRule"("toExerciseId");

-- CreateIndex
CREATE INDEX "Workout_userId_scheduledDate_idx" ON "Workout"("userId", "scheduledDate");

-- CreateIndex
CREATE INDEX "Workout_trainingBlockId_idx" ON "Workout"("trainingBlockId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkoutExercise_workoutId_orderIndex_key" ON "WorkoutExercise"("workoutId", "orderIndex");

-- CreateIndex
CREATE INDEX "FilteredExercise_workoutId_idx" ON "FilteredExercise"("workoutId");

-- CreateIndex
CREATE UNIQUE INDEX "SetLog_workoutSetId_key" ON "SetLog"("workoutSetId");

-- CreateIndex
CREATE INDEX "SessionCheckIn_userId_date_idx" ON "SessionCheckIn"("userId", "date");

-- CreateIndex
CREATE INDEX "ReadinessSignal_userId_timestamp_idx" ON "ReadinessSignal"("userId", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "UserIntegration_userId_isActive_idx" ON "UserIntegration"("userId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "UserIntegration_userId_provider_key" ON "UserIntegration"("userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "WorkoutTemplateExercise_templateId_orderIndex_key" ON "WorkoutTemplateExercise"("templateId", "orderIndex");

-- CreateIndex
CREATE INDEX "MacroCycle_userId_startDate_idx" ON "MacroCycle"("userId", "startDate");

-- CreateIndex
CREATE INDEX "Mesocycle_macroCycleId_idx" ON "Mesocycle"("macroCycleId");

-- CreateIndex
CREATE INDEX "Mesocycle_macroCycleId_isActive_idx" ON "Mesocycle"("macroCycleId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Mesocycle_macroCycleId_mesoNumber_key" ON "Mesocycle"("macroCycleId", "mesoNumber");

-- CreateIndex
CREATE INDEX "TrainingBlock_mesocycleId_idx" ON "TrainingBlock"("mesocycleId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingBlock_mesocycleId_blockNumber_key" ON "TrainingBlock"("mesocycleId", "blockNumber");

-- CreateIndex
CREATE INDEX "ExerciseExposure_userId_lastUsedAt_idx" ON "ExerciseExposure"("userId", "lastUsedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExerciseExposure_userId_exerciseName_key" ON "ExerciseExposure"("userId", "exerciseName");

-- AddForeignKey
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Constraints" ADD CONSTRAINT "Constraints_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goals" ADD CONSTRAINT "Goals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Injury" ADD CONSTRAINT "Injury_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseVariation" ADD CONSTRAINT "ExerciseVariation_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseAlias" ADD CONSTRAINT "ExerciseAlias_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseMuscle" ADD CONSTRAINT "ExerciseMuscle_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseMuscle" ADD CONSTRAINT "ExerciseMuscle_muscleId_fkey" FOREIGN KEY ("muscleId") REFERENCES "Muscle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseEquipment" ADD CONSTRAINT "ExerciseEquipment_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseEquipment" ADD CONSTRAINT "ExerciseEquipment_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubstitutionRule" ADD CONSTRAINT "SubstitutionRule_fromExerciseId_fkey" FOREIGN KEY ("fromExerciseId") REFERENCES "Exercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubstitutionRule" ADD CONSTRAINT "SubstitutionRule_toExerciseId_fkey" FOREIGN KEY ("toExerciseId") REFERENCES "Exercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workout" ADD CONSTRAINT "Workout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workout" ADD CONSTRAINT "Workout_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "WorkoutTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workout" ADD CONSTRAINT "Workout_trainingBlockId_fkey" FOREIGN KEY ("trainingBlockId") REFERENCES "TrainingBlock"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutExercise" ADD CONSTRAINT "WorkoutExercise_workoutId_fkey" FOREIGN KEY ("workoutId") REFERENCES "Workout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutExercise" ADD CONSTRAINT "WorkoutExercise_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutSet" ADD CONSTRAINT "WorkoutSet_workoutExerciseId_fkey" FOREIGN KEY ("workoutExerciseId") REFERENCES "WorkoutExercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FilteredExercise" ADD CONSTRAINT "FilteredExercise_workoutId_fkey" FOREIGN KEY ("workoutId") REFERENCES "Workout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetLog" ADD CONSTRAINT "SetLog_workoutSetId_fkey" FOREIGN KEY ("workoutSetId") REFERENCES "WorkoutSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionCheckIn" ADD CONSTRAINT "SessionCheckIn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionCheckIn" ADD CONSTRAINT "SessionCheckIn_workoutId_fkey" FOREIGN KEY ("workoutId") REFERENCES "Workout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadinessSignal" ADD CONSTRAINT "ReadinessSignal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserIntegration" ADD CONSTRAINT "UserIntegration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutTemplate" ADD CONSTRAINT "WorkoutTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutTemplateExercise" ADD CONSTRAINT "WorkoutTemplateExercise_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "WorkoutTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutTemplateExercise" ADD CONSTRAINT "WorkoutTemplateExercise_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MacroCycle" ADD CONSTRAINT "MacroCycle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mesocycle" ADD CONSTRAINT "Mesocycle_macroCycleId_fkey" FOREIGN KEY ("macroCycleId") REFERENCES "MacroCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingBlock" ADD CONSTRAINT "TrainingBlock_mesocycleId_fkey" FOREIGN KEY ("mesocycleId") REFERENCES "Mesocycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseExposure" ADD CONSTRAINT "ExerciseExposure_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

