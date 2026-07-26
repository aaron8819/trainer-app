import { writeFileSync } from "node:fs";
import {
  IMPORT_ONLY_PLACEHOLDER_URL,
  IMPORT_ONLY_PLACEHOLDER_ENV,
  validateImportOnlyPlaceholderEnvironment,
} from "@/lib/operations/test-environment-preflight";
import {
  IMPORT_ONLY_CONNECTION_ATTEMPT_MARKER_ENV,
  installImportOnlyPlaceholderConnectionGuard,
} from "@/lib/operations/import-only-placeholder-guard";

const errors = validateImportOnlyPlaceholderEnvironment(process.env);
const attemptMarker = process.env[IMPORT_ONLY_CONNECTION_ATTEMPT_MARKER_ENV];
if (
  process.env[IMPORT_ONLY_PLACEHOLDER_ENV] !== "1" ||
  process.env.DATABASE_URL !== IMPORT_ONLY_PLACEHOLDER_URL ||
  !attemptMarker ||
  errors.length > 0
) {
  throw new Error(`IMPORT_ONLY_PLACEHOLDER_ENVIRONMENT_INVALID:${errors.join("|")}`);
}

installImportOnlyPlaceholderConnectionGuard(() => {
  writeFileSync(attemptMarker, "attempted", { flag: "a" });
});
