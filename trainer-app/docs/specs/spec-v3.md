# Trainer App v3 Spec

Future feature ideas carried forward from v2. These are open questions — none are committed or scoped yet.

Reference: `docs/knowledgebase/hypertrophyandstrengthtraining_researchreport.md` is the scientific foundation for engine behavior.

---

## Open Questions

### 1. Training Phase (Bulk / Cut / Maintain)

The knowledgebase says to reduce volume 20-33% during a cut. Should we add a `trainingPhase` field to Profile and have the engine adjust automatically?

**Possible scope:**
- New `trainingPhase` enum on Profile: `bulk`, `cut`, `maintain`
- Engine reduces target volume (MAV) by 20-33% during cuts
- Engine increases caloric-burn bias (more compounds) during cuts
- Maintain phase uses standard volume targets

### 2. Indirect Volume Accounting

How precisely should we count indirect volume? (e.g., bench press counts as direct chest + indirect triceps + indirect front delts) — needs a weighting model.

**Possible scope:**
- Define indirect volume weight per muscle role (e.g., secondary = 0.5 sets)
- Track effective volume (direct + weighted indirect) per muscle per week
- Use effective volume for MRV cap enforcement instead of direct-only
- Front delts are the canonical example: massive indirect volume from pressing means direct front delt work is often unnecessary

### 3. Exercise Rotation Across Mesocycles

How to implement "maintain core movements 2-3 mesos, rotate accessories"? Needs tracking of which exercises have been used in recent mesocycles.

**Possible scope:**
- Track exercise usage per mesocycle (new table or derived from workout history)
- Core movements (main lifts) stay stable for 2-3 mesocycles
- Accessories rotate each mesocycle for novelty and varied stimulus
- Engine biases toward unused exercises when selecting accessories

### 4. Dynamic fatigueCost

Adjust effective fatigue cost based on user's logged RPE history for that exercise.

**Possible scope:**
- Track average RPE delta (prescribed vs actual) per exercise over recent sessions
- Exercises where user consistently reports higher RPE than prescribed get increased effective fatigueCost
- Exercises where user consistently underperforms RPE get decreased fatigueCost
- Feeds into accessory selection scoring and timeboxing priority

### 5. Supersets

The knowledgebase mentions agonist-antagonist supersets save ~50% time. Should templates support superset pairing?

**Possible scope:**
- New `supersetGroupId` field on WorkoutTemplateExercise (nullable)
- Exercises with matching group IDs are performed as supersets
- Rest period is shared (rest after both exercises, not between)
- Time estimation accounts for superset savings (~50% rest reduction)
- Smart Build could auto-suggest superset pairings (e.g., bench + row, curl + extension)
