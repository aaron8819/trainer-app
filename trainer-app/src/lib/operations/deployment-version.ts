export type DeploymentVersion = {
  commitSha: string;
};

type DeploymentEnvironment = {
  [key: string]: string | undefined;
  NODE_ENV?: string;
  TRAINER_BUILD_GIT_SHA?: string;
  VERCEL?: string;
  VERCEL_ENV?: string;
  VERCEL_GIT_COMMIT_SHA?: string;
};

const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;

function configuredCommitSha(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized && FULL_GIT_SHA.test(normalized) ? normalized : null;
}

function isVercelDeployment(environment: DeploymentEnvironment): boolean {
  return (
    environment.VERCEL === "1" ||
    environment.VERCEL_ENV === "production" ||
    environment.VERCEL_ENV === "preview"
  );
}

export function getDeploymentVersion(
  environment: DeploymentEnvironment = process.env,
): DeploymentVersion {
  const commitSha =
    configuredCommitSha(environment.VERCEL_GIT_COMMIT_SHA) ??
    configuredCommitSha(environment.TRAINER_BUILD_GIT_SHA);
  if (commitSha) {
    return { commitSha };
  }

  if (isVercelDeployment(environment) || environment.NODE_ENV === "production") {
    throw new Error("Deployment commit SHA is unavailable.");
  }

  return { commitSha: "unknown" };
}
