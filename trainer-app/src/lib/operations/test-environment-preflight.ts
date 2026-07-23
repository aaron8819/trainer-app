export type CapabilityStatus = "available" | "missing" | "invalid";
export type TestGroupStatus = "runnable" | "blocked" | "separate";

export type DatabaseTargetStatus = "missing" | "invalid" | "local" | "remote";

export type TestEnvironmentPreflightInput = {
  databaseUrl?: string;
  dependencyInstallation: CapabilityStatus;
  dependencyArrangement: "standalone" | "junction" | "missing";
  prismaClient: CapabilityStatus;
  prismaVersionMatches: boolean;
  docker: CapabilityStatus;
};

export type TestEnvironmentPreflightReport = {
  success: boolean;
  databaseTarget: DatabaseTargetStatus;
  capabilities: {
    dependencyInstallation: CapabilityStatus;
    dependencyArrangement: TestEnvironmentPreflightInput["dependencyArrangement"];
    prismaClient: CapabilityStatus;
    prismaVersionMatches: boolean;
    docker: CapabilityStatus;
  };
  groups: {
    pureVerification: {
      status: TestGroupStatus;
      command: "npm run test:pure";
      reason: string;
    };
    fullVitest: {
      status: TestGroupStatus;
      command: "npm run test:full";
      reason: string;
    };
    disposableDatabase: {
      status: TestGroupStatus;
      command: "npm run test:db:workout-mutations";
      reason: string;
    };
    uiAudit: {
      status: TestGroupStatus;
      command: "npm run test:ui-audit";
      reason: string;
    };
  };
  blockers: string[];
  warnings: string[];
};

export function classifyDatabaseTarget(databaseUrl?: string): DatabaseTargetStatus {
  if (!databaseUrl?.trim()) {
    return "missing";
  }

  try {
    const hostname = new URL(databaseUrl).hostname.toLowerCase();
    return hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]"
      ? "local"
      : "remote";
  } catch {
    return "invalid";
  }
}

export function buildTestEnvironmentPreflight(
  input: TestEnvironmentPreflightInput
): TestEnvironmentPreflightReport {
  const databaseTarget = classifyDatabaseTarget(input.databaseUrl);
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (input.dependencyInstallation !== "available") {
    blockers.push("The exact-lock dependency installation is unavailable.");
  }
  if (input.dependencyArrangement === "junction") {
    blockers.push("node_modules is a junction; comprehensive verification requires a standalone installation.");
  }
  if (input.prismaClient !== "available") {
    blockers.push("The generated Prisma Client is unavailable.");
  }
  if (!input.prismaVersionMatches) {
    blockers.push("Prisma CLI and @prisma/client versions do not match.");
  }

  if (databaseTarget === "missing") {
    warnings.push("DATABASE_URL is missing; the full Vitest inventory is blocked before collection.");
  } else if (databaseTarget === "invalid") {
    blockers.push("DATABASE_URL is invalid.");
  } else if (databaseTarget === "remote") {
    blockers.push("DATABASE_URL is not local; the full test inventory refuses remote database targets.");
  }

  const localCapabilitiesReady =
    input.dependencyInstallation === "available" &&
    input.dependencyArrangement === "standalone" &&
    input.prismaClient === "available" &&
    input.prismaVersionMatches;
  const fullVitestReady = localCapabilitiesReady && databaseTarget === "local";

  return {
    success: blockers.length === 0,
    databaseTarget,
    capabilities: {
      dependencyInstallation: input.dependencyInstallation,
      dependencyArrangement: input.dependencyArrangement,
      prismaClient: input.prismaClient,
      prismaVersionMatches: input.prismaVersionMatches,
      docker: input.docker,
    },
    groups: {
      pureVerification: {
        status: localCapabilitiesReady ? "runnable" : "blocked",
        command: "npm run test:pure",
        reason: localCapabilitiesReady
          ? "Credential-free deterministic verification is available."
          : "Local dependencies or generated Prisma Client are unavailable.",
      },
      fullVitest: {
        status: fullVitestReady ? "runnable" : "blocked",
        command: "npm run test:full",
        reason: fullVitestReady
          ? "A local database target is configured; the full inventory may collect."
          : "The full inventory imports database-backed seams and requires an explicit local DATABASE_URL.",
      },
      disposableDatabase: {
        status: input.docker === "available" ? "separate" : "blocked",
        command: "npm run test:db:workout-mutations",
        reason:
          input.docker === "available"
            ? "Docker is available; disposable DB coverage remains an explicit separate command."
            : "Docker is unavailable; disposable DB coverage cannot run.",
      },
      uiAudit: {
        status: localCapabilitiesReady ? "separate" : "blocked",
        command: "npm run test:ui-audit",
        reason: localCapabilitiesReady
          ? "Playwright fixture coverage is available as a separate managed-server command."
          : "Local dependencies are unavailable.",
      },
    },
    blockers,
    warnings,
  };
}
