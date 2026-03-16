import 'dotenv/config';
import { generateSessionFromIntent } from './src/lib/api/template-session';
import { loadMappedGenerationContext } from './src/lib/api/template-session/context-loader';

(async () => {
  const userId = 'f03601b5-5e2a-40dc-974d-14bb1d1862a3';
  const mapped = await loadMappedGenerationContext(userId);
  console.log(JSON.stringify({
    lifecycleWeek: mapped.lifecycleWeek,
    mesocycleLength: mapped.mesocycleLength,
    historyCount: mapped.history.length,
    pushHistory: mapped.history.filter((entry) => entry.sessionIntent === 'push').map((entry) => ({
      date: entry.date,
      status: entry.status,
      selectionMode: entry.selectionMode,
      exercises: entry.exercises.filter((exercise) =>
        ['78089cb4-8ff0-4b32-94e8-5751fb4a7872','6835003f-b1f6-43f6-ad62-946f664a2344'].includes(exercise.exerciseId)
      ),
    })),
  }, null, 2));

  const result = await generateSessionFromIntent(userId, { intent: 'push' });
  if ('error' in result) {
    console.error(result.error);
    process.exit(1);
  }
  const machine = result.workout.accessories.find((entry) => entry.exercise.name === 'Machine Shoulder Press');
  const cableLat = result.workout.accessories.find((entry) => entry.exercise.name === 'Cable Lateral Raise');
  console.log('MACHINE', JSON.stringify(machine, null, 2));
  console.log('CABLE', JSON.stringify(cableLat, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
