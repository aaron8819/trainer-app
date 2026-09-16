'use client';
import { useCallback, useEffect, useRef, useState, Fragment, type ReactNode } from 'react';
import { z } from 'zod';
import { validateExecutionRead, nextWorkoutRead, startOccurrenceCommand, startResponse,
  type ExecutionRead, type StartOccurrenceCommand } from '@/lib/trainer2-contracts/execution';
import type { DraftDocument } from '@/lib/trainer2-contracts/draft';
import { canonicalJson } from '@/lib/trainer2-contracts/canonical-json';
import { SkipWorkout } from './SkipWorkout';
import type { SkipOccurrenceCommand } from '@/lib/trainer2-contracts/skip-occurrence';
import { DiscardWorkout } from './DiscardWorkout';
import { FinishWorkout } from './FinishWorkout';
import { restKey } from './rest-state';
import { ActiveWorkout } from './ActiveWorkout';
import { SetResultRow, resultLabel } from './SetResultRow';
import { control } from './DraftEditor';
import { TrainingOverview, PlannedWorkout } from './TrainingOverview';
import { effortSummary, targetLabel, trainingUrl } from './training-summary';

export function WorkoutPrescription({ workout, resultRow, previous }: { workout: DraftDocument['occurrences'][number]; resultRow?: (positionId: string, targetId: string, number: number) => ReactNode; previous?: (positionId: string) => ReactNode }) {
  if (!resultRow) return <PlannedWorkout workout={workout} />;
  return <div className="space-y-4"><h3 className="text-xl font-semibold">{workout.name}</h3>{workout.positions.map(p =>
    <section key={p.id} className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4"><div className="flex flex-wrap justify-between gap-1"><h4 className="font-semibold">{p.exercise.name}{p.exercise.variation ? ' · ' + p.exercise.variation : ''}</h4><span className="text-xs text-slate-500">{p.role}</span></div>
      {previous?.(p.id)}
      <ol className="mt-3 divide-y divide-slate-100">{p.targets.map((t, i) => <li key={t.id} className="py-2 text-sm">
        <p className="text-xs text-slate-500">Set {i + 1} · {targetLabel(t)}</p>{resultRow(p.id, t.id, i + 1)}
      </li>)}</ol></section>)}</div>;
}

