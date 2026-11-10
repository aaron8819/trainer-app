export function WorkoutWarmup({ text }: { text?: string }) {
  if (!text) return null;
  return <section aria-label="Warm-up" className="mb-4 rounded-xl border border-slate-200 p-4">
    <h3 className="font-semibold">Warm-up</h3>
    <p className="mt-1 text-sm text-slate-600">Before your first exercise · No logging needed</p>
    <p className="mt-2 whitespace-pre-wrap break-words text-sm">{text}</p>
  </section>;
}
