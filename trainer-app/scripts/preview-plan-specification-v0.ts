import { buildPlanSpecificationPreviewV0 } from "@/lib/api/plan-specification-preview-v0";
import {
  PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE,
  PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_CATALOG_IDS,
} from "@/lib/engine/plan-specification-preview-v0.fixture";

const preview = buildPlanSpecificationPreviewV0({
  specification: PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE,
  catalogExerciseIds: PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_CATALOG_IDS,
});

process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);

if (!preview.specificationValidation.valid || !preview.seedValidation.valid) {
  process.exitCode = 1;
}
