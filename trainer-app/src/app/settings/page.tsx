import ProfileForm from "../onboarding/ProfileForm";
import UserPreferencesForm from "@/components/UserPreferencesForm";
import { resolveOwner } from "@/lib/api/workout-context";
import { loadSettingsPageData } from "@/lib/api/settings-page";
import { PRIMARY_GOAL_OPTIONS, SECONDARY_GOAL_OPTIONS } from "@/lib/profile-goal-options";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SettingsPage() {
  const user = await resolveOwner();
  const data = await loadSettingsPageData(user);

  const primaryGoalOptions = PRIMARY_GOAL_OPTIONS;
  const secondaryGoalOptions = SECONDARY_GOAL_OPTIONS;

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="page-shell max-w-3xl">
        <h1 className="page-title">Settings</h1>
        <p className="mt-1.5 text-sm text-slate-600">
          Manage goals, schedule, equipment, and preferences.
        </p>

        <ProfileForm
          initialValues={data.profileInitialValues}
          primaryGoalOptions={primaryGoalOptions}
          secondaryGoalOptions={secondaryGoalOptions}
        />
        <UserPreferencesForm initialValues={data.preferenceInitialValues} exercises={data.exercises} />
      </div>
    </main>
  );
}
