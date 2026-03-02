import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

type WeekBand = { min: number; max: number };
type WeekBands = Record<string, WeekBand>;

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Missing DATABASE_URL");
  }

  const url = new URL(connectionString);
  url.searchParams.delete("sslmode");
  url.searchParams.delete("sslrootcert");

  const pool = new Pool({
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: false },
  });

  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  return { prisma, pool };
}

function buildDefaultWeekBands(durationWeeks: number): WeekBands {
  if (durationWeeks === 4) {
    return {
      week1: { min: 3, max: 4 },
      week2: { min: 2, max: 3 },
      week3: { min: 1, max: 2 },
      week4Deload: { min: 4, max: 6 },
    };
  }

  if (durationWeeks === 5) {
    return {
      week1: { min: 3, max: 4 },
      week2: { min: 2, max: 3 },
      week3: { min: 1, max: 2 },
      week4: { min: 0, max: 1 },
      week5Deload: { min: 4, max: 6 },
    };
  }

  if (durationWeeks === 6) {
    return {
      week1: { min: 3, max: 4 },
      week2: { min: 2, max: 3 },
      week3: { min: 2, max: 2 },
      week4: { min: 1, max: 2 },
      week5: { min: 0, max: 1 },
      week6Deload: { min: 4, max: 6 },
    };
  }

  return {};
}

function readWeekBand(config: unknown, key: string): WeekBand | null {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  const weekBands = (config as { weekBands?: unknown }).weekBands;
  if (!weekBands || typeof weekBands !== "object" || Array.isArray(weekBands)) return null;
  const band = (weekBands as Record<string, unknown>)[key];
  if (!band || typeof band !== "object" || Array.isArray(band)) return null;
  const { min, max } = band as { min?: unknown; max?: unknown };
  if (typeof min !== "number" || typeof max !== "number") return null;
  return { min, max };
}

function isLegacyFiveWeekConfig(config: unknown): boolean {
  const week2 = readWeekBand(config, "week2");
  const week3 = readWeekBand(config, "week3");
  const week4 = readWeekBand(config, "week4");
  const deload = readWeekBand(config, "week5Deload");

  return (
    week2?.min === 2 &&
    week2.max === 3 &&
    week3?.min === 2 &&
    week3.max === 3 &&
    week4?.min === 1 &&
    week4.max === 2 &&
    deload?.min === 4 &&
    deload.max === 6
  );
}

async function main() {
  const { prisma, pool } = createClient();

  try {
    const mesocycles = await prisma.mesocycle.findMany({
      where: { durationWeeks: 5 },
      select: {
        id: true,
        durationWeeks: true,
        rirBandConfig: true,
        splitType: true,
        daysPerWeek: true,
        sessionsPerWeek: true,
      },
    });

    const targets = mesocycles.filter((meso) => isLegacyFiveWeekConfig(meso.rirBandConfig));
    if (targets.length === 0) {
      console.log("No legacy 5-week mesocycle RIR configs found.");
      return;
    }

    for (const meso of targets) {
      const existing =
        meso.rirBandConfig && typeof meso.rirBandConfig === "object" && !Array.isArray(meso.rirBandConfig)
          ? (meso.rirBandConfig as Record<string, unknown>)
          : {};

      const nextConfig = {
        ...existing,
        splitType: existing.splitType ?? meso.splitType,
        daysPerWeek: existing.daysPerWeek ?? meso.daysPerWeek,
        sessionsPerWeek: existing.sessionsPerWeek ?? meso.sessionsPerWeek,
        weekBands: buildDefaultWeekBands(meso.durationWeeks),
      };

      await pool.query(
        'update "Mesocycle" set "rirBandConfig" = $2::jsonb where id = $1',
        [meso.id, JSON.stringify(nextConfig)]
      );
    }

    console.log(`Updated ${targets.length} mesocycle RIR config(s) to corrected defaults.`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
