import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RestTimer } from "./RestTimer";

function makeTimerProps(durationSeconds: number) {
  const startedAtMs = Date.now();
  return {
    startedAtMs,
    endAtMs: startedAtMs + durationSeconds * 1000,
    onDismiss: vi.fn(),
    muted: false,
    onMuteToggle: vi.fn(),
    expanded: false,
    onExpand: vi.fn(),
    onCloseExpanded: vi.fn(),
  };
}

describe("RestTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    HTMLDialogElement.prototype.showModal = vi.fn(function showModal(this: HTMLDialogElement) {
      this.open = true;
    });
    HTMLDialogElement.prototype.close = vi.fn(function close(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event("close"));
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("renders a compact HUD by default and hides expanded controls", () => {
    render(<RestTimer {...makeTimerProps(60)} onAdjust={vi.fn()} />);

    expect(screen.getByTestId("rest-timer-hud")).toBeInTheDocument();
    expect(screen.getByTestId("rest-timer-progress")).toBeInTheDocument();
    expect(screen.queryByTestId("rest-timer-expanded-controls")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mute alerts" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+15s" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Skip rest" })).not.toBeInTheDocument();
  });

  it("opens expanded controls on demand", () => {
    render(<RestTimer {...makeTimerProps(60)} onAdjust={vi.fn()} expanded={true} />);

    expect(screen.getByTestId("rest-timer-expanded-controls")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mute alerts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+15s" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip rest" })).toBeInTheDocument();
  });

  it("calls onExpand when the compact HUD is tapped", async () => {
    const onExpand = vi.fn();
    render(<RestTimer {...makeTimerProps(60)} onExpand={onExpand} />);

    fireEvent.click(screen.getByTestId("rest-timer-hud"));

    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it("reconciles against wall clock when returning visible after background delay", () => {
    render(<RestTimer {...makeTimerProps(60)} />);

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

    render(<RestTimer {...makeTimerProps(1)} onDismiss={dismiss} />);

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

    render(<RestTimer {...makeTimerProps(1)} />);

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

    render(<RestTimer {...makeTimerProps(1)} />);

    fireEvent(document, new Event("pointerdown"));
    vi.setSystemTime(new Date("2026-01-01T00:00:01.000Z"));
    vi.advanceTimersByTime(300);
    await Promise.resolve();

    expect(resume).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("does not restart from parent rerenders when callbacks change identity", () => {
    const props = makeTimerProps(60);
    const { rerender } = render(<RestTimer {...props} />);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    vi.setSystemTime(new Date("2026-01-01T00:00:10.000Z"));
    fireEvent(document, new Event("visibilitychange"));
    expect(screen.getByText("0:50")).toBeInTheDocument();

    rerender(<RestTimer {...props} onDismiss={vi.fn()} onExpand={vi.fn()} onCloseExpanded={vi.fn()} />);

    expect(screen.getByText("0:50")).toBeInTheDocument();
  });

  it("preserves elapsed time when adjusted", () => {
    const start = Date.now();
    const { rerender } = render(
      <RestTimer
        startedAtMs={start}
        endAtMs={start + 60_000}
        onDismiss={vi.fn()}
        onAdjust={vi.fn()}
        muted={false}
        onMuteToggle={vi.fn()}
        expanded={false}
        onExpand={vi.fn()}
        onCloseExpanded={vi.fn()}
      />
    );

    vi.advanceTimersByTime(10_300);
    rerender(
      <RestTimer
        startedAtMs={start}
        endAtMs={start + 75_000}
        onDismiss={vi.fn()}
        onAdjust={vi.fn()}
        muted={false}
        onMuteToggle={vi.fn()}
        expanded={false}
        onExpand={vi.fn()}
        onCloseExpanded={vi.fn()}
      />
    );

    expect(screen.getByText("1:05")).toBeInTheDocument();
  });

  it("mute button calls onMuteToggle prop", () => {
    const onMuteToggle = vi.fn();
    render(<RestTimer {...makeTimerProps(60)} onMuteToggle={onMuteToggle} expanded={true} />);

    fireEvent.click(screen.getByRole("button", { name: "Mute alerts" }));
    expect(onMuteToggle).toHaveBeenCalledTimes(1);
  });

  it("adjust buttons call onAdjust with 15-second deltas", () => {
    const onAdjust = vi.fn();
    render(<RestTimer {...makeTimerProps(60)} onAdjust={onAdjust} expanded={true} />);

    fireEvent.click(screen.getByRole("button", { name: "-15s" }));
    fireEvent.click(screen.getByRole("button", { name: "+15s" }));

    expect(onAdjust).toHaveBeenNthCalledWith(1, -15);
    expect(onAdjust).toHaveBeenNthCalledWith(2, 15);
  });

  it("skip rest calls dismiss and closes the expanded sheet", () => {
    const onDismiss = vi.fn();
    const onCloseExpanded = vi.fn();
    render(
      <RestTimer
        {...makeTimerProps(60)}
        onDismiss={onDismiss}
        onCloseExpanded={onCloseExpanded}
        expanded={true}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Skip rest" }));

    expect(onCloseExpanded).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("shows Unmute alerts when muted prop is true", () => {
    render(<RestTimer {...makeTimerProps(60)} muted={true} onMuteToggle={vi.fn()} expanded={true} />);

    expect(screen.getByRole("button", { name: "Unmute alerts" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mute alerts" })).not.toBeInTheDocument();
  });
});
