/**
 * Explainability Utilities
 *
 * Phase 4.1: Formatting and helper functions for explanation generation
 */

import type { Citation } from "./types";

/**
 * Format block phase into human-readable text
 *
 * @param blockType - Block type
 * @returns Formatted block name
 */
export function formatBlockPhase(
  blockType: "accumulation" | "intensification" | "realization" | "deload"
): string {
  switch (blockType) {
    case "accumulation":
      return "Accumulation";
    case "intensification":
      return "Intensification";
    case "realization":
      return "Realization";
    case "deload":
      return "Deload";
  }
}

/**
 * Format volume status into human-readable text
 *
 * @param status - Volume status
 * @returns Formatted status description
 */
export function formatVolumeStatus(
  status: "below_mev" | "at_mev" | "optimal" | "approaching_mrv" | "at_mrv"
): string {
  switch (status) {
    case "below_mev":
      return "Below minimum effective volume";
    case "at_mev":
      return "At minimum effective volume";
    case "optimal":
      return "In optimal volume range";
    case "approaching_mrv":
      return "Approaching maximum recoverable volume";
    case "at_mrv":
      return "At maximum recoverable volume";
  }
}

/**
 * Format readiness level into human-readable text
 *
 * @param readiness - Readiness level
 * @returns Formatted readiness description
 */
export function formatReadinessLevel(readiness: "fresh" | "moderate" | "fatigued"): string {
  switch (readiness) {
    case "fresh":
      return "Well-recovered";
    case "moderate":
      return "Moderately recovered";
    case "fatigued":
      return "Elevated fatigue";
  }
}

/**
 * Format citation as APA-style reference
 *
 * @param citation - Citation object
 * @returns Formatted citation string
 *
 * @example
 * formatCitation(citation) → "Maeo et al. (2023): Overhead extensions produced ~40% more growth"
 */
export function formatCitation(citation: Citation): string {
  return `${citation.authors} (${citation.year}): ${citation.finding}`;
}

/**
 * Format citation with link (for UI)
 *
 * @param citation - Citation object
 * @returns Markdown-formatted citation with link
 *
 * @example
 * formatCitationWithLink(citation) → "[Maeo et al. 2023](url): Finding..."
 */
export function formatCitationWithLink(citation: Citation): string {
  const authorYear = `${citation.authors} ${citation.year}`;
  if (citation.url) {
    return `[${authorYear}](${citation.url}): ${citation.finding}`;
  }
  return `${authorYear}: ${citation.finding}`;
}

/**
 * Format score as percentage
 *
 * @param score - Score (0-1)
 * @returns Percentage string
 *
 * @example
 * formatPercentage(0.67) → "67%"
 */
export function formatPercentage(score: number): string {
  return `${Math.round(score * 100)}%`;
}

/**
 * Format score tier (low/medium/high)
 *
 * @param score - Score (0-1)
 * @returns Tier description
 */
export function formatScoreTier(score: number): "low" | "medium" | "high" {
  if (score < 0.33) return "low";
  if (score < 0.67) return "medium";
  return "high";
}

/**
 * Format week in mesocycle
 *
 * @param weekNumber - Week number (1-indexed)
 * @param totalWeeks - Total weeks in mesocycle
 * @returns Formatted week description
 *
 * @example
 * formatWeekInMesocycle(2, 4) → "Week 2 of 4"
 */
export function formatWeekInMesocycle(weekNumber: number, totalWeeks: number): string {
  return `Week ${weekNumber} of ${totalWeeks}`;
}

/**
 * Format progression type
 *
 * @param type - Progression type
 * @returns Human-readable description
 */
export function formatProgressionType(
  type: "linear" | "double" | "autoregulated"
): string {
  switch (type) {
    case "linear":
      return "Linear progression";
    case "double":
      return "Double progression";
    case "autoregulated":
      return "Autoregulated";
  }
}

/**
 * Format rest period
 *
 * @param seconds - Rest period in seconds
 * @returns Human-readable rest period
 *
 * @example
 * formatRestPeriod(120) → "2 min"
 * formatRestPeriod(90) → "1.5 min"
 */
export function formatRestPeriod(seconds: number): string {
  const minutes = seconds / 60;
  if (minutes % 1 === 0) {
    return `${minutes} min`;
  }
  return `${minutes.toFixed(1)} min`;
}

/**
 * Pluralize word based on count
 *
 * @param count - Count
 * @param singular - Singular form
 * @param plural - Plural form (optional, defaults to singular + "s")
 * @returns Pluralized string with count
 *
 * @example
 * pluralize(1, "set") → "1 set"
 * pluralize(3, "set") → "3 sets"
 */
export function pluralize(count: number, singular: string, plural?: string): string {
  const word = count === 1 ? singular : plural ?? `${singular}s`;
  return `${count} ${word}`;
}

/**
 * Format load change percentage
 *
 * @param oldLoad - Previous load
 * @param newLoad - New load
 * @returns Formatted percentage change
 *
 * @example
 * formatLoadChange(70, 72.5) → "+3.6%"
 * formatLoadChange(80, 75) → "-6.3%"
 */
export function formatLoadChange(oldLoad: number, newLoad: number): string {
  const percentChange = ((newLoad - oldLoad) / oldLoad) * 100;
  const sign = percentChange >= 0 ? "+" : "";
  return `${sign}${percentChange.toFixed(1)}%`;
}
