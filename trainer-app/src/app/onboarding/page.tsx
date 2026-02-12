import ProfileForm from "./ProfileForm";

export default function OnboardingPage() {
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="page-shell max-w-3xl">
        <h1 className="page-title">Profile Setup</h1>
        <p className="mt-1.5 text-sm text-slate-600">
          Capture goals, constraints, and equipment to power personalized workouts.
        </p>
        <ProfileForm />
      </div>
    </main>
  );
}
