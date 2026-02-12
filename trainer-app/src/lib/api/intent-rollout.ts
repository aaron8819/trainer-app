const USE_INTENT_DEFAULT_FOR_NEW_USERS = "USE_INTENT_DEFAULT_FOR_NEW_USERS";

function readBooleanEnv(name: string): boolean {
  const raw = process.env[name];
  if (!raw) {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function isIntentDefaultForNewUsersEnabled(): boolean {
  return readBooleanEnv(USE_INTENT_DEFAULT_FOR_NEW_USERS);
}

export function shouldDefaultNewUserToIntent(input: {
  hasExistingWorkouts: boolean;
}): boolean {
  return isIntentDefaultForNewUsersEnabled() && !input.hasExistingWorkouts;
}
