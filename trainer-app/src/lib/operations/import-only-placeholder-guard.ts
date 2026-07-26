import { Socket } from "node:net";

export const IMPORT_ONLY_CONNECTION_ATTEMPT =
  "IMPORT_ONLY_PLACEHOLDER_CONNECTION_ATTEMPT" as const;
export const IMPORT_ONLY_CONNECTION_ATTEMPT_MARKER_ENV =
  "TRAINER_IMPORT_ONLY_CONNECTION_ATTEMPT_MARKER" as const;

export function installImportOnlyPlaceholderConnectionGuard(
  onAttempt: () => void = () => undefined
): () => void {
  const originalConnect = Socket.prototype.connect;
  Socket.prototype.connect = function blockedImportOnlyConnection() {
    onAttempt();
    throw new Error(IMPORT_ONLY_CONNECTION_ATTEMPT);
  } as typeof Socket.prototype.connect;

  return () => {
    Socket.prototype.connect = originalConnect;
  };
}
