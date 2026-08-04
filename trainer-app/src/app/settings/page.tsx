import ProfileForm from "../onboarding/ProfileForm";
import UserPreferencesForm from "@/components/UserPreferencesForm";
import { findOwnerReadOnly } from "@/lib/api/workout-context";
import { loadSettingsPageData } from "@/lib/api/settings-page";
import { PRIMARY_GOAL_OPTIONS, SECONDARY_GOAL_OPTIONS } from "@/lib/profile-goal-options";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SettingsPage() {
  const user = await findOwnerReadOnly();
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

        <Link
          href="/settings/finishers"
          className="mt-6 block rounded-2xl border border-slate-200 bg-slate-50 p-4 transition-colors hover:border-sky-300 hover:bg-sky-50"
        >
          <span className="font-semibold text-slate-950">Finishers</span>
          <span className="mt-1 block text-sm text-slate-600">
            Create, order, archive, and customize post-workout timed routines.
          </span>
        </Link>

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
