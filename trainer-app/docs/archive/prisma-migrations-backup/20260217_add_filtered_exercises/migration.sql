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

-- CreateIndex
CREATE INDEX "FilteredExercise_workoutId_idx" ON "FilteredExercise"("workoutId");

-- AddForeignKey
ALTER TABLE "FilteredExercise" ADD CONSTRAINT "FilteredExercise_workoutId_fkey" FOREIGN KEY ("workoutId") REFERENCES "Workout"("id") ON DELETE CASCADE ON UPDATE CASCADE;
