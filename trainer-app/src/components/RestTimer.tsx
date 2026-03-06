"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SlideUpSheet } from "@/components/ui/SlideUpSheet";

type RestTimerProps = {
  startedAtMs: number;
  endAtMs: number;
  onDismiss: () => void;
  onAdjust?: (deltaSeconds: number) => void;
  muted: boolean;
  onMuteToggle: () => void;
  expanded: boolean;
  onExpand: () => void;
  onCloseExpanded: () => void;
};

export function RestTimer({
  startedAtMs,
  endAtMs,
  onDismiss,
  onAdjust,
  muted,
  onMuteToggle,
  expanded,
  onExpand,
  onCloseExpanded,
}: RestTimerProps) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.ceil((endAtMs - Date.now()) / 1000))
  );
  // Mirror muted into a ref so playCompletionAlert can read it without restarting the timer
  const mutedRef = useRef(muted);
  const dismissRef = useRef(onDismiss);
  const endAtRef = useRef<number>(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const completedRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  const initializeAudioContext = useCallback(() => {
    if (typeof window === "undefined") {
      return null;
    }
    if (audioContextRef.current) {
      return audioContextRef.current;
    }
    const Context =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) {
      return null;
    }
    audioContextRef.current = new Context();
    return audioContextRef.current;
  }, []);

  const playCompletionAlert = useCallback(() => {
    if (mutedRef.current) {
      return;
    }
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate([200, 100, 200]);
      return;
    }
    const context = audioContextRef.current;
    if (!context) {
      return;
    }
    const playTone = () => {
      const oscillator = context.createOscillator();
      const gainNode = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 440;
      gainNode.gain.setValueAtTime(0.001, context.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.15, context.currentTime + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.2);
      oscillator.connect(gainNode);
      gainNode.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.2);
    };
    if (context.state === "suspended") {
      context.resume().then(playTone).catch(() => {
        // resume failed — vibrate already tried above, fall through silently
      });
      return;
    }
    playTone();
  }, []);

  const clearTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const tick = useCallback(() => {
    const remainingSeconds = Math.max(0, Math.ceil((endAtRef.current - Date.now()) / 1000));
    setRemaining(remainingSeconds);
    if (remainingSeconds <= 0 && !completedRef.current) {
      completedRef.current = true;
      clearTimer();
      playCompletionAlert();
      dismissRef.current();
    }
  }, [clearTimer, playCompletionAlert]);

  useEffect(() => {
    completedRef.current = false;
    endAtRef.current = endAtMs;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRemaining(Math.max(0, Math.ceil((endAtMs - Date.now()) / 1000)));
    clearTimer();
    intervalRef.current = setInterval(tick, 250);
    const initialTickTimeout = setTimeout(() => {
      tick();
    }, 0);
    return () => {
      clearTimeout(initialTickTimeout);
      clearTimer();
    };
  }, [clearTimer, endAtMs, tick]);

  useEffect(() => {
    const initializeAudio = () => {
      initializeAudioContext();
      document.removeEventListener("pointerdown", initializeAudio);
      document.removeEventListener("keydown", initializeAudio);
    };
    document.addEventListener("pointerdown", initializeAudio);
    document.addEventListener("keydown", initializeAudio);
    return () => {
      document.removeEventListener("pointerdown", initializeAudio);
      document.removeEventListener("keydown", initializeAudio);
    };
  }, [initializeAudioContext]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        tick();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [tick]);

  useEffect(() => {
    return () => {
      clearTimer();
      if (audioContextRef.current) {
        void audioContextRef.current.close();
      }
    };
  }, [clearTimer]);

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const totalSeconds = Math.max(1, Math.ceil((endAtMs - startedAtMs) / 1000));
  const progress = Math.min(1, remaining / totalSeconds);
  const formattedTime = `${minutes}:${String(seconds).padStart(2, "0")}`;

  return (
    <>
      <button
        aria-expanded={expanded}
        aria-haspopup="dialog"
        aria-label={`Open rest timer controls. ${formattedTime} remaining.`}
        className="flex w-full flex-col gap-2 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-left text-white shadow-sm"
        data-testid="rest-timer-hud"
        onClick={onExpand}
        type="button"
      >
        <div className="flex min-h-8 items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-300">Rest</p>
            <div className="flex items-center gap-2">
              <p className="text-xl font-bold tabular-nums sm:text-2xl">{formattedTime}</p>
              {muted ? (
                <span className="rounded-full border border-slate-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-300">
                  Muted
                </span>
              ) : null}
            </div>
          </div>
          <span className="shrink-0 text-xs font-semibold text-slate-300">Controls</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-700/80" data-testid="rest-timer-progress">
          <div
            className="h-full rounded-full bg-emerald-400 transition-all duration-1000"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </button>

      <SlideUpSheet isOpen={expanded} onClose={onCloseExpanded} title="Rest timer">
        <section className="space-y-5" data-testid="rest-timer-expanded-controls">
          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Rest Timer</p>
            <p className="text-4xl font-bold tabular-nums text-slate-900 sm:text-5xl">{formattedTime}</p>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-slate-900 transition-all duration-1000"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {onAdjust ? (
              <>
                <button
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-slate-300 px-4 text-sm font-semibold text-slate-700"
                  onClick={() => {
                    initializeAudioContext();
                    onAdjust(-15);
                  }}
                  type="button"
                >
                  -15s
                </button>
                <button
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-slate-300 px-4 text-sm font-semibold text-slate-700"
                  onClick={() => {
                    initializeAudioContext();
                    onAdjust(15);
                  }}
                  type="button"
                >
                  +15s
                </button>
              </>
            ) : null}
            <button
              aria-pressed={muted}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-slate-300 px-4 text-sm font-semibold text-slate-700"
              onClick={() => {
                initializeAudioContext();
                onMuteToggle();
              }}
              type="button"
            >
              {muted ? "Unmute alerts" : "Mute alerts"}
            </button>
            <button
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-slate-300 px-4 text-sm font-semibold text-slate-700"
              onClick={() => {
                onCloseExpanded();
                onDismiss();
              }}
              type="button"
            >
              Skip rest
            </button>
          </div>
        </section>
      </SlideUpSheet>
    </>
  );
}
