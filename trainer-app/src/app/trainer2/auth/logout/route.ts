import type { NextRequest } from "next/server";
import { authHttp } from "@/lib/api/trainer2/auth-http";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) { return authHttp(request, "logout"); }
