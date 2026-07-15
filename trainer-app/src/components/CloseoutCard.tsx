"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button, buttonClassName } from "@/components/ui/Button";

export type CloseoutCardModel = {
  title: string;
  statusLabel: string;
  detail: string;
  actionHref: string;
  actionLabel: string;
  actionMethod?: "link" | "post";
  dismissActionHref: string | null;
  dismissActionLabel: string | null;
  workoutRevision?: number | null;
};

type Props = {
  closeout: CloseoutCardModel;
  titleElement?: "p" | "h2";
  titleClassName?: string;
};

export function CloseoutCard({
  closeout,
  titleElement = "p",
  titleClassName = "mt-2 text-lg font-semibold text-slate-900",
}: Props) {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  const [dismissError, setDismissError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const Title = titleElement;

  if (hidden) {
    return null;
  }

  const handleDismiss = async () => {
    if (!closeout.dismissActionHref || closeout.workoutRevision == null) {
      return;
    }

    setDismissError(null);
    setHidden(true);

    const response = await fetch(closeout.dismissActionHref, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: closeout.workoutRevision }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setDismissError(body.error ?? "Could not hide optional session.");
      setHidden(false);
      return;
    }

    router.refresh();
  };

  const handleCreate = async () => {
    setActionLoading(true);
    setActionError(null);

    const response = await fetch(closeout.actionHref, {
      method: "POST",
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setActionError(body.error ?? "Could not create optional session.");
      setActionLoading(false);
      return;
    }

    const body = await response.json().catch(() => ({}));
    const workoutId = body.workout?.id;
    if (typeof workoutId === "string" && workoutId.length > 0) {
      router.push(`/log/${workoutId}`);
      router.refresh();
      return;
    }

    setActionError("Optional session was created, but no workout was returned.");
    setActionLoading(false);
  };

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
            Optional Session
          </p>
          <Title className={titleClassName}>{closeout.title}</Title>
          <p className="mt-2 text-sm text-slate-700">{closeout.detail}</p>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700">
          {closeout.statusLabel}
        </span>
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        {closeout.actionMethod === "post" ? (
          <Button
            type="button"
            variant="secondary"
            size="touch"
            onClick={handleCreate}
            disabled={actionLoading}
          >
            {actionLoading ? "Creating..." : closeout.actionLabel}
          </Button>
        ) : (
          <Link
            className={buttonClassName({ variant: "secondary", size: "touch" })}
            href={closeout.actionHref}
            prefetch={false}
          >
            {closeout.actionLabel}
          </Link>
        )}
        {closeout.dismissActionHref && closeout.dismissActionLabel ? (
          <Button
            type="button"
            variant="secondary"
            size="touch"
            onClick={handleDismiss}
          >
            {closeout.dismissActionLabel}
          </Button>
        ) : null}
      </div>
      {dismissError ? (
        <Alert tone="critical" role="alert" className="mt-3 px-3 py-2 shadow-none">
          {dismissError}
        </Alert>
      ) : null}
      {actionError ? (
        <Alert tone="critical" role="alert" className="mt-3 px-3 py-2 shadow-none">
          {actionError}
        </Alert>
      ) : null}
    </div>
  );
}
