export default function AnalyticsPage() {
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-3xl font-semibold">Analytics</h1>
        <p className="mt-2 text-slate-600">Training volume, progress, and readiness trends.</p>

        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {[
            { label: "Workouts Completed", value: "0" },
            { label: "Total Sets", value: "0" },
            { label: "Readiness Trend", value: "Stable" },
          ].map((card) => (
            <div key={card.label} className="rounded-2xl border border-slate-200 p-6">
              <p className="text-sm uppercase tracking-wide text-slate-500">{card.label}</p>
              <p className="mt-3 text-2xl font-semibold">{card.value}</p>
            </div>
          ))}
        </div>

        <div className="mt-8 rounded-2xl border border-slate-200 p-6">
          <p className="text-sm text-slate-500">Charts will render here once data is connected.</p>
        </div>
      </div>
    </main>
  );
}
