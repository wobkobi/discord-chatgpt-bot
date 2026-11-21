// src/utils/urlExtractor/patterns.ts
// Shared patterns for the extractors; kept apart from index.ts so extractors can import
// them without a circular dependency.

/** Recognises image file extensions for inline detection. */
export const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif)(?:\?|$)/i;
