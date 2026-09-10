import type { NextRequest } from "next/server";
import { authHttp } from "@/lib/api/trainer2/auth-http";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) { return authHttp(request, "callback"); }
