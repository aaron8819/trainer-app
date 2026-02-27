"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type RestTimerProps = {
  durationSeconds: number;
  onDismiss: () => void;
  onAdjust?: (deltaSeconds: number) => void;
  compact?: boolean;
  muted: boolean;
  onMuteToggle: () => void;
};

export function RestTimer({ durationSeconds, onDismiss, onAdjust, compact, muted, onMuteToggle }: RestTimerProps) {
  const [remaining, setRemaining] = useState(durationSeconds);
  // Mirror muted into a ref so playCompletionAlert can read it without restarting the timer
  const mutedRef = useRef(muted);
  const endAtRef = useRef<number>(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const completedRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

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
      onDismiss();
    }
  }, [clearTimer, onDismiss, playCompletionAlert]);

  useEffect(() => {
    completedRef.current = false;
    endAtRef.current = Date.now() + durationSeconds * 1000;
    clearTimer();
    intervalRef.current = setInterval(tick, 250);
    const initialTickTimeout = setTimeout(() => {
      tick();
    }, 0);
    return () => {
      clearTimeout(initialTickTimeout);
      clearTimer();
    };
  }, [clearTimer, durationSeconds, tick]);

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
  const progress = durationSeconds > 0 ? remaining / durationSeconds : 0;

  if (compact) {
    return (
      <div
        className="fixed left-0 right-0 top-0 z-50 flex items-center justify-between bg-slate-900 px-4 py-2 text-white"
        data-testid="compact-timer-banner"
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">Rest</p>
        <p className="text-2xl font-bold tabular-nums">
          {minutes}:{String(seconds).padStart(2, "0")}
        </p>
        <button
          className="inline-flex min-h-9 items-center justify-center rounded-full border border-slate-600 px-3 text-sm font-semibold text-white"
          onClick={onDismiss}
          type="button"
        >
          Skip
        </button>
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center sm:p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rest</p>
      <p className="mt-2 text-4xl font-bold tabular-nums text-slate-900">
        {minutes}:{String(seconds).padStart(2, "0")}
      </p>
      <div className="mx-auto mt-3 h-1.5 w-32 overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-slate-900 transition-all duration-1000"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      {onAdjust ? (
        <div className="mt-4 flex items-center justify-center gap-2">
          <button
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-slate-300 px-3 text-sm font-semibold text-slate-700"
            onClick={() => {
              initializeAudioContext();
              onAdjust(-15);
            }}
            type="button"
          >
            -15s
          </button>
          <button
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-slate-300 px-3 text-sm font-semibold text-slate-700"
            onClick={() => {
              initializeAudioContext();
              onAdjust(15);
            }}
            type="button"
          >
            +15s
          </button>
        </div>
      ) : null}
      <button
        aria-pressed={muted}
        className="mt-3 inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-slate-300 px-4 text-sm font-semibold text-slate-700"
        onClick={() => {
          initializeAudioContext();
          onMuteToggle();
        }}
        type="button"
      >
        {muted ? "Unmute alerts" : "Mute alerts"}
      </button>
      <button
        className="mt-4 inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-slate-300 px-4 text-sm font-semibold text-slate-700"
        onClick={onDismiss}
        type="button"
      >
        Skip rest
      </button>
    </section>
  );
}
