/**
 * Future AnalyticsProvider adapter point for Buffer post/channel metrics.
 * This phase does not implement Buffer Analytics.
 */
export interface BufferAnalyticsAdapter {
  /** Reserved — wire when Buffer metrics fields are confirmed */
  fetchPostMetrics?(postId: string): Promise<unknown>
}
