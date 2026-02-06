"use client";

import { useState } from "react";

export default function DeleteWorkoutButton({
  workoutId,
  onDeleted,
}: {
  workoutId: string;
  onDeleted?: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    const confirmed = window.confirm("Delete this workout? This cannot be undone.");
    if (!confirmed) {
      return;
    }

    setDeleting(true);
    setError(null);

    const response = await fetch("/api/workouts/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workoutId }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "Failed to delete workout");
      setDeleting(false);
      return;
    }

    setDeleting(false);
    onDeleted?.();
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        className="rounded-full border border-rose-300 px-4 py-1 text-xs font-semibold text-rose-600 disabled:opacity-60"
        onClick={handleDelete}
        disabled={deleting}
      >
        {deleting ? "Deleting..." : "Delete"}
      </button>
      {error ? <span className="text-xs text-rose-600">{error}</span> : null}
    </div>
  );
}
