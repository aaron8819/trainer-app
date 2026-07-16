import { NextResponse } from "next/server";
import {
  assertProductionWriteAllowed,
  isProductionWritePausedError,
  type ProductionWriteOperation,
} from "./production-write-gate";

const PAUSED_RESPONSE_BODY = {
  error: "Trainer writes are temporarily paused for maintenance.",
  code: "PRODUCTION_WRITE_PAUSED",
} as const;

export function productionWritePauseResponse(
  operation: ProductionWriteOperation,
  requestPath: string,
): NextResponse | null {
  try {
    assertProductionWriteAllowed(operation);
    return null;
  } catch (error) {
    if (!isProductionWritePausedError(error)) throw error;

    console.warn(
      JSON.stringify({
        event: "trainer_production_write_blocked",
        operation: error.operation,
        requestPath,
        timestamp: new Date().toISOString(),
      }),
    );

    return NextResponse.json(PAUSED_RESPONSE_BODY, {
      status: 503,
      headers: { "Retry-After": "60" },
    });
  }
}
