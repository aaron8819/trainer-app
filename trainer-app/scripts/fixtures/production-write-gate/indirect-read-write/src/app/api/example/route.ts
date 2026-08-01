import { mutate } from "@/lib/mutator";

export async function GET() {
  return mutate();
}
