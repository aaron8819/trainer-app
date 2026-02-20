"use client";

import { useRouter } from "next/navigation";
import ProfileForm, { type ProfileFormValues } from "./ProfileForm";

export default function OnboardingFlow({
  initialValues,
}: {
  initialValues?: Partial<ProfileFormValues>;
}) {
  const router = useRouter();

  return (
    <ProfileForm
      initialValues={initialValues}
      submitLabel="Save profile and start training"
      onSaved={() => {
        router.push("/");
      }}
    />
  );
}
