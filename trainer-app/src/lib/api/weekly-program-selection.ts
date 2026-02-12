import type { WorkoutSessionIntent } from "@prisma/client";

type TemplateLike = { id: string; intent: string };

const INTENT_TO_TEMPLATE_INTENT_PRIORITY: Record<WorkoutSessionIntent, string[]> = {
  PUSH: ["PUSH_PULL_LEGS", "CUSTOM", "UPPER_LOWER", "FULL_BODY", "BODY_PART"],
  PULL: ["PUSH_PULL_LEGS", "CUSTOM", "UPPER_LOWER", "FULL_BODY", "BODY_PART"],
  LEGS: ["PUSH_PULL_LEGS", "CUSTOM", "UPPER_LOWER", "FULL_BODY", "BODY_PART"],
  UPPER: ["UPPER_LOWER", "FULL_BODY", "CUSTOM", "PUSH_PULL_LEGS", "BODY_PART"],
  LOWER: ["UPPER_LOWER", "FULL_BODY", "CUSTOM", "PUSH_PULL_LEGS", "BODY_PART"],
  FULL_BODY: ["FULL_BODY", "CUSTOM", "UPPER_LOWER", "PUSH_PULL_LEGS", "BODY_PART"],
  BODY_PART: ["BODY_PART", "CUSTOM", "PUSH_PULL_LEGS", "UPPER_LOWER", "FULL_BODY"],
};

export function selectTemplatesForWeeklyProgram<T extends TemplateLike>(
  templates: T[],
  daysPerWeek: number | null | undefined,
  templateIds: string[] | undefined,
  weeklySchedule: WorkoutSessionIntent[] | undefined
): T[] {
  if (!templateIds || templateIds.length === 0) {
    if (weeklySchedule && weeklySchedule.length > 0) {
      return selectTemplatesBySchedule(templates, weeklySchedule);
    }
    const limit = daysPerWeek && daysPerWeek > 0 ? daysPerWeek : templates.length;
    return templates.slice(0, limit);
  }

  const dedupedIds = Array.from(new Set(templateIds));
  const templateById = new Map(templates.map((template) => [template.id, template]));
  const selected = dedupedIds
    .map((id) => templateById.get(id))
    .filter((template): template is T => Boolean(template));

  return selected;
}

export function pickTemplateForSessionIntent<T extends TemplateLike>(
  templates: T[],
  sessionIntent: WorkoutSessionIntent,
  usedIds: Set<string>,
  options?: { allowReuse?: boolean }
): T | undefined {
  const intentPriority = INTENT_TO_TEMPLATE_INTENT_PRIORITY[sessionIntent] ?? [];
  for (const templateIntent of intentPriority) {
    const picked = templates.find(
      (template) =>
        template.intent === templateIntent &&
        (options?.allowReuse ? true : !usedIds.has(template.id))
    );
    if (picked) {
      return picked;
    }
  }
  return undefined;
}

function selectTemplatesBySchedule<T extends TemplateLike>(
  templates: T[],
  weeklySchedule: WorkoutSessionIntent[]
): T[] {
  if (templates.length === 0) {
    return [];
  }

  const selected: T[] = [];
  const usedIds = new Set<string>();

  for (const sessionIntent of weeklySchedule) {
    let picked = pickTemplateForSessionIntent(templates, sessionIntent, usedIds);

    if (!picked) {
      picked = templates.find((template) => !usedIds.has(template.id));
    }

    if (!picked) {
      picked = pickTemplateForSessionIntent(templates, sessionIntent, usedIds, {
        allowReuse: true,
      });
    }

    if (!picked) {
      picked = templates[0];
    }

    if (!picked) {
      continue;
    }

    selected.push(picked);
    usedIds.add(picked.id);
  }

  return selected;
}
