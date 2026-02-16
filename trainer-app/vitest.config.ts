import { defineConfig } from "vitest/config";
import path from "node:path";
import dotenv from "dotenv";

// Load environment variables from .env.local then .env
dotenv.config({ path: ".env.local" });
dotenv.config();

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
