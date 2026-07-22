export type ProductionVersionVerificationOptions = {
  baseUrl: string;
  expectedSha: string;
};

export type ProductionVersionCheck = {
  ok: boolean;
  url: string;
  status: number | null;
  message: string;
};

export type ProductionVersionVerificationResult = {
  commitIdentity: ProductionVersionCheck;
  aliasAvailability: ProductionVersionCheck;
};

type FetchImplementation = typeof fetch;

const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;

function readArgument(argv: string[], name: string): string | undefined {
  const inline = argv.find((argument) => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1) || undefined;
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function normalizeProductionOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("--base-url must be a valid HTTPS production origin.");
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error("--base-url must be a valid HTTPS production origin.");
  }

  return url.origin;
}

function normalizeExpectedSha(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!FULL_GIT_SHA.test(normalized)) {
    throw new Error("--expected-sha must be a full 40-character Git SHA.");
  }
  return normalized;
}

export function parseProductionVersionVerificationArgs(
  argv: string[],
): ProductionVersionVerificationOptions {
  const baseUrl = readArgument(argv, "--base-url");
  if (!baseUrl) {
    throw new Error("Missing required --base-url <https-origin>.");
  }

  const expectedSha = readArgument(argv, "--expected-sha");
  if (!expectedSha) {
    throw new Error("Missing required --expected-sha <full-git-sha>.");
  }

  return {
    baseUrl: normalizeProductionOrigin(baseUrl),
    expectedSha: normalizeExpectedSha(expectedSha),
  };
}

function failure(url: string, status: number | null, message: string): ProductionVersionCheck {
  return { ok: false, url, status, message };
}

async function checkCommitIdentity(
  options: ProductionVersionVerificationOptions,
  fetchImplementation: FetchImplementation,
): Promise<ProductionVersionCheck> {
  const url = new URL("/api/version", options.baseUrl).toString();
  let response: Response;
  try {
    response = await fetchImplementation(url, {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
  } catch {
    return failure(url, null, "Version endpoint request failed.");
  }

  if (response.status !== 200) {
    return failure(url, response.status, `Version endpoint returned HTTP ${response.status}.`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return failure(url, response.status, "Version endpoint did not return valid JSON.");
  }

  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    !("commitSha" in body) ||
    typeof body.commitSha !== "string" ||
    !FULL_GIT_SHA.test(body.commitSha)
  ) {
    return failure(url, response.status, "Version endpoint is missing the exact commitSha contract.");
  }

  const actualSha = body.commitSha.toLowerCase();
  if (actualSha !== options.expectedSha) {
    return failure(
      url,
      response.status,
      `Commit SHA mismatch: expected ${options.expectedSha}, received ${actualSha}.`,
    );
  }

  return {
    ok: true,
    url,
    status: response.status,
    message: `Commit SHA matches ${options.expectedSha}.`,
  };
}

async function checkAliasAvailability(
  options: ProductionVersionVerificationOptions,
  fetchImplementation: FetchImplementation,
): Promise<ProductionVersionCheck> {
  const url = `${options.baseUrl}/`;
  let response: Response;
  try {
    response = await fetchImplementation(url, {
      method: "GET",
      cache: "no-store",
      redirect: "follow",
    });
  } catch {
    return failure(url, null, "Production alias request failed.");
  }

  if (response.status !== 200) {
    return failure(url, response.status, `Production alias returned HTTP ${response.status}.`);
  }

  return {
    ok: true,
    url,
    status: response.status,
    message: "Production alias returned HTTP 200.",
  };
}

export async function verifyProductionVersion(
  options: ProductionVersionVerificationOptions,
  fetchImplementation: FetchImplementation = fetch,
): Promise<ProductionVersionVerificationResult> {
  const [commitIdentity, aliasAvailability] = await Promise.all([
    checkCommitIdentity(options, fetchImplementation),
    checkAliasAvailability(options, fetchImplementation),
  ]);

  return { commitIdentity, aliasAvailability };
}

export function productionVersionVerificationExitCode(
  result: ProductionVersionVerificationResult,
): 0 | 1 {
  return result.commitIdentity.ok && result.aliasAvailability.ok ? 0 : 1;
}

export function formatProductionVersionVerification(
  result: ProductionVersionVerificationResult,
): string[] {
  return [
    `${result.commitIdentity.ok ? "PASS" : "FAIL"} commit identity: ${result.commitIdentity.message}`,
    `${result.aliasAvailability.ok ? "PASS" : "FAIL"} alias availability: ${result.aliasAvailability.message}`,
  ];
}
