import {
  adaptBlockedPostSessionReviewToDisplay,
  adaptPostSessionReviewContractToDisplay,
  type PostSessionReviewDisplayDto,
} from "./post-session-review-display";
import { loadPostSessionReviewContractForWorkout } from "./post-session-review-producer";

export type CompletedWorkoutReviewReadModel = {
  postSessionReview: PostSessionReviewDisplayDto | null;
};

export async function loadCompletedWorkoutReviewReadModel(
  userId: string,
  workoutId: string
): Promise<CompletedWorkoutReviewReadModel> {
  const result = await loadPostSessionReviewContractForWorkout(userId, workoutId);

  if (result.status === "ready") {
    return {
      postSessionReview: adaptPostSessionReviewContractToDisplay(result.contract),
    };
  }

  if (result.reason === "not_found_or_unauthorized") {
    return { postSessionReview: null };
  }

  return {
    postSessionReview: adaptBlockedPostSessionReviewToDisplay(result),
  };
}
