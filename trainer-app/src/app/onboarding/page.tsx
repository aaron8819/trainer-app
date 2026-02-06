import ProfileForm from "./ProfileForm";

export default function OnboardingPage() {
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-3xl font-semibold">Profile Setup</h1>
        <p className="mt-2 text-slate-600">
          Capture goals, constraints, and equipment to power personalized workouts.
        </p>
        <ProfileForm />
      </div>
    </main>
  );
}
