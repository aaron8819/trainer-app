import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RestTimer } from "./RestTimer";

describe("RestTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("reconciles against wall clock when returning visible after background delay", () => {
    render(<RestTimer durationSeconds={60} onDismiss={vi.fn()} muted={false} onMuteToggle={vi.fn()} />);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    vi.setSystemTime(new Date("2026-01-01T00:00:30.000Z"));
    fireEvent(document, new Event("visibilitychange"));

    expect(screen.getByText("0:30")).toBeInTheDocument();
  });

  it("calls vibrate when rest ends and vibration is supported", () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: vibrate,
    });
    const dismiss = vi.fn();

    render(<RestTimer durationSeconds={1} onDismiss={dismiss} muted={false} onMuteToggle={vi.fn()} />);

    vi.setSystemTime(new Date("2026-01-01T00:00:01.000Z"));
    vi.advanceTimersByTime(300);

    expect(vibrate).toHaveBeenCalledWith([200, 100, 200]);
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("plays audio tone when vibration is unavailable", () => {
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: undefined,
    });

    const start = vi.fn();
    const stop = vi.fn();
    const connect = vi.fn();
    const setValueAtTime = vi.fn();
    const exponentialRampToValueAtTime = vi.fn();
    const oscillator = {
      type: "sine",
      frequency: { value: 0 },
      connect,
      start,
      stop,
    };
    const gain = {
      gain: { setValueAtTime, exponentialRampToValueAtTime },
      connect,
    };

    class MockAudioContext {
      public currentTime = 0;
      public destination = {};
      public createOscillator = () => oscillator;
      public createGain = () => gain;
      public close = vi.fn().mockResolvedValue(undefined);
    }

    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: MockAudioContext,
    });

    render(<RestTimer durationSeconds={1} onDismiss={vi.fn()} muted={false} onMuteToggle={vi.fn()} />);

    fireEvent(document, new Event("pointerdown"));
    vi.setSystemTime(new Date("2026-01-01T00:00:01.000Z"));
    vi.advanceTimersByTime(300);

    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("resumes suspended AudioContext before playing completion tone", async () => {
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: undefined,
    });

    const start = vi.fn();
    const stop = vi.fn();
    const connect = vi.fn();
    const setValueAtTime = vi.fn();
    const exponentialRampToValueAtTime = vi.fn();
    const resume = vi.fn().mockResolvedValue(undefined);
    const oscillator = { type: "sine", frequency: { value: 0 }, connect, start, stop };
    const gain = { gain: { setValueAtTime, exponentialRampToValueAtTime }, connect };

    class MockSuspendedAudioContext {
      public currentTime = 0;
      public state = "suspended";
      public destination = {};
      public createOscillator = () => oscillator;
      public createGain = () => gain;
      public resume = resume;
      public close = vi.fn().mockResolvedValue(undefined);
    }

    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: MockSuspendedAudioContext,
    });

    render(<RestTimer durationSeconds={1} onDismiss={vi.fn()} muted={false} onMuteToggle={vi.fn()} />);

    fireEvent(document, new Event("pointerdown"));
    vi.setSystemTime(new Date("2026-01-01T00:00:01.000Z"));
    vi.advanceTimersByTime(300);
    await Promise.resolve(); // flush microtasks so resume().then(playTone) fires

    expect(resume).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
  });
});

describe("RestTimer — compact mode", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("renders compact fixed banner when compact is true", () => {
    render(
      <RestTimer
        durationSeconds={60}
        onDismiss={vi.fn()}
        muted={false}
        onMuteToggle={vi.fn()}
        compact={true}
      />
    );

    expect(screen.getByTestId("compact-timer-banner")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Mute|Unmute/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+15s" })).not.toBeInTheDocument();
  });

  it("renders full card when compact is false", () => {
    render(
      <RestTimer
        durationSeconds={60}
        onDismiss={vi.fn()}
        muted={false}
        onMuteToggle={vi.fn()}
        onAdjust={vi.fn()}
        compact={false}
      />
    );

    expect(screen.queryByTestId("compact-timer-banner")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mute alerts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+15s" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip rest" })).toBeInTheDocument();
  });

  it("mute button calls onMuteToggle prop", () => {
    const onMuteToggle = vi.fn();
    render(
      <RestTimer
        durationSeconds={60}
        onDismiss={vi.fn()}
        muted={false}
        onMuteToggle={onMuteToggle}
        compact={false}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Mute alerts" }));
    expect(onMuteToggle).toHaveBeenCalledTimes(1);
  });

  it("shows Unmute alerts when muted prop is true", () => {
    render(
      <RestTimer
        durationSeconds={60}
        onDismiss={vi.fn()}
        muted={true}
        onMuteToggle={vi.fn()}
        compact={false}
      />
    );

    expect(screen.getByRole("button", { name: "Unmute alerts" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mute alerts" })).not.toBeInTheDocument();
  });
});
