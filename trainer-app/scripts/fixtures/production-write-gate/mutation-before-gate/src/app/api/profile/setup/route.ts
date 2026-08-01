declare function provisionOwnerForMutation(operation: string): Promise<unknown>;
declare function productionWritePauseResponse(operation: string): unknown;

export async function POST(request: Request) {
  await request.json();
  await provisionOwnerForMutation("application_configuration");
  const paused = productionWritePauseResponse("application_configuration");
  if (paused) return paused;
}
