/**
 * Domain vocabularies: string-valued TypeScript enums, defined once here.
 * Effect Schema validates them at runtime (see money.ts /
 * menu-extraction.ts). Never inline string-literal unions for domain
 * vocab in app code, never numeric enums.
 *
 * Further enums arrive with the feature that uses them (see
 * docs/development/typescript.md, "String enums for domain vocabularies").
 * M0 needs only the two below.
 */

export enum CurrencyCode {
  VND = "VND",
  USD = "USD"
}

/** Severity of an extraction uncertainty. */
export enum UncertaintySeverity {
  Low = "low",
  Medium = "medium",
  High = "high"
}
