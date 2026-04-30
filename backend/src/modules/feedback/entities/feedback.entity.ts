export type FeedbackRating = "like" | "dislike";

export class FeedbackEntity {
  id!: string; // UUID
  question!: string;
  answer!: string;
  context!: string[];
  rating!: FeedbackRating;
  correction?: string;
  enabled!: boolean;
  createdAt!: Date;
}

