import { describe, expect, it } from "vitest";
import {
  FINISHER_PRINCIPAL_CONTRACT,
  principalSnapshotContractReasons,
  principalSnapshotMatchesContract,
  type FinisherPrincipalPhase,
  type FinisherPrincipalSnapshot,
  type FinisherRoleMembership,
} from "./finisher-principal-contract";

const ADMINISTRATOR = "supabase_migration_admin";
const BOOTSTRAP = "supabase_admin";

function automaticMembership(grantedRole: string): FinisherRoleMembership {
  return {
    grantedRole,
    memberRole: ADMINISTRATOR,
    grantorRole: BOOTSTRAP,
    grantorIsBootstrapSuperuser: true,
    admin: true,
    inherit: false,
    set: false,
  };
}

function supplementalMembership(grantedRole: string): FinisherRoleMembership {
  return {
    grantedRole,
    memberRole: ADMINISTRATOR,
    grantorRole: ADMINISTRATOR,
    grantorIsBootstrapSuperuser: false,
    admin: false,
    inherit: false,
    set: true,
  };
}

function snapshot(phase: FinisherPrincipalPhase): FinisherPrincipalSnapshot {
  const memberships = FINISHER_PRINCIPAL_CONTRACT.map((role) =>
    automaticMembership(role.name),
  );
  if (phase === "migration_capable") {
    memberships.push(
      supplementalMembership("trainer_finisher_owner"),
      supplementalMembership("trainer_finisher_cleanup"),
    );
  }
  return {
    phase,
    serverVersionNumber: 160010,
    administrator: {
      currentRole: ADMINISTRATOR,
      sessionRole: ADMINISTRATOR,
      canLogin: true,
      superuser: false,
      createRole: true,
      createroleSelfGrant: "",
    },
    roles: FINISHER_PRINCIPAL_CONTRACT.map((role) => ({
      name: role.name,
      canLogin: role.canLogin,
      inherit: role.inherit,
      superuser: false,
      createDb: false,
      createRole: false,
      replication: false,
      bypassRls: false,
      publicSchemaCreate:
        phase === "migration_capable" && role.name !== "trainer_app_runtime",
      credential:
        role.name === "trainer_app_runtime"
          ? ("verified_matching" as const)
          : ("not_applicable" as const),
      defaultPrivilegeCount: 0,
    })),
    memberships,
    finisherObjectCount: phase === "terminal" ? 42 : 0,
    finisherObjectCapabilityCount: phase === "terminal" ? 42 : 0,
  };
}

