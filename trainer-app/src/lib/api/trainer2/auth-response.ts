import type { NextResponse } from "next/server";

export function privateAuthResponse(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Vary", "Cookie");
  response.headers.set("Referrer-Policy", "same-origin");
  return response;
}
