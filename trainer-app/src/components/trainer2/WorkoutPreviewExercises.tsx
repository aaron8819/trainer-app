'use client';

import { useState } from 'react';
import { exerciseTitle } from './exercise-title';
import { targetGroups, type WorkoutIntent } from './training-summary';
import styles from './TrainingOverview.module.css';

export function WorkoutPreviewExercises({ workout }: { workout: WorkoutIntent }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const allOpen = workout.positions.length > 0 && expanded.size === workout.positions.length;
  const listId = `preview-exercises-${workout.id}`;
  return <section aria-label="Planned workout">
    <div className={styles.exerciseHeading}>
      <h3>Exercises</h3>
      <button type="button" aria-controls={listId} aria-expanded={allOpen}
        onClick={() => setExpanded(allOpen ? new Set() : new Set(workout.positions.map(p => p.id)))}>
        {allOpen ? 'Collapse all' : 'Expand all'}
      </button>
    </div>
    <ol className={styles.exerciseCards} id={listId}>
      {workout.positions.map((position, index) => <li key={position.id}>
        <details open={expanded.has(position.id)} onToggle={event => {
          const open = event.currentTarget.open;
          setExpanded(previous => {
            if (previous.has(position.id) === open) return previous;
            const next = new Set(previous);
            if (open) next.add(position.id); else next.delete(position.id);
            return next;
          });
        }}>
          <summary>
            <span className={styles.exerciseNumber} aria-hidden="true">{index + 1}</span>
            <span className={styles.exerciseSummary}>
              <h4>{exerciseTitle(position.exercise)}</h4>
              {targetGroups(position.targets.map(target => ({ ...target, measurement: null })))
                .map(group => <span key={group.first}>{group.count} {'\u00d7'} {group.label}</span>)}
            </span>
            <svg aria-hidden="true" className={styles.chevron} viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="m9 5 7 7-7 7" />
            </svg>
          </summary>
          <div className={styles.exerciseInformation}>
            {position.role && <div><p>Role in this workout</p><strong>{position.role}</strong></div>}
            {position.exercise.kind === 'catalogSnapshot' &&
              position.exercise.equipment.length > 0 && <div>
                <p>Equipment</p><strong>{position.exercise.equipment.join(' \u00b7 ')}</strong>
              </div>}
          </div>
        </details>
      </li>)}
    </ol>
  </section>;
}
