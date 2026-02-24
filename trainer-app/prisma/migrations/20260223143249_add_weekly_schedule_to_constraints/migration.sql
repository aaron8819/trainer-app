-- AlterTable
ALTER TABLE "Constraints" ADD COLUMN     "weeklySchedule" "WorkoutSessionIntent"[] DEFAULT ARRAY[]::"WorkoutSessionIntent"[];
