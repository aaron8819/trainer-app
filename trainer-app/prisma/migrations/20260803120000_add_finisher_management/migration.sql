BEGIN;

CREATE TYPE "FinisherLibraryState" AS ENUM ('ACTIVE', 'ARCHIVED', 'DELETED');

ALTER TABLE "FinisherRoutine" ADD COLUMN "ownerId" TEXT;

CREATE TABLE "FinisherLibraryItem" (
    "ownerId" TEXT NOT NULL,
    "routineId" TEXT NOT NULL,
    "state" "FinisherLibraryState" NOT NULL DEFAULT 'ACTIVE',
    "activePosition" INTEGER,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "restoredAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "FinisherLibraryItem_pkey" PRIMARY KEY ("ownerId", "routineId"),
    CONSTRAINT "FinisherLibraryItem_revision_positive" CHECK ("revision" > 0),
    CONSTRAINT "FinisherLibraryItem_active_position_nonnegative" CHECK (
      "activePosition" IS NULL OR "activePosition" >= 0
    ),
    CONSTRAINT "FinisherLibraryItem_lifecycle_consistent" CHECK (
      (
        "state" = 'ACTIVE'
        AND "activePosition" IS NOT NULL
        AND "archivedAt" IS NULL
        AND "deletedAt" IS NULL
      )
      OR (
        "state" = 'ARCHIVED'
        AND "activePosition" IS NULL
        AND "archivedAt" IS NOT NULL
        AND "deletedAt" IS NULL
      )
      OR (
        "state" = 'DELETED'
        AND "activePosition" IS NULL
        AND "deletedAt" IS NOT NULL
      )
    )
);

CREATE INDEX "FinisherRoutine_ownerId_publicationState_idx"
  ON "FinisherRoutine"("ownerId", "publicationState");
CREATE UNIQUE INDEX "FinisherLibraryItem_ownerId_activePosition_key"
  ON "FinisherLibraryItem"("ownerId", "activePosition");
CREATE INDEX "FinisherLibraryItem_ownerId_state_updatedAt_idx"
  ON "FinisherLibraryItem"("ownerId", "state", "updatedAt");

ALTER TABLE "FinisherRoutine"
  ADD CONSTRAINT "FinisherRoutine_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "FinisherLibraryItem"
  ADD CONSTRAINT "FinisherLibraryItem_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE "FinisherLibraryItem"
  ADD CONSTRAINT "FinisherLibraryItem_routineId_fkey"
  FOREIGN KEY ("routineId") REFERENCES "FinisherRoutine"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION guard_finisher_library_item_identity_and_ownership() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  routine_owner_id TEXT;
BEGIN
  IF TG_OP = 'UPDATE'
    AND (
      NEW."ownerId" IS DISTINCT FROM OLD."ownerId"
      OR NEW."routineId" IS DISTINCT FROM OLD."routineId"
    )
  THEN
    RAISE EXCEPTION 'finisher library item identity is immutable';
  END IF;

  SELECT routine."ownerId"
  INTO routine_owner_id
  FROM "FinisherRoutine" routine
  WHERE routine."id" = NEW."routineId";

  IF FOUND
    AND routine_owner_id IS NOT NULL
    AND routine_owner_id IS DISTINCT FROM NEW."ownerId"
  THEN
    RAISE EXCEPTION 'finisher library item owner must match routine owner';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "FinisherLibraryItem_identity_and_ownership"
BEFORE INSERT OR UPDATE ON "FinisherLibraryItem"
FOR EACH ROW EXECUTE FUNCTION guard_finisher_library_item_identity_and_ownership();

-- Ownership is stable routine identity. Publication lifecycle remains the only
-- mutable product-level catalog state on the routine row.
CREATE OR REPLACE FUNCTION guard_finisher_routine_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'finisher routine identity is immutable';
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."code" IS DISTINCT FROM OLD."code"
    OR NEW."ownerId" IS DISTINCT FROM OLD."ownerId"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'finisher routine identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

-- An empty active library is a valid finalized offer. Existing positive offers
-- keep their exact contiguous immutable item set.
ALTER TABLE "FinisherOffer" DROP CONSTRAINT "FinisherOffer_item_count_positive";
ALTER TABLE "FinisherOffer"
  ADD CONSTRAINT "FinisherOffer_item_count_nonnegative" CHECK ("itemCount" >= 0);

CREATE OR REPLACE FUNCTION require_finisher_offer_finalized() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  finalized_at TIMESTAMP(3);
  expected_item_count INTEGER;
  actual_item_count INTEGER;
  minimum_position INTEGER;
  maximum_position INTEGER;
  recommended_version_id TEXT;
BEGIN
  SELECT
    offer."finalizedAt",
    offer."itemCount",
    offer."recommendedRoutineVersionId"
  INTO finalized_at, expected_item_count, recommended_version_id
  FROM "FinisherOffer" offer
  WHERE offer."id" = NEW."id";

  IF finalized_at IS NULL THEN
    RAISE EXCEPTION 'finisher offer must be finalized before commit';
  END IF;

  SELECT COUNT(*)::INTEGER, MIN(item."position"), MAX(item."position")
  INTO actual_item_count, minimum_position, maximum_position
  FROM "FinisherOfferItem" item
  WHERE item."offerId" = NEW."id";

  IF actual_item_count <> expected_item_count
    OR (
      expected_item_count = 0
      AND (
        minimum_position IS NOT NULL
        OR maximum_position IS NOT NULL
        OR recommended_version_id IS NOT NULL
      )
    )
    OR (
      expected_item_count > 0
      AND (
        minimum_position <> 0
        OR maximum_position <> expected_item_count - 1
      )
    )
  THEN
    RAISE EXCEPTION 'finalized finisher offer item set must be complete and contiguous';
  END IF;

  IF recommended_version_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "FinisherOfferItem" item
      WHERE item."offerId" = NEW."id"
        AND item."routineVersionId" = recommended_version_id
    )
  THEN
    RAISE EXCEPTION 'finalized finisher offer recommendation must identify an exact offered item';
  END IF;

  RETURN NULL;
END;
$$;

COMMIT;
