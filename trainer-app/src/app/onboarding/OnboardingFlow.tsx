"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ProfileForm, { type ProfileFormValues } from "./ProfileForm";
import BaselineSetupCard from "@/components/BaselineSetupCard";

type ExercisePoolItem = {
  id: string;
  name: string;
  isMainLiftEligible?: boolean;
  equipment: string[];
  primaryMuscles: string[];
};

type ExistingBaseline = {
  exerciseId: string;
  context: string;
  workingWeightMin?: number | null;
  workingWeightMax?: number | null;
  topSetWeight?: number | null;
  topSetReps?: number | null;
};

export default function OnboardingFlow({
  exercisePool,
  existingBaselines,
  initialValues,
}: {
  exercisePool: ExercisePoolItem[];
  existingBaselines: ExistingBaseline[];
  initialValues?: Partial<ProfileFormValues>;
}) {
  const router = useRouter();
  const [savedProfile, setSavedProfile] = useState<{
    primaryGoal: ProfileFormValues["primaryGoal"];
    splitType: ProfileFormValues["splitType"];
  } | null>(null);

  return (
    <>
      <ProfileForm
        initialValues={initialValues}
        submitLabel="Save profile and continue"
        onSaved={(payload) => {
          setSavedProfile({
            primaryGoal: payload.primaryGoal,
            splitType: payload.splitType,
          });
        }}
      />

      {savedProfile ? (
        <BaselineSetupCard
          title="Set Your Starting Weights"
          description="Optional but recommended for better first-session loads. You can skip any exercise or this entire step."
          splitType={savedProfile.splitType}
          primaryGoal={savedProfile.primaryGoal}
          exercisePool={exercisePool}
          existingBaselines={existingBaselines}
          onSkipAll={() => router.push("/")}
          showStartTrainingCta
        />
      ) : null}
    </>
  );
}
