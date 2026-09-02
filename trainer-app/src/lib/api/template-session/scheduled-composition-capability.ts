import { revalidateV4ScheduledGenerationObligation } from "../next-session";
import {
  sameV4ScheduledGenerationObligation,
  type V4ScheduledGenerationObligation,
} from "../v4-scheduled-slot-resolution";

const issuedCapabilities = new WeakSet<object>();

export type ValidatedV4ScheduledCompositionCapability = {
  readonly obligation: V4ScheduledGenerationObligation;
};

export async function validateV4ScheduledCompositionCapability(input: {
  userId: string;
  obligation: V4ScheduledGenerationObligation;
}): Promise<
  | {
      status: "available";
      capability: ValidatedV4ScheduledCompositionCapability;
      obligation: V4ScheduledGenerationObligation;
    }
  | { status: "blocked"; reason: string }
> {
  const revalidated = await revalidateV4ScheduledGenerationObligation(input);
  if (revalidated.status !== "available") return revalidated;
  const capability = Object.freeze({
    obligation: revalidated.obligation,
  });
  issuedCapabilities.add(capability);
  return {
    status: "available",
    capability,
    obligation: revalidated.obligation,
  };
}

export function consumeV4ScheduledCompositionCapability(input: {
  capability: ValidatedV4ScheduledCompositionCapability | undefined;
  obligation: V4ScheduledGenerationObligation;
}): boolean {
  if (
    !input.capability ||
    !issuedCapabilities.has(input.capability) ||
    !sameV4ScheduledGenerationObligation(
      input.capability.obligation,
      input.obligation,
    )
  ) {
    return false;
  }
  issuedCapabilities.delete(input.capability);
  return true;
}
