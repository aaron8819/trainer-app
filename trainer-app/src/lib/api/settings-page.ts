import type { ProfileFormValues } from "@/app/onboarding/ProfileForm";
import { prisma } from "@/lib/db/prisma";
import { loadExerciseLibrary } from "@/lib/api/exercise-library";
import type { ExerciseListItem } from "@/lib/exercise-library/types";
import { getUiAuditFixtureForServer } from "@/lib/ui-audit-fixtures/server";

type UserPreferenceInitialValues = {
  userId?: string;
  favoriteExerciseIds?: string[];
  avoidExerciseIds?: string[];
};

export type SettingsPageData = {
  profileInitialValues?: Partial<ProfileFormValues>;
  preferenceInitialValues?: UserPreferenceInitialValues;
  exercises: ExerciseListItem[];
};

export async function loadSettingsPageData(user: {
  id: string;
  email: string;
} | null): Promise<SettingsPageData> {
  const fixture = await getUiAuditFixtureForServer();
  if (fixture?.settings) {
    return fixture.settings;
  }

  if (!user) {
    return {
      profileInitialValues: undefined,
      preferenceInitialValues: undefined,
      exercises: [],
    };
  }

  const [profile, goals, constraints, injury, preferences, exercises] = await Promise.all([
    prisma.profile.findUnique({ where: { userId: user.id } }),
    prisma.goals.findUnique({ where: { userId: user.id } }),
    prisma.constraints.findUnique({ where: { userId: user.id } }),
    prisma.injury.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }),
    prisma.userPreference.findUnique({ where: { userId: user.id } }),
    loadExerciseLibrary(user.id),
  ]);

  return {
    profileInitialValues: {
      userId: user.id,
      email: user.email,
      age: profile?.age ?? undefined,
      sex: profile?.sex ?? undefined,
      heightIn: profile?.heightIn ?? undefined,
      weightLb: profile?.weightLb ?? undefined,
      trainingAge: profile?.trainingAge ?? "INTERMEDIATE",
      primaryGoal: goals?.primaryGoal ?? "HYPERTROPHY",
      secondaryGoal: goals?.secondaryGoal ?? "CONDITIONING",
      daysPerWeek: constraints?.daysPerWeek ?? 4,
      splitType: constraints?.splitType ?? "PPL",
      weeklySchedule: constraints?.weeklySchedule ?? [],
      injuryBodyPart: injury?.bodyPart ?? undefined,
      injurySeverity: injury?.severity ?? undefined,
      injuryDescription: injury?.description ?? undefined,
      injuryActive: injury ? injury.isActive : false,
    },
    preferenceInitialValues: {
      userId: user.id,
      favoriteExerciseIds: preferences?.favoriteExerciseIds ?? [],
      avoidExerciseIds: preferences?.avoidExerciseIds ?? [],
    },
    exercises,
  };
}
