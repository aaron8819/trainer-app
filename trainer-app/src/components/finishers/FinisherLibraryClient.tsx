"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type {
  FinisherLibraryData,
  FinisherLibraryItemDto,
} from "@/lib/api/finisher-library-service";
import { Button, buttonClassName } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  displayFinisherEnum,
  formatFinisherDuration,
} from "./FinisherRoutinePreview";

function responseMessage(code: string | undefined): string {
  if (code === "FINISHER_LIBRARY_STALE") {
    return "The library changed in another tab. Reload before trying again.";
  }
  if (code === "FINISHER_ROUTINE_DELETE_BLOCKED") {
    return "This finisher is selected or in progress and cannot be deleted.";
  }
  return "Could not update the finisher library.";
}

export function FinisherLibraryClient({ initial }: { initial: FinisherLibraryData }) {
  const router = useRouter();
  const [library, setLibrary] = useState(initial);
  const [view, setView] = useState<"ACTIVE" | "ARCHIVED">("ACTIVE");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const lifecycle = async (
    item: FinisherLibraryItemDto,
    action: "archive" | "restore" | "delete",
  ) => {
    if (
      action === "delete" &&
      !window.confirm(
        `Delete “${item.routine.name}” from your Finisher library? Completed history will remain available.`,
      )
    ) {
      return;
    }
    setBusyId(item.routineId);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        action === "delete"
          ? `/api/finishers/${item.routineId}`
          : `/api/finishers/${item.routineId}/${action}`,
        {
          method: action === "delete" ? "DELETE" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedRevision: item.revision }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as
        | FinisherLibraryData
        | { code?: string };
      if (!response.ok || !("active" in body)) {
        setError(responseMessage("code" in body ? body.code : undefined));
        return;
      }
      setLibrary(body);
      setMessage(
        action === "archive"
          ? `${item.routine.name} was archived.`
          : action === "restore"
            ? `${item.routine.name} is active again.`
            : `${item.routine.name} was deleted from your library.`,
      );
      router.refresh();
    } catch {
      setError("Could not update the finisher library.");
    } finally {
      setBusyId(null);
    }
  };

  const duplicate = async (item: FinisherLibraryItemDto) => {
    setBusyId(item.routineId);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/finishers/${item.routineId}/duplicate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedRoutineVersionId: item.routine.id,
          }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        item?: FinisherLibraryItemDto;
        code?: string;
      };
      if (!response.ok || !body.item) {
        setError(responseMessage(body.code));
        return;
      }
      router.push(`/settings/finishers/${body.item.routineId}/edit`);
      router.refresh();
    } catch {
      setError("Could not duplicate this finisher.");
    } finally {
      setBusyId(null);
    }
  };

  const move = async (index: number, direction: -1 | 1) => {
    const destination = index + direction;
    if (destination < 0 || destination >= library.active.length) return;
    const desired = [...library.active];
    [desired[index], desired[destination]] = [
      desired[destination]!,
      desired[index]!,
    ];
    setBusyId(desired[destination]!.routineId);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/finishers/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: desired.map((item) => ({
            routineId: item.routineId,
            expectedRevision: item.revision,
          })),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as
        | FinisherLibraryData
        | { code?: string };
      if (!response.ok || !("active" in body)) {
        setError(responseMessage("code" in body ? body.code : undefined));
        return;
      }
      setLibrary(body);
      setMessage("Finisher order updated.");
    } catch {
      setError("Could not reorder the finisher library.");
    } finally {
      setBusyId(null);
    }
  };

  const items = view === "ACTIVE" ? library.active : library.archived;

  return (
    <div className="mt-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1" role="tablist" aria-label="Finisher library views">
          {(["ACTIVE", "ARCHIVED"] as const).map((tab) => (
            <button
              key={tab}
              role="tab"
              aria-selected={view === tab}
              onClick={() => setView(tab)}
              className={`min-h-11 rounded-lg px-4 text-sm font-semibold ${
                view === tab ? "bg-white text-slate-950 shadow-sm" : "text-slate-600"
              }`}
              type="button"
            >
              {tab === "ACTIVE" ? `Active (${library.active.length})` : `Archived (${library.archived.length})`}
            </button>
          ))}
        </div>
        <Link href="/settings/finishers/new" className={buttonClassName({ size: "touch" })}>
          Create finisher
        </Link>
      </div>

      <div aria-live="polite" className="mt-4 space-y-2">
        {message ? <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p> : null}
        {error ? <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p> : null}
      </div>

      {items.length === 0 ? (
        <section className="mt-5 rounded-2xl border border-dashed border-slate-300 p-8 text-center">
          <h2 className="font-semibold text-slate-900">
            {view === "ACTIVE" ? "No active Finishers" : "No archived Finishers"}
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            {view === "ACTIVE"
              ? "Create or restore a routine. New workout offers can remain empty until then."
              : "Archived routines will appear here and can be restored later."}
          </p>
        </section>
      ) : (
        <div className="mt-5 space-y-4">
          {items.map((item, index) => {
            const busy = busyId === item.routineId;
            return (
              <article key={item.routineId} className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold text-slate-950">{item.routine.name}</h2>
                      <StatusBadge tone={item.ownership === "SYSTEM" ? "neutral" : "positive"}>
                        {item.ownership === "SYSTEM" ? "System" : "Your routine"}
                      </StatusBadge>
                      <StatusBadge tone="neutral">v{item.routine.version}</StatusBadge>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{item.routine.description}</p>
                    <p className="mt-2 text-xs font-medium text-slate-500">
                      {formatFinisherDuration(item.routine.durationSeconds)} · {displayFinisherEnum(item.routine.category)} · {displayFinisherEnum(item.routine.difficulty)} · {item.routine.steps.length} steps
                    </p>
                  </div>
                  {view === "ACTIVE" ? (
                    <div className="flex gap-1 self-end sm:self-start">
                      <Button variant="ghost" size="sm" disabled={busy || index === 0} onClick={() => move(index, -1)} aria-label={`Move ${item.routine.name} up`}>↑</Button>
                      <Button variant="ghost" size="sm" disabled={busy || index === library.active.length - 1} onClick={() => move(index, 1)} aria-label={`Move ${item.routine.name} down`}>↓</Button>
                    </div>
                  ) : null}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {item.canEdit ? (
                    <Link href={`/settings/finishers/${item.routineId}/edit`} className={buttonClassName({ variant: "secondary", size: "touch" })}>
                      Edit
                    </Link>
                  ) : null}
                  <Button variant="secondary" size="touch" disabled={busy} onClick={() => duplicate(item)}>
                    {busy ? "Working…" : item.ownership === "SYSTEM" ? "Customize" : "Duplicate"}
                  </Button>
                  {view === "ACTIVE" ? (
                    <Button variant="ghost" size="touch" disabled={busy} onClick={() => lifecycle(item, "archive")}>
                      Archive
                    </Button>
                  ) : (
                    <Button size="touch" disabled={busy} onClick={() => lifecycle(item, "restore")}>
                      Restore
                    </Button>
                  )}
                  {item.canDelete ? (
                    <Button variant="danger" size="touch" disabled={busy} onClick={() => lifecycle(item, "delete")}>
                      Delete
                    </Button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
