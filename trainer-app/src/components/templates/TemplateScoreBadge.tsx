type TemplateScoreBadgeProps = {
  score: number;
  label: string;
  size?: "sm" | "md";
};

export function TemplateScoreBadge({
  score,
  label,
  size = "sm",
}: TemplateScoreBadgeProps) {
  const colorClass =
    score >= 75
      ? "bg-emerald-50 text-emerald-700"
      : score >= 60
        ? "bg-amber-50 text-amber-700"
        : "bg-rose-50 text-rose-700";

  const sizeClass =
    size === "md"
      ? "px-2.5 py-1 text-xs"
      : "px-2 py-0.5 text-[10px]";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-semibold ${colorClass} ${sizeClass}`}
      title="Template quality score based on coverage, balance, movement order, and fatigue efficiency."
      aria-label={`Template score ${score}, ${label}. Based on coverage, balance, order, and fatigue efficiency.`}
    >
      <span>{score}</span>
      <span className="font-medium">{label}</span>
    </span>
  );
}
