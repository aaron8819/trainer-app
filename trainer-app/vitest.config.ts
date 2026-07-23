import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import dotenv from "dotenv";

const mutationDatabaseTests = [
  "src/lib/api/save-workout/persistence.db.test.ts",
  "src/lib/api/workout-mutation.db.test.ts",
];
const normalizedArguments = process.argv.map((argument) =>
  argument.replaceAll("\\", "/").toLowerCase()
);
const collectingMutationDatabaseTest = mutationDatabaseTests.some((testFile) =>
  normalizedArguments.some((argument) => argument.endsWith(testFile))
);

// Credential-free commands and direct mutation-test collection never repopulate DB targets.
if (
  process.env.TRAINER_CREDENTIAL_FREE_TEST !== "1" &&
  !collectingMutationDatabaseTest
) {
  dotenv.config({ path: ".env.local" });
  dotenv.config();
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./vitest.setup.ts"],
    reporters: ["dot"],
  },
});
