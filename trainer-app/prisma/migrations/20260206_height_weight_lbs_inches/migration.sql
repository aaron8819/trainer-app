-- Move Profile height/weight storage to inches/lbs.
ALTER TABLE "Profile" ADD COLUMN "heightIn" INTEGER;
ALTER TABLE "Profile" ADD COLUMN "weightLb" DOUBLE PRECISION;

UPDATE "Profile"
SET
  "heightIn" = CASE
    WHEN "heightCm" IS NULL THEN NULL
    ELSE ROUND("heightCm" / 2.54)
  END,
  "weightLb" = CASE
    WHEN "weightKg" IS NULL THEN NULL
    ELSE ROUND(("weightKg" / 0.45359237)::numeric, 1)
  END;

ALTER TABLE "Profile" DROP COLUMN "heightCm";
ALTER TABLE "Profile" DROP COLUMN "weightKg";
