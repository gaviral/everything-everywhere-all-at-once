/** Advisor owns its input; it never reads speech, map contents or credentials. */
export const EXAMPLE_QUESTION = "Should our demo show every feature, or one complete journey?";
export type MetaModel = "Llama 3.2 3B" | "Llama 3.3 70B" | "Muse Spark 1.3";
export type Answer = { text: string; model: MetaModel; source: "injected" | "live" };
export type Review = Answer & { verdict: "agree" | "disagree"; rationale: string };
export type ReviewRequest = { question: string; fast: Answer; reason: string };
/** A larger reviewer is optional: the existing Flow provider has no size selector. */
export interface AdvisorProvider {
  kind: "injected" | "live";
  fast(question: string, signal: AbortSignal): Promise<Answer>;
  review?: (request: ReviewRequest, signal: AbortSignal) => Promise<Review>;
}
export type Scenario = "disagree" | "agree" | "review-failure" | "fast-failure";
export const EXAMPLE_FAST: Answer = {
  text: "Show three features. Breadth will help the audience see how much the product can do.",
  model: "Llama 3.2 3B", source: "injected",
};
export type FastState = { status: "ready"; answer: Answer } | { status: "idle" | "running" } | { status: "failed"; message: string };
export type ReviewState = { status: "idle" | "running" } | { status: "done"; answer: Review } | { status: "failed"; message: string };
