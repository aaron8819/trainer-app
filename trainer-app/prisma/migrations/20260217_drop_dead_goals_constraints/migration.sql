-- Drop dead schema fields: Goals.proteinTarget and Constraints.equipmentNotes
-- These fields are not referenced anywhere in src/ — safe to drop.
ALTER TABLE "Goals" DROP COLUMN IF EXISTS "proteinTarget";
ALTER TABLE "Constraints" DROP COLUMN IF EXISTS "equipmentNotes";
