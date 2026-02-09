"use client";

import { useEffect, useState } from "react";
import { SlideUpSheet } from "@/components/ui/SlideUpSheet";
import { BaselineEditor } from "./BaselineEditor";
import { AddToTemplateSheet } from "./AddToTemplateSheet";
import { PersonalHistorySection } from "./PersonalHistorySection";
import type { ExerciseDetail } from "@/lib/exercise-library/types";
import {
  MOVEMENT_PATTERN_LABELS,
  STIMULUS_BIAS_LABELS,
} from "@/lib/exercise-library/constants";

type ExerciseDetailSheetProps = {
  exerciseId: string | null;
  onClose: () => void;
  onNavigate: (exerciseId: string) => void;
};

function ScoreBar({ value, max = 5, color }: { value: number; max?: number; color: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="h-2 w-full rounded-full bg-slate-100">
      <div className={`h-2 rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function ExerciseDetailSheet({ exerciseId, onClose, onNavigate }: ExerciseDetailSheetProps) {
  const [detail, setDetail] = useState<ExerciseDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [showBaseline, setShowBaseline] = useState(false);
  const [favoriteState, setFavoriteState] = useState(false);
  const [avoidState, setAvoidState] = useState(false);
  const [prevId, setPrevId] = useState<string | null>(null);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [templateSheetOpen, setTemplateSheetOpen] = useState(false);

  // React 19: adjust state from props during render (no side effects)
  if (exerciseId !== prevId) {
    setPrevId(exerciseId);
    if (!exerciseId) {
      setDetail(null);
      setLoading(false);
    } else {
      setDetail(null);
      setLoading(true);
      setShowBaseline(false);
    }
  }

  useEffect(() => {
    if (!exerciseId) return;
    let cancelled = false;
    fetch(`/api/exercises/${exerciseId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.exercise) return;
        setDetail(data.exercise);
        setFavoriteState(data.exercise.isFavorite);
        setAvoidState(data.exercise.isAvoided);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [exerciseId, refreshCounter]);

  const toggleFavorite = async () => {
    if (!exerciseId) return;
    const res = await fetch(`/api/exercises/${exerciseId}/favorite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (res.ok) {
      const data = await res.json();
      setFavoriteState(data.isFavorite);
      setAvoidState(data.isAvoided);
    }
  };

  const toggleAvoid = async () => {
    if (!exerciseId) return;
    const res = await fetch(`/api/exercises/${exerciseId}/avoid`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (res.ok) {
      const data = await res.json();
      setFavoriteState(data.isFavorite);
      setAvoidState(data.isAvoided);
    }
  };

  return (
    <SlideUpSheet isOpen={exerciseId !== null} onClose={onClose} title={detail?.name}>
      {loading && (
        <div className="space-y-4 animate-pulse">
          <div className="h-6 w-3/4 rounded bg-slate-200" />
          <div className="h-4 w-1/2 rounded bg-slate-200" />
          <div className="h-4 w-2/3 rounded bg-slate-200" />
          <div className="h-32 rounded bg-slate-100" />
        </div>
      )}

      {!loading && detail && (
        <div className="space-y-5">
          {/* Compound/Isolation badge */}
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                detail.isCompound ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600"
              }`}
            >
              {detail.isCompound ? "Compound" : "Isolation"}
            </span>
            {detail.isMainLiftEligible && (
              <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                Main Lift Eligible
              </span>
            )}
          </div>

          {/* Muscles */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Muscles</h3>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {detail.primaryMuscles.map((m) => (
                <span key={m} className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">{m}</span>
              ))}
              {detail.secondaryMuscles.map((m) => (
                <span key={m} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-500">{m}</span>
              ))}
            </div>
          </section>

          {/* Movement Patterns */}
          {detail.movementPatterns.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Movement Patterns</h3>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {detail.movementPatterns.map((p) => (
                  <span key={p} className="rounded-full bg-violet-50 px-2.5 py-0.5 text-xs text-violet-600">
                    {MOVEMENT_PATTERN_LABELS[p]}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Attributes Grid */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Attributes</h3>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div>
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span>SFR Score</span>
                  <span className="font-medium">{detail.sfrScore}/5</span>
                </div>
                <ScoreBar value={detail.sfrScore} color="bg-emerald-500" />
              </div>
              <div>
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span>Lengthened Position</span>
                  <span className="font-medium">{detail.lengthPositionScore}/5</span>
                </div>
                <ScoreBar value={detail.lengthPositionScore} color="bg-sky-500" />
              </div>
              <div>
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span>Joint Stress</span>
                  <span className="font-medium capitalize">{detail.jointStress}</span>
                </div>
                <ScoreBar
                  value={detail.jointStress === "low" ? 1 : detail.jointStress === "medium" ? 3 : 5}
                  color="bg-orange-500"
                />
              </div>
              <div>
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span>Fatigue Cost</span>
                  <span className="font-medium">{detail.fatigueCost}/5</span>
                </div>
                <ScoreBar value={detail.fatigueCost} color="bg-rose-500" />
              </div>
            </div>
          </section>

          {/* Stimulus Bias */}
          {detail.stimulusBias.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Stimulus Bias</h3>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {detail.stimulusBias.map((b) => (
                  <span key={b} className="rounded-full bg-pink-50 px-2.5 py-0.5 text-xs text-pink-600">
                    {STIMULUS_BIAS_LABELS[b]}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Equipment */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Equipment</h3>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {detail.equipment.map((e) => (
                <span key={e} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs capitalize text-slate-600">{e}</span>
              ))}
            </div>
          </section>

          {/* Variations */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Variations</h3>
            {detail.variations.length > 0 ? (
              <ul className="mt-1.5 space-y-1">
                {detail.variations.map((v) => (
                  <li key={v.id} className="text-sm text-slate-700">
                    {v.name}
                    {v.description && <span className="ml-1 text-xs text-slate-400"> — {v.description}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 text-xs text-slate-400">No variations yet</p>
            )}
          </section>

          {/* Substitutions */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Substitutions</h3>
            {detail.substitutes.length > 0 ? (
              <div className="mt-1.5 space-y-1.5">
                {detail.substitutes.map((sub) => (
                  <button
                    key={sub.id}
                    onClick={() => onNavigate(sub.id)}
                    className="flex w-full items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-left transition-colors hover:bg-slate-50"
                  >
                    <span className="text-sm font-medium text-slate-800">{sub.name}</span>
                    <div className="flex gap-1">
                      {sub.primaryMuscles.slice(0, 2).map((m) => (
                        <span key={m} className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-600">{m}</span>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-1.5 text-xs text-slate-400">No substitutions found</p>
            )}
          </section>

          {/* Personal History */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Personal History</h3>
            <div className="mt-1.5">
              <PersonalHistorySection exerciseId={detail.id} />
            </div>
          </section>

          {/* Baseline Editor */}
          {showBaseline && (
            <section className="rounded-xl border border-slate-200 p-4">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Set Baseline</h3>
              <BaselineEditor
                exerciseId={detail.id}
                initial={detail.baseline}
                onSaved={() => {
                  setShowBaseline(false);
                  setRefreshCounter((c) => c + 1);
                }}
              />
            </section>
          )}

          {/* Action Bar */}
          <div className="sticky bottom-0 -mx-5 -mb-5 flex items-center gap-2 border-t border-slate-100 bg-white px-5 py-3">
            <button
              onClick={toggleFavorite}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                favoriteState
                  ? "bg-amber-100 text-amber-700"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill={favoriteState ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2}>
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
              {favoriteState ? "Favorited" : "Favorite"}
            </button>
            <button
              onClick={toggleAvoid}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                avoidState
                  ? "bg-rose-100 text-rose-700"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="10" />
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
              </svg>
              {avoidState ? "Avoided" : "Avoid"}
            </button>
            <button
              onClick={() => setShowBaseline(!showBaseline)}
              className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M12 20V10" />
                <path d="M18 20V4" />
                <path d="M6 20v-4" />
              </svg>
              Baseline
            </button>
            <button
              onClick={() => setTemplateSheetOpen(true)}
              className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Template
            </button>
          </div>
        </div>
      )}
      {detail && (
        <AddToTemplateSheet
          isOpen={templateSheetOpen}
          onClose={() => setTemplateSheetOpen(false)}
          exerciseId={detail.id}
          exerciseName={detail.name}
        />
      )}
    </SlideUpSheet>
  );
}
