'use client';
import { useCallback, useEffect, useRef, useState, Fragment, type ReactNode } from 'react';
import { z } from 'zod';
import { validateExecutionRead, nextWorkoutRead, startOccurrenceCommand, startResponse,
  type ExecutionRead, type StartOccurrenceCommand } from '@/lib/trainer2-contracts/execution';
import type { DraftDocument } from '@/lib/trainer2-contracts/draft';
import { canonicalJson } from '@/lib/trainer2-contracts/canonical-json';
import { FinishWorkout } from './FinishWorkout';
import { SetResultRow } from './SetResultRow';
import { control } from './DraftEditor';

export function WorkoutPrescription({ workout, resultRow }: { workout: DraftDocument['occurrences'][number]; resultRow?: (positionId: string, targetId: string, number: number) => ReactNode }) {
  return <div className="space-y-4"><h3 className="text-xl font-semibold">{workout.name}</h3>{workout.positions.map(p =>
    <section key={p.id} className="rounded-xl border border-slate-200 bg-white p-4"><h4 className="font-semibold">{p.exercise.name}{p.exercise.variation ? ` · ${p.exercise.variation}` : ''}</h4>
      {p.role && <p className="text-sm text-slate-500">{p.role}</p>}
      <ol className="mt-3 space-y-2">{p.targets.map((t, i) => <li key={t.id} className="text-sm">
        <span className="font-medium">Set {i + 1}</span> · {t.classification === 'working' ? 'Working' : t.classification === 'rampUp' ? 'Ramp-up' : t.classification === 'preparation' ? 'Preparation' : 'Finisher'}{!t.required ? ' · Optional' : ''}
        <div>{t.reps.min}–{t.reps.max} reps{t.reps.basis === 'perSide' ? ' per side' : t.reps.basis === 'alternating' ? ' alternating' : ''} · {t.measurement === null ? 'Load unspecified' : t.measurement.kind === 'bodyweight' ? 'Bodyweight' : `${t.measurement.value} ${t.measurement.unit} ${t.measurement.kind === 'assistance' ? 'assistance' : t.measurement.kind === 'addedLoad' ? 'added' : t.measurement.convention === 'perImplement' ? 'per implement' : t.measurement.convention === 'barbellTotal' ? 'barbell total' : 'machine displayed'}`}</div>
        <div className="text-slate-600">{t.rir === null ? 'Effort unspecified' : `${t.rir} reps left`} · {t.restSeconds === null ? 'Rest unspecified' : `${t.restSeconds}s rest`}</div>
        {resultRow?.(p.id, t.id, i + 1)}
      </li>)}</ol></section>)}</div>;
}
export function Workout({ accountId, ownershipEpoch, planId, executionId }: { accountId: string; ownershipEpoch: number; planId?: string; executionId?: string }) {
  const [next, setNext] = useState<z.infer<typeof nextWorkoutRead> | null>(null);
  const [execution, setExecution] = useState<ExecutionRead | null>(null);
  const [pending, setPending] = useState<StartOccurrenceCommand | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Loading workout…');
  const [failed, setFailed] = useState(false);
  const [inputStates, setInputStates] = useState<Record<string, boolean>>({}), [finishLocked, setFinishLocked] = useState(false);
  const onInputState = useCallback((targetId: string, blocked: boolean) => setInputStates(current => current[targetId] === blocked ? current : { ...current, [targetId]: blocked }), []);
  const generation = useRef(0), inFlight = useRef(false);
  const storageKey = `trainer2-start:${accountId}:${planId}`;
  const url = (id: string) => `/trainer2/dev/executions/${id}`;
  async function load(token = generation.current) {
    setFailed(false);
    try {
      const response = await fetch(executionId ? `/api/trainer2/executions/${executionId}` : `/api/trainer2/plans/${planId}/next`, { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error === 'INVALID_START_SNAPSHOT' ? 'The saved workout prescription is unavailable. It cannot be rebuilt safely.' : 'Could not load this workout. Reload to try again.');
      if (executionId) {
        const value = await validateExecutionRead(body, accountId, executionId);
        if (token === generation.current) setExecution(current => current?.lifecycle === 'Finished' && value.lifecycle === 'Open' ? current : current ? { ...value, history: [...(value.history ?? []), ...(current.history ?? []).filter(p => !value.history?.some(r => r.targetId === p.targetId && r.version === p.version))], results: value.results.map(r => { const prior = current.results.find(p => p.targetId === r.targetId); return prior && prior.version > r.version ? prior : r; }).concat(current.results.filter(p => !value.results.some(r => r.targetId === p.targetId))) } : value);
        if (token === generation.current) setMessage('');
        return value;
      } else {
        const value = nextWorkoutRead.parse(body);
        if (value.accountId !== accountId || value.planId !== planId || (value.execution && value.execution.initial.accountId !== accountId)) throw new Error('Invalid workout response');
        if (value.execution) await validateExecutionRead(value.execution, accountId);
        if (token === generation.current) setNext(value);
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
    return () => { generation.current = token + 1; };
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
    if (!next?.occurrence || busy || pending || failed) return;
    const command: StartOccurrenceCommand = { schemaVersion: 1, commandType: 'StartOccurrence', actionId: crypto.randomUUID(),
      deviceId: crypto.randomUUID(), originatingAccountId: accountId, ownershipEpoch, dependsOn: [],
      target: { planId: next.planId, occurrenceId: next.occurrence.id }, expected: { planRevisionId: next.revisionId, instructionEpoch: next.instructionEpoch }, intent: {} };
    void submit(command);
  }
  return <div className="space-y-4">{message && <p role="status">{message}</p>}
    {pending && <button className={control} disabled={busy} onClick={() => void submit(pending)}>Check again</button>}
    {failed && !pending && <button className={control} onClick={() => void load()}>Reload workout</button>}
    {execution && <section className="space-y-4"><h2 className="text-2xl font-semibold">{execution.lifecycle === 'Finished' ? 'Workout finished' : 'Workout in progress'}</h2>
      <p className="text-slate-600">{execution.lifecycle === 'Finished' ? 'Latest saved results appear below. Corrections preserve completion and the original targets. Result history shows what was acknowledged at finish.' : 'Original targets stay saved. Record what you performed; logging sets does not finish the workout.'}</p>
      {execution.finish && <p className="text-sm text-slate-600">Started {execution.initial.startedAt}. Finished {execution.finish.finishedAt}. Later correction times appear in result history.</p>}
      <a className={control} href="/trainer2/dev/drafts">Trainer2 plans</a>
      <button className={control} onClick={() => void load()}>Refresh saved results</button>
      <WorkoutPrescription workout={execution.initial.occurrence} resultRow={(positionId, targetId, number) => {
        const owned = execution.initial.positions.find(p => p.sourcePositionId === positionId)!.targets.find(t => t.sourceTargetId === targetId)!;
        const refresh = async () => { const value = await load(); if (!value) throw new Error('Read failed'); return value.results; };
        const saved = execution.results.find(r => r.targetId === owned.id);
        return <Fragment key={owned.id}><SetResultRow key="ongoing" accountId={accountId} ownershipEpoch={ownershipEpoch} executionId={execution.executionId}
          readOnly={execution.lifecycle === 'Finished'} retainedOnly={execution.lifecycle === 'Finished'} locked={finishLocked} onInputState={onInputState} targetId={owned.id} number={number} saved={saved} refresh={refresh} />
          {execution.lifecycle === 'Finished' && <SetResultRow key="historical" accountId={accountId} ownershipEpoch={ownershipEpoch} executionId={execution.executionId}
            historical history={execution.history?.filter(r => r.targetId === owned.id)} finishVersion={execution.finish?.expected.results.find(r => r.targetId === owned.id)?.resultVersion}
            targetId={owned.id} number={number} saved={saved} refresh={refresh} />}</Fragment>;

      }} />
      <FinishWorkout key={execution.executionId} execution={execution} ownershipEpoch={ownershipEpoch}
        blocked={execution.initial.positions.some(p => p.targets.some(t => inputStates[t.id] !== false))}
        onLock={setFinishLocked} refresh={async () => { const value = await load(); if (!value || value.lifecycle !== 'Finished') throw new Error('Completion read failed'); }} />
      {execution.lifecycle === 'Finished' && <Workout key={`next:${execution.executionId}`} accountId={accountId} ownershipEpoch={ownershipEpoch} planId={execution.initial.planId} />}
      </section>}
    {next && !execution && !pending && (next.execution ? <><h2 className="text-xl font-semibold">Workout in progress</h2><p>{next.execution.initial.occurrence.name}</p><a className={control} href={url(next.execution.executionId)}>Continue workout</a></> : !next.occurrence ? <><h2 className="text-xl font-semibold">Plan complete</h2><p>No next workout.</p></> : <><h2 className="text-xl font-semibold">Next workout</h2><p>{next.occurrence.name} · {next.occurrence.positions.length} exercises · {next.occurrence.positions.reduce((n, p) => n + p.targets.length, 0)} sets</p><button className="rounded-xl bg-teal-700 px-5 py-3 font-semibold text-white disabled:opacity-40" disabled={busy || failed} onClick={start}>Start workout</button><details><summary>Prescription preview</summary><WorkoutPrescription workout={next.occurrence} /></details></>)}
  </div>;
}
