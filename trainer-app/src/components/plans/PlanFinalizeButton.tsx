"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

export function PlanFinalizeButton({
  planId,
  planName,
  expectedUpdatedAt,
}: {
  planId: string;
  planName: string;
  expectedUpdatedAt: string;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finalize = async () => {
    if (
      !window.confirm(
        `Finalize “${planName}” as READY? It will not replace your current active plan.`,
      )
    ) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/plans/${planId}/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedUpdatedAt }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? "Could not finalize this plan.");
        return;
      }
      router.push("/plans");
      router.refresh();
    } catch {
      setError("Could not finalize this plan.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <Button size="touch" onClick={finalize} disabled={submitting}>
        {submitting ? "Finalizing…" : "Finalize as READY"}
      </Button>
      <p className="mt-2 text-xs text-slate-500">
        Finalization preserves your current active plan. Activate this plan
        separately from Plan Management.
      </p>
      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
