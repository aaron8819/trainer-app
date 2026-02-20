-- Remove legacy Program/ProgramBlock system (ADR-085)
-- New system: MacroCycle → Mesocycle → TrainingBlock
--
-- Order matters for FK constraints:
-- 1. Drop Workout columns that reference ProgramBlock (removes incoming FK)
-- 2. Drop ProgramBlock (removes its FK to Program)
-- 3. Drop Program

-- Step 1: Drop Workout columns
ALTER TABLE "Workout" DROP COLUMN IF EXISTS "programBlockId";
ALTER TABLE "Workout" DROP COLUMN IF EXISTS "blockPhase";

-- Step 2: Drop ProgramBlock table
DROP TABLE IF EXISTS "ProgramBlock";

-- Step 3: Drop Program table
DROP TABLE IF EXISTS "Program";