describe("Finisher principal phase contract", () => {
  it.each([
    "prerequisite",
    "migration_capable",
    "terminal",
  ] as const)("accepts the exact %s state", (phase) => {
    expect(principalSnapshotContractReasons(snapshot(phase))).toEqual([]);
    expect(principalSnapshotMatchesContract(snapshot(phase))).toBe(true);
  });

  it("requires PostgreSQL 16 and a direct non-superuser CREATEROLE administrator", () => {
    for (const mutate of [
      (value: FinisherPrincipalSnapshot) => (value.serverVersionNumber = 150010),
      (value: FinisherPrincipalSnapshot) => (value.serverVersionNumber = 170000),
      (value: FinisherPrincipalSnapshot) =>
        (value.administrator.currentRole = "set_role_target"),
      (value: FinisherPrincipalSnapshot) =>
        (value.administrator.superuser = true),
      (value: FinisherPrincipalSnapshot) =>
        (value.administrator.createRole = false),
      (value: FinisherPrincipalSnapshot) =>
        (value.administrator.createroleSelfGrant = "set"),
    ]) {
      const value = snapshot("migration_capable");
      mutate(value);
      expect(principalSnapshotMatchesContract(value)).toBe(false);
    }
  });

  it("rejects every prohibited protected-role attribute", () => {
    for (const roleIndex of [0, 1, 2]) {
      for (const attribute of [
        "superuser",
        "createDb",
        "createRole",
        "replication",
        "bypassRls",
      ] as const) {
        const value = snapshot("migration_capable");
        value.roles[roleIndex][attribute] = true;
        expect(principalSnapshotMatchesContract(value)).toBe(false);
      }
    }
  });

  it("rejects wrong LOGIN and INHERIT attributes", () => {
    for (const [roleIndex, attribute] of [
      [0, "canLogin"],
      [0, "inherit"],
      [1, "canLogin"],
      [1, "inherit"],
      [2, "canLogin"],
      [2, "inherit"],
    ] as const) {
      const value = snapshot("migration_capable");
      value.roles[roleIndex][attribute] = !value.roles[roleIndex][attribute];
      expect(principalSnapshotMatchesContract(value)).toBe(false);
    }
  });

  it("requires an exact runtime credential proof and no NOLOGIN credential checks", () => {
    const wrongRuntimePassword = snapshot("migration_capable");
    wrongRuntimePassword.roles[0].credential = "authentication_failed";
    expect(principalSnapshotContractReasons(wrongRuntimePassword)).toContain(
      "runtime_credential_not_verified",
    );

    const meaninglessOwnerCredential = snapshot("migration_capable");
    meaninglessOwnerCredential.roles[1].credential = "configured_unverified";
    expect(principalSnapshotMatchesContract(meaninglessOwnerCredential)).toBe(
      false,
    );
  });

  it("accepts only bootstrap-granted ADMIN true, INHERIT false, SET false automatic memberships", () => {
    for (const attribute of ["admin", "inherit", "set"] as const) {
      const value = snapshot("prerequisite");
      value.memberships[0][attribute] = !value.memberships[0][attribute];
      expect(principalSnapshotMatchesContract(value)).toBe(false);
    }
    const wrongGrantor = snapshot("prerequisite");
    wrongGrantor.memberships[0].grantorIsBootstrapSuperuser = false;
    expect(principalSnapshotMatchesContract(wrongGrantor)).toBe(false);
  });

  it("requires only owner and cleanup supplemental SET memberships during migration", () => {
    const missing = snapshot("migration_capable");
    missing.memberships.pop();
    expect(principalSnapshotMatchesContract(missing)).toBe(false);

    const broad = snapshot("migration_capable");
    broad.memberships.at(-1)!.inherit = true;
    expect(principalSnapshotMatchesContract(broad)).toBe(false);

    const runtimeSet = snapshot("migration_capable");
    runtimeSet.memberships.push(supplementalMembership("trainer_app_runtime"));
    expect(principalSnapshotMatchesContract(runtimeSet)).toBe(false);
  });

  it("requires temporary schema CREATE only in migration-capable state", () => {
    const prerequisiteBroad = snapshot("prerequisite");
    prerequisiteBroad.roles[1].publicSchemaCreate = true;
    expect(principalSnapshotMatchesContract(prerequisiteBroad)).toBe(false);

    const migrationMissing = snapshot("migration_capable");
    migrationMissing.roles[2].publicSchemaCreate = false;
    expect(principalSnapshotMatchesContract(migrationMissing)).toBe(false);

    const terminalBroad = snapshot("terminal");
    terminalBroad.roles[1].publicSchemaCreate = true;
    expect(principalSnapshotMatchesContract(terminalBroad)).toBe(false);
  });

  it("rejects unexpected memberships, default privileges, and pre-migration Finisher objects", () => {
    const membership = snapshot("migration_capable");
    membership.memberships.push({
      ...supplementalMembership("trainer_finisher_owner"),
      memberRole: "unexpected_member",
    });
    expect(principalSnapshotMatchesContract(membership)).toBe(false);

    const defaults = snapshot("migration_capable");
    defaults.roles[2].defaultPrivilegeCount = 1;
    expect(principalSnapshotMatchesContract(defaults)).toBe(false);

    const objects = snapshot("migration_capable");
    objects.finisherObjectCount = 1;
    expect(principalSnapshotMatchesContract(objects)).toBe(false);
  });
});
