import { NextResponse } from "next/server";
import { FinisherLibraryServiceError } from "./finisher-library-service";

export function finisherLibraryErrorResponse(error: unknown): NextResponse {
  if (error instanceof FinisherLibraryServiceError) {
    return NextResponse.json(
      { error: error.code, code: error.code },
      { status: error.status },
    );
  }
  throw error;
}
