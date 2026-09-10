import { expect, it } from "vitest";
import { authenticateHostedRequest } from "./authentication";
import { connectionString } from "./database";

it("the real unconfigured verifier rejects every caller; no synthetic selector exists", async () => {
  for (const headers of [{}, { Authorization: "Bearer forged" }, { "x-subject": "developer", "x-account-id": "owner" }, { Cookie: "session=forged" }])
    await expect(authenticateHostedRequest(new Request("https://trainer.example.invalid/", { headers: headers as HeadersInit }))).rejects.toThrow("AUTHENTICATION_NOT_CONFIGURED");
});
it("dedicated connection configuration fails closed without a privileged default", () => {
  const env = { DATABASE_URL: "postgresql://postgres:synthetic@127.0.0.1/trainer2_disposable_test" };
  expect(() => connectionString("identity", true, env)).toThrow("DATABASE_CONFIGURATION_REQUIRED");
  for (const url of [env.DATABASE_URL, "postgresql://trainer2_identity_reader:x@remote.invalid/trainer2_disposable_test", "postgresql://trainer2_identity_reader:x@127.0.0.1/shared", "postgresql://trainer2_identity_reader:x@127.0.0.1/trainer2_disposable_test?options=-c%20role=postgres"])
    expect(() => connectionString("identity", true, { TRAINER2_IDENTITY_CONNECTION_STRING: url })).toThrow();
  expect(connectionString("identity", true, { TRAINER2_IDENTITY_CONNECTION_STRING: "postgresql://trainer2_identity_reader:x@127.0.0.1/trainer2_disposable_test" })).toContain("trainer2_identity_reader");
});
