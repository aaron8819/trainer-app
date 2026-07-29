import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const playwrightCli = fileURLToPath(
  new URL("../node_modules/@playwright/test/cli.js", import.meta.url),
);
const childEnvironment = { ...process.env };
delete childEnvironment.DATABASE_URL;
delete childEnvironment.DIRECT_URL;

const child = spawn(
  process.execPath,
  [playwrightCli, "test", ...process.argv.slice(2)],
  {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: childEnvironment,
    stdio: "inherit",
  },
);

child.on("error", (error) => {
  console.error(`Failed to start the UI audit: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});