export function Workout({ accountId, ownershipEpoch, planId, executionId, onPlanComplete, document, program = false }: { accountId: string; ownershipEpoch: number; planId?: string; executionId?: string; onPlanComplete?: () => void; document?: DraftDocument; program?: boolean }) {
  const [next, setNext] = useState<z.infer<typeof nextWorkoutRead> | null>(null);
  const [execution, setExecution] = useState<ExecutionRead | null>(null);
  const [pending, setPending] = useState<StartOccurrenceCommand | null>(null);
  const [busy, setBusy] = useState(false), [skipLocked, setSkipLocked] = useState(true);
  const [message, setMessage] = useState('Loading workout…');
  const [finishedMessage, setFinishedMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [inputStates, setInputStates] = useState<Record<string, boolean>>({}), [finishLocked, setFinishLocked] = useState(false), [discardLocked, setDiscardLocked] = useState(false);
  const onInputState = useCallback((targetId: string, blocked: boolean) => setInputStates(current => current[targetId] === blocked ? current : { ...current, [targetId]: blocked }), []);
  useEffect(() => {
    if (execution && execution.lifecycle !== 'Open') {
      try { localStorage.removeItem(restKey(accountId, execution.executionId)); } catch { /* Advisory storage only. */ }
    }
  }, [accountId, execution]);
  const generation = useRef(0), inFlight = useRef(false), latestNextSequence = useRef('0');
  const storageKey = `trainer2-start:${accountId}:${planId}`;
  const url = (id: string) => `/trainer2/dev/executions/${id}`;
  async function load(token = ++generation.current, expectedSkip?: SkipOccurrenceCommand, skipCompleted?: boolean) {
    setFailed(false);
    try {
      const response = await fetch(executionId ? `/api/trainer2/executions/${executionId}` : `/api/trainer2/plans/${planId}/next`, { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error === 'INVALID_START_SNAPSHOT' ? 'The saved workout prescription is unavailable. It cannot be rebuilt safely.' : 'Could not load this workout. Reload to try again.');
      if (executionId) {
        const value = await validateExecutionRead(body, accountId, executionId);
        if (token === generation.current) setExecution(current => current && current.lifecycle !== 'Open' && value.lifecycle === 'Open' ? current : current ? { ...value, history: [...(value.history ?? []), ...(current.history ?? []).filter(p => !value.history?.some(r => r.targetId === p.targetId && r.version === p.version))], results: value.results.map(r => { const prior = current.results.find(p => p.targetId === r.targetId); return prior && prior.version > r.version ? prior : r; }).concat(current.results.filter(p => !value.results.some(r => r.targetId === p.targetId))) } : value);
        if (token === generation.current) setMessage('');
        return value;
      } else {
        const value = nextWorkoutRead.parse(body);
        if (value.accountId !== accountId || value.planId !== planId || (value.execution && value.execution.initial.accountId !== accountId)) throw new Error('Invalid workout response');
        if (value.execution) await validateExecutionRead(value.execution, accountId);
        if (expectedSkip && (BigInt(value.acceptedSequence) <= BigInt(expectedSkip.expected.acceptedSequence) || !value.occurrences.some(o => o.occurrenceId === expectedSkip.target.occurrenceId &&
          o.status === 'Skipped' && o.skip?.actionId === expectedSkip.actionId && o.skip.revisionId === expectedSkip.expected.planRevisionId && o.skip.planCompleted === skipCompleted)))
          throw new Error('Skip readback could not be confirmed.');
        if (token !== generation.current || BigInt(value.acceptedSequence) < BigInt(latestNextSequence.current)) throw new Error('Superseded workout read');
        latestNextSequence.current = value.acceptedSequence;
        if (value.lifecycle === 'Completed') onPlanComplete?.();
        setNext(value);
        const receiptKey = 'trainer2-finished:' + accountId + ':' + planId;
        const finishedId = sessionStorage.getItem(receiptKey);
        if (finishedId && value.occurrences.some(o => o.executionId === finishedId && o.status === 'Finished')) { setFinishedMessage(finishedId); sessionStorage.removeItem(receiptKey); }
        setMessage('');
        return value;
      }
      if (token === generation.current) setMessage('');
    } catch (error) { if (token === generation.current) { setFailed(true); setMessage(error instanceof Error ? error.message : 'Could not load workout.'); } }
  }
  useEffect(() => {
    const token = ++generation.current;
    try {
      const stored = planId && sessionStorage.getItem(storageKey);
      if (stored) {
        const command = startOccurrenceCommand.parse(JSON.parse(stored));
        if (command.originatingAccountId !== accountId || command.target.planId !== planId) throw new Error('Invalid pending request');
        setPending(command); setMessage('Start could not be confirmed. Check again to recover the original request.');
      } else void load(token);
    } catch { setFailed(true); setMessage('The saved start request could not be read. Reload to recover it.'); }
    // This is a request counter, not a DOM ref; invalidate the latest read on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { ++generation.current; };
    // Parent keys this component by account and subject; pending command survives reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function submit(command: StartOccurrenceCommand) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    const token = generation.current;
    try { sessionStorage.setItem(storageKey, canonicalJson(command)); }
    catch { inFlight.current = false; setBusy(false); setFailed(true); setMessage('Browser storage is unavailable. Enable it and reload before starting.'); return; }
    try {
      setPending(command); setMessage('Starting workout…');
      const response = await fetch('/api/trainer2/executions/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: canonicalJson(command) });
      const parsed = startResponse.parse(await response.json());
      if (token !== generation.current) return;
      const out = parsed.outcome;
      if (out.actionId !== command.actionId || (out.status === 'Accepted' && (!response.ok || out.result.planId !== planId || out.result.revisionId !== command.expected.planRevisionId || out.result.occurrenceId !== command.target.occurrenceId))) throw new Error('Unbound outcome');
      sessionStorage.removeItem(storageKey); setPending(null);
      if (out.status === 'Accepted') { window.location.assign(url(out.result.executionId)); return; }
      setFailed(true); setMessage(out.code === 'ALREADY_STARTED' ? 'This workout has already started. Reload to continue it.' : out.code === 'UNRESOLVED_EXCLUSION' ? 'An exercise exclusion prevents starting. Review your exclusions before trying again.' : 'The workout state changed or this start is unavailable. Reload the current workout.');
    } catch { if (token === generation.current) setMessage('Start could not be confirmed. Check again to recover the original request.'); }
    finally { inFlight.current = false; if (token === generation.current) setBusy(false); }
  }
  function start() {
    if (!next?.occurrence || busy || pending || failed || skipLocked) return;
    const command: StartOccurrenceCommand = { schemaVersion: 1, commandType: 'StartOccurrence', actionId: crypto.randomUUID(),
      deviceId: crypto.randomUUID(), originatingAccountId: accountId, ownershipEpoch, dependsOn: [],
      target: { planId: next.planId, occurrenceId: next.occurrence.id }, expected: { planRevisionId: next.revisionId, instructionEpoch: next.instructionEpoch }, intent: {} };
    void submit(command);
  }
  const lastSkipped = next?.occurrences.filter(o => o.status === 'Skipped').at(-1);
  return <div className="space-y-4">{finishedMessage && <p role="status" className="rounded-xl bg-teal-100 p-4 text-teal-950">Workout finished. <a className="underline" href={url(finishedMessage)}>View saved results</a></p>}{message && <p role="status">{message}</p>}
    {pending && <button className={control} disabled={busy} onClick={() => void submit(pending)}>Check again</button>}
    {failed && !pending && <button className={control} onClick={() => void load()}>Reload workout</button>}
    {next && document && !execution && <TrainingOverview document={document} next={next} program={program} />}
    {execution && <section className="space-y-2"><h2 className="text-xl font-semibold">{execution.lifecycle === 'Discarded' ? 'Workout attempt discarded' : execution.lifecycle === 'Finished' ? 'Workout finished' : execution.initial.occurrence.name}</h2>
      <p className="text-slate-600">{execution.lifecycle === 'Discarded' ? 'This attempt was discarded. Its original start and prescription are retained. Discarding this attempt did not complete or skip the scheduled workout.' : execution.lifecycle === 'Finished' ? 'Latest saved results appear below. Corrections preserve completion and the original targets. Result history shows what was acknowledged at finish.' : ''}</p>
      {execution.discard && <p>Started {execution.initial.startedAt}. Discarded {execution.discard.discardedAt}.</p>}
      {execution.finish && <p className="text-sm text-slate-600">Started {execution.initial.startedAt}. Finished {execution.finish.finishedAt}. Later correction times appear in result history.</p>}
      <p className="font-medium text-teal-800">{execution.initial.stage.name} · {effortSummary(execution.initial.occurrence)}</p><a className="inline-block min-h-11 py-2 text-sm text-teal-800 underline" href={trainingUrl(execution.initial.planId)}>Back to training</a>

      {execution.lifecycle === 'Open' ? <ActiveWorkout key={`active:${execution.executionId}`} execution={execution} ownershipEpoch={ownershipEpoch} locked={finishLocked || discardLocked} inputStates={inputStates} onInputState={onInputState}
        refresh={async () => { const value = await load(); if (!value || !('results' in value)) throw new Error('Read failed'); return value.results; }} /> : <WorkoutPrescription workout={execution.initial.occurrence} previous={positionId => {
        const prior = execution.previous?.find(p => p.positionId === positionId);
        return prior ? <aside className="mt-2 rounded-lg bg-teal-50 p-3 text-xs text-teal-950"><a className="font-semibold underline" href={url(prior.executionId)}>Previous · {prior.workoutName} · {new Date(prior.finishedAt).toLocaleDateString()}</a><p className="mt-1">Previous exercise results · latest corrections</p><ul>{prior.results.map(r => <li key={r.targetId}>{resultLabel(r.result)}</li>)}</ul></aside> : <p className="mt-2 text-xs text-slate-500">No comparable previous performance.</p>;
      }} resultRow={(positionId, targetId, number) => {
        const owned = execution.initial.positions.find(p => p.sourcePositionId === positionId)!.targets.find(t => t.sourceTargetId === targetId)!;
        const refresh = async () => { const value = await load(); if (!value || !('results' in value)) throw new Error('Read failed'); return value.results; };
        const saved = execution.results.find(r => r.targetId === owned.id);
        return <Fragment key={owned.id}><SetResultRow key="ongoing" accountId={accountId} ownershipEpoch={ownershipEpoch} executionId={execution.executionId}
          readOnly={execution.lifecycle !== 'Open'} retainedOnly={execution.lifecycle !== 'Open'} locked={finishLocked || discardLocked} onInputState={onInputState} targetId={owned.id} number={number} saved={saved} prescription={execution.initial.occurrence.positions.find(p => p.id === positionId)!.targets.find(t => t.id === targetId)} exercise={execution.initial.occurrence.positions.find(p => p.id === positionId)!.exercise} refresh={refresh} />
          {execution.lifecycle === 'Finished' && <SetResultRow key="historical" accountId={accountId} ownershipEpoch={ownershipEpoch} executionId={execution.executionId}
            historical history={execution.history?.filter(r => r.targetId === owned.id)} finishVersion={execution.finish?.expected.results.find(r => r.targetId === owned.id)?.resultVersion}
            targetId={owned.id} number={number} saved={saved} refresh={refresh} />}</Fragment>;
      }} />}
      <FinishWorkout key={execution.executionId} execution={execution} ownershipEpoch={ownershipEpoch}
        blocked={discardLocked || execution.initial.positions.some(p => p.targets.some(t => inputStates[t.id] !== false))}
        onFinished={() => { try { localStorage.removeItem(restKey(accountId, execution.executionId)); sessionStorage.setItem('trainer2-finished:' + accountId + ':' + execution.initial.planId, execution.executionId); } catch { /* Completion is already confirmed; navigation remains safe. */ } window.location.assign(trainingUrl(execution.initial.planId)); }} onLock={setFinishLocked} checkResults={async () => { if (!await load()) throw new Error('Read failed'); }} refresh={async () => { const value = await load(); if (!value || value.lifecycle !== 'Finished') throw new Error('Completion read failed'); }} />
      <DiscardWorkout key={`discard:${execution.executionId}`} execution={execution} ownershipEpoch={ownershipEpoch}
        blocked={finishLocked || execution.initial.positions.some(p => p.targets.some(t => inputStates[t.id] !== false))}
        onLock={setDiscardLocked} checkResults={async () => { if (!await load()) throw new Error('Read failed'); }} refresh={async () => { const value = await load(); if (!value || value.lifecycle !== 'Discarded') throw new Error('Discard read failed'); }} />
      </section>}
    {next && !execution && !pending && !program && <section className="space-y-3">
      {next.execution ? <><h2 className="text-xl font-semibold">Workout in progress</h2><p>{next.execution.initial.occurrence.name}</p><a className={control} href={url(next.execution.executionId)}>Continue workout</a></> :
        !next.occurrence ? <><h2 className="text-xl font-semibold">Plan complete</h2><p>No next workout.</p></> :
          <><p className="text-sm font-medium text-slate-500">Next workout</p><h2 className="text-xl font-semibold">{next.occurrence.name}</h2><p> {next.occurrence.positions.length} exercises - {next.occurrence.positions.reduce((n, p) => n + p.targets.length, 0)} sets</p></>}
      <div className="flex flex-wrap items-start gap-3">
        {next.occurrence && !next.execution && <button className="rounded-xl bg-teal-700 px-5 py-3 font-semibold text-white disabled:opacity-40" disabled={busy || failed || skipLocked} onClick={start}>Start workout</button>}
        <SkipWorkout key={`skip:${accountId}:${next.planId}`} next={next} ownershipEpoch={ownershipEpoch}
          blocked={busy || failed} onLock={setSkipLocked} refresh={async (command, planCompleted) => {
            const value = await load(undefined, command, planCompleted); if (!value || !('occurrences' in value)) throw new Error('Plan read failed');
          }} />
      </div>
      {(next.execution?.initial.occurrence ?? next.occurrence) && <PlannedWorkout workout={(next.execution?.initial.occurrence ?? next.occurrence)!} />}
    </section>}
    {lastSkipped && !program && !execution && <p>Skipped: {lastSkipped.name}, {lastSkipped.stageName}.</p>}

  </div>;
}
