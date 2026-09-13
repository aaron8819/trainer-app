import { draftHttp } from "@/lib/api/trainer2/http";
export async function POST(request: Request) { return draftHttp(request, "ActivatePlan"); }
