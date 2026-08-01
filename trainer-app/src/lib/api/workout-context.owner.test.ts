import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  findOwnerReadOnly,
  provisionOwnerForMutation,
} from "./workout-context";

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
  $disconnect: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: prismaMock }));

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.TRAINER_WRITE_PAUSE;
  delete process.env.OWNER_EMAIL;
  delete process.env.RUNTIME_MODE;
});

describe("owner resolution boundary", () => {
  it("uses a read-only lookup and never provisions", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    await expect(findOwnerReadOnly()).resolves.toBeNull();

    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { email: "owner@local" },
    });
    expect(prismaMock.user.upsert).not.toHaveBeenCalled();
  });

  it("provisions explicitly while writes are enabled", async () => {
    prismaMock.user.upsert.mockResolvedValue({
      id: "owner-1",
      email: "owner@local",
    });

    await expect(
      provisionOwnerForMutation("application_configuration"),
    ).resolves.toMatchObject({ id: "owner-1" });
    expect(prismaMock.user.upsert).toHaveBeenCalledOnce();
  });

  it("rejects provisioning before any database access while paused", async () => {
    process.env.TRAINER_WRITE_PAUSE = "enabled";

    await expect(
      provisionOwnerForMutation("application_configuration"),
    ).rejects.toMatchObject({ code: "PRODUCTION_WRITE_PAUSED" });

    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.user.upsert).not.toHaveBeenCalled();
    expect(prismaMock.$disconnect).not.toHaveBeenCalled();
  });
});
