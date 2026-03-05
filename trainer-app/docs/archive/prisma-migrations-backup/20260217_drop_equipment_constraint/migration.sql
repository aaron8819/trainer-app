-- Drop availableEquipment from Constraints — always hardcoded to ALL_EQUIPMENT_TYPES, no UI for per-user filtering
ALTER TABLE "Constraints" DROP COLUMN IF EXISTS "availableEquipment";
