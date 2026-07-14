import {
  adaptBlockedPostSessionReviewToDisplay,
  adaptPostSessionReviewContractToDisplay,
  type PostSessionReviewDisplayDto,
} from "./post-session-review-display";
import { produceCurrentPostSessionReviewInterpretation } from "./post-session-review-producer";
import {
  legacyDerivedSnapshotMetadata,
  loadHistoricalPostSessionReview,
  type PostSessionReviewSnapshotMetadata,
} from "./post-session-review-snapshot";

export type CompletedWorkoutReviewReadModel = {
  postSessionReview: PostSessionReviewDisplayDto | null;
  reviewEvidence: PostSessionReviewSnapshotMetadata | null;
};

export async function loadCompletedWorkoutReviewReadModel(
  userId: string,
  workoutId: string
): Promise<CompletedWorkoutReviewReadModel> {
  const historical = await loadHistoricalPostSessionReview(userId, workoutId);

  if (historical.status === "ready") {
    return {
      postSessionReview: adaptPostSessionReviewContractToDisplay(historical.contract),
      reviewEvidence: historical.metadata,
    };
  }

  if (historical.status === "not_found_or_unauthorized") {
    return { postSessionReview: null, reviewEvidence: null };
  }

  if (historical.status === "integrity_error") {
    return {
      postSessionReview: adaptBlockedPostSessionReviewToDisplay({
        status: "blocked",
        reason: historical.reason,
        message: historical.message,
      }),
      reviewEvidence: historical.metadata,
    };
  }

  const result = await produceCurrentPostSessionReviewInterpretation(userId, workoutId);

  if (result.status === "ready") {
    return {
      postSessionReview: adaptPostSessionReviewContractToDisplay(result.contract),
      reviewEvidence:
        result.contract.workoutIdentity.status === "COMPLETED"
          ? legacyDerivedSnapshotMetadata(result.contract)
          : null,
    };
  }

  if (result.reason === "not_found_or_unauthorized") {
    return { postSessionReview: null, reviewEvidence: null };
  }

  return {
    postSessionReview: adaptBlockedPostSessionReviewToDisplay(result),
    reviewEvidence: null,
  };
}
