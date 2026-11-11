/**
 * Normalizes raw extracted or OCR text while preserving page boundaries,
 * reading order, mathematical expressions, and markdown/pipe tables.
 */
export function normalizePageText(rawText: string): string {
  if (!rawText) return "";

  return (
    rawText
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      // Normalize non-breaking spaces and zero-width characters
      .replace(/[\u00A0\u200B\uFEFF]/g, " ")
      // Normalize common OCR math symbol glitches into clean Unicode/LaTeX equivalents
      .replace(/\\\(\s+/g, "\\(")
      .replace(/\s+\\\)/g, "\\)")
      .replace(/\\\[\s+/g, "$$")
      .replace(/\s+\\\]/g, "$$")
      // Collapse horizontal tabs/spaces without collapsing newlines or table pipes
      .split("\n")
      .map((line) => line.replace(/[ \t]{2,}/g, " ").trimEnd())
      .join("\n")
      .replace(/\n{4,}/g, "\n\n\n")
      .trim()
  );
}
