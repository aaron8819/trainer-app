import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import net from "node:net";
import { Client } from "pg";
import {
  classifyRolloutTarget,
  runWithRolloutEnvironment,
  sanitizedRolloutEnvironment,
} from "@/lib/operations/rollout-environment";

type DirectCheckClassification =
  | "dns_failure"
  | "network_timeout"
  | "network_rejection"
  | "tls_failure"
  | "authentication_failure"
  | "database_rejection"
  | "successful_direct_connection";

function hostFingerprint(hostname: string): string {
  return createHash("sha256").update(hostname.toLowerCase()).digest("hex").slice(0, 12);
}

function tcpConnect(host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(5_000);
    socket.once("connect", () => {
      socket.destroy();
      resolve();
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(Object.assign(new Error("TCP connection timed out"), { code: "ETIMEDOUT" }));
    });
    socket.once("error", reject);
  });
}

function classifyConnectionError(error: unknown): DirectCheckClassification {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "dns_failure";
  if (code === "ETIMEDOUT" || message.includes("timeout")) return "network_timeout";
  if (code === "28P01" || code === "28000") return "authentication_failure";
  if (code === "3D000" || code === "57P03" || code === "53300") return "database_rejection";
  if (message.includes("ssl") || message.includes("tls") || message.includes("certificate")) {
    return "tls_failure";
  }
  return "network_rejection";
}

async function main(): Promise<void> {
  await runWithRolloutEnvironment(
    {
      argv: process.argv.slice(2),
      allowWrite: false,
      requiredVariables: ["DATABASE_URL", "DIRECT_URL"],
    },
    async (environment) => {
      const directUrl = process.env.DIRECT_URL;
      if (!directUrl) {
        throw new Error("The explicitly named environment file must define DIRECT_URL.");
      }
      const url = new URL(directUrl);
      const directTargetClass = classifyRolloutTarget(
        directUrl,
        process.argv.includes("--confirm-disposable"),
      );
      if (directTargetClass !== environment.targetClass) {
        throw new Error("DATABASE_URL and DIRECT_URL resolve to different sanitized target classes.");
      }
      const fingerprint = hostFingerprint(url.hostname);
      const port = Number(url.port || 5432);
      const report = {
        environment: sanitizedRolloutEnvironment(environment),
        directTargetClass,
        directHostFingerprint: fingerprint,
        dns: "not_run",
        tcp: "not_run",
        database: "not_run",
        classification: null as DirectCheckClassification | null,
      };

      try {
        await lookup(url.hostname);
        report.dns = "resolved";
      } catch (error) {
        report.classification = classifyConnectionError(error);
        console.log(JSON.stringify(report, null, 2));
        process.exitCode = 1;
        return;
      }

      try {
        await tcpConnect(url.hostname, port);
        report.tcp = "connected";
      } catch (error) {
        report.classification = classifyConnectionError(error);
        console.log(JSON.stringify(report, null, 2));
        process.exitCode = 1;
        return;
      }

      const client = new Client({ connectionString: directUrl, connectionTimeoutMillis: 5_000 });
      try {
        await client.connect();
        report.database = "connected_without_sql";
        report.classification = "successful_direct_connection";
      } catch (error) {
        report.classification = classifyConnectionError(error);
        process.exitCode = 1;
      } finally {
        await client.end().catch(() => undefined);
      }
      console.log(JSON.stringify(report, null, 2));
    },
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
