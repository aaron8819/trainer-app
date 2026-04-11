"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type CloseoutCardModel = {
  title: string;
  statusLabel: string;
  detail: string;
  actionHref: string;
  actionLabel: string;
  dismissActionHref: string | null;
  dismissActionLabel: string | null;
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
  const Title = titleElement;

  if (hidden) {
    return null;
  }

  const handleDismiss = async () => {
    if (!closeout.dismissActionHref) {
      return;
    }

    setDismissError(null);
    setHidden(true);

    const response = await fetch(closeout.dismissActionHref, {
      method: "POST",
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setDismissError(body.error ?? "Could not skip closeout.");
      setHidden(false);
      return;
    }

    router.refresh();
  };

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
            Closeout
          </p>
          <Title className={titleClassName}>{closeout.title}</Title>
          <p className="mt-2 text-sm text-slate-700">{closeout.detail}</p>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700">
          {closeout.statusLabel}
        </span>
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <Link
          className="inline-flex min-h-11 items-center justify-center rounded-full border border-amber-300 bg-white px-5 py-2 text-sm font-semibold text-slate-900"
          href={closeout.actionHref}
          prefetch={false}
        >
          {closeout.actionLabel}
        </Link>
        {closeout.dismissActionHref && closeout.dismissActionLabel ? (
          <button
            type="button"
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 bg-white px-5 py-2 text-sm font-semibold text-slate-900"
            onClick={handleDismiss}
          >
            {closeout.dismissActionLabel}
          </button>
        ) : null}
      </div>
      {dismissError ? <p className="mt-2 text-sm text-rose-600">{dismissError}</p> : null}
    </div>
  );
}
