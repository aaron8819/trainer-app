// Quick script to check volume context
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Get your user ID (assuming you're the only user)
  const user = await prisma.user.findFirst();
  if (!user) {
    console.log('No user found');
    return;
  }
  
  console.log('User ID:', user.id);
  
  // Get completed workouts from this week
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  
  const workouts = await prisma.workout.findMany({
    where: {
      userId: user.id,
      status: 'COMPLETED',
      completedAt: {
        gte: oneWeekAgo,
      },
    },
    include: {
      exercises: {
        include: {
          exercise: {
            select: {
              name: true,
              primaryMuscles: true,
              secondaryMuscles: true,
            },
          },
          sets: true,
        },
      },
    },
    orderBy: {
      completedAt: 'asc',
    },
  });
  
  console.log('\nCompleted workouts this week:', workouts.length);
  
  // Calculate volume by muscle
  const directVolume = {};
  const indirectVolume = {};
  
  for (const workout of workouts) {
    console.log('\nWorkout:', workout.id);
    console.log('Completed:', workout.completedAt);
    
    for (const ex of workout.exercises) {
      const setCount = ex.sets.length;
      console.log(`  ${ex.exercise.name}: ${setCount} sets`);
      console.log(`    Primary: ${ex.exercise.primaryMuscles.join(', ')}`);
      console.log(`    Secondary: ${ex.exercise.secondaryMuscles.join(', ')}`);
      
      // Add to direct volume (primary muscles)
      for (const muscle of ex.exercise.primaryMuscles) {
        directVolume[muscle] = (directVolume[muscle] || 0) + setCount;
      }
      
      // Add to indirect volume (secondary muscles)
      for (const muscle of ex.exercise.secondaryMuscles) {
        indirectVolume[muscle] = (indirectVolume[muscle] || 0) + setCount;
      }
    }
  }
  
  console.log('\n=== DIRECT VOLUME (this week) ===');
  const sortedDirect = Object.entries(directVolume).sort((a, b) => b[1] - a[1]);
  for (const [muscle, sets] of sortedDirect) {
    console.log(`${muscle}: ${sets} sets`);
  }
  
  console.log('\n=== INDIRECT VOLUME (this week) ===');
  const sortedIndirect = Object.entries(indirectVolume).sort((a, b) => b[1] - a[1]);
  for (const [muscle, sets] of sortedIndirect) {
    console.log(`${muscle}: ${sets} sets`);
  }
  
  console.log('\n=== EFFECTIVE VOLUME (direct + 0.3 × indirect) ===');
  const effectiveVolume = {};
  const allMuscles = new Set([...Object.keys(directVolume), ...Object.keys(indirectVolume)]);
  for (const muscle of allMuscles) {
    const direct = directVolume[muscle] || 0;
    const indirect = indirectVolume[muscle] || 0;
    effectiveVolume[muscle] = direct + (indirect * 0.3);
  }
  const sortedEffective = Object.entries(effectiveVolume).sort((a, b) => b[1] - a[1]);
  for (const [muscle, sets] of sortedEffective) {
    console.log(`${muscle}: ${sets.toFixed(1)} sets`);
  }
  
  // Show MEV targets for push muscles
  console.log('\n=== MEV TARGETS (from VOLUME_LANDMARKS) ===');
  const pushMuscles = ['Chest', 'Front Delts', 'Side Delts', 'Triceps'];
  const mevTargets = {
    'Chest': 12,
    'Front Delts': 0, // KB: Front delts have MEV = 0
    'Side Delts': 8,
    'Triceps': 6,
  };
  
  for (const muscle of pushMuscles) {
    const target = mevTargets[muscle];
    const effective = effectiveVolume[muscle] || 0;
    const deficit = Math.max(0, target - effective);
    console.log(`${muscle}: target=${target}, effective=${effective.toFixed(1)}, deficit=${deficit.toFixed(1)}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
