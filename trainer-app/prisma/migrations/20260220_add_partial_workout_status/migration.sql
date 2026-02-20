-- Add PARTIAL workout status for explicit partial-session semantics
ALTER TYPE "WorkoutStatus" ADD VALUE IF NOT EXISTS 'PARTIAL';
