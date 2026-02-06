import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function GET() {
  const url = process.env.DATABASE_URL ?? "";
  let host = "";
  let db = "";
  try {
    const parsed = new URL(url);
    host = parsed.host;
    db = parsed.pathname.replace(/^\//, "");
  } catch {
    host = "";
    db = "";
  }

  const columns = (await prisma.$queryRaw<
    { column_name: string }[]
  >`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'Profile' order by column_name`) ?? [];

  return NextResponse.json({
    dbHost: host,
    dbName: db,
    profileColumns: columns.map((row) => row.column_name),
  });
}
