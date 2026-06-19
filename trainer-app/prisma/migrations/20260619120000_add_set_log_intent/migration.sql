-- Add explicit performed-set intent for distinguishing work evidence from warmup/ramp logs.
CREATE TYPE "SetIntent" AS ENUM ('WORK', 'WARMUP');

ALTER TABLE "SetLog"
  ADD COLUMN "setIntent" "SetIntent" NOT NULL DEFAULT 'WORK';
