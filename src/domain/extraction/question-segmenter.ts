import {
  AnswerProvenanceEnum,
  BoundingBox,
  QuestionAnswer,
  QuestionOption,
  QuestionReviewStatusEnum,
  QuestionTypeEnum,
  TiptapDoc,
  ValidatedQuestionPayload,
  ValidatedQuestionPayloadSchema
} from "@/domain/schemas/question.schema";
import { textToTiptapDoc, tiptapDocToPlainText } from "@/domain/richtext/tiptap-converter";
import { normalizePageText } from "./text-normalizer";

export interface PageTextInput {
  pageNumber: number;
  text: string;
  ocrConfidence?: number | null;
  warnings?: string[];
  boundingBoxes?: Array<{
    text: string;
    confidence: number;
    boundingBox: { x: number; y: number; width: number; height: number };
  }>;
}

export interface SegmentedQuestionCandidate {
  payload: ValidatedQuestionPayload;
  rawBlockText: string;
  needsAiRepair: boolean;
  aiRepairReasons: string[];
}

interface IndexedLine {
  pageNumber: number;
  text: string;
  ocrConfidence: number;
}

const SECTION_HEADER_REGEX =
  /^(?:SECTION|PART)\s*[-–:]?\s*([A-Z0-9IVX]+)(?:\s*[-–:]\s*(.*))?$/i;

const ANSWER_KEY_HEADER_REGEX =
  /^(?:ANSWER\s+KEY|ANSWERS|OFFICIAL\s+ANSWER\s+KEY)\s*:?\s*$/i;

const EXPLANATION_SECTION_HEADER_REGEX =
  /^(?:EXPLANATIONS|DETAILED\s+EXPLANATIONS|SOLUTIONS|HINTS\s*(?:&|AND)\s*SOLUTIONS)\s*:?\s*$/i;

const PASSAGE_HEADER_REGEX =
  /^(?:PASSAGE|DIRECTIONS|COMPREHENSION)\s*(?:\((?:Q\.?\s*)?(\d+)\s*[-–to]+\s*(\d+)\))?\s*:?\s*(.*)$/i;

/**
 * Matches all required question numbering styles:
 * 1. | 1) | Q1. | Q.1 | Question 1 | 01. | 1(a) | 1(b) | Q1(a).
 * Supports both standalone question numbers (empty body) and inline question stems.
 */
const QUESTION_START_REGEX =
  /^(?:(Q\.?\s*\d+(?:\([a-z]\))?)\s*[.):-]?|(Question\s+\d+(?:\([a-z]\))?)\s*[.:)-]?|(\d{1,3}\([a-z]\))\s*[.):-]?|(\d{1,3})\s*[.)])(?:\s+(.+)|(?=[A-Za-z$"'`])(.+)|$)$/i;

const PAGE_FOOTER_REGEX =
  /^(?:\[?\s*page\s+\d+(?:\s*(?:of|\/|-)\s*\d+)?\s*\]?|\d+\s*(?:of|\/)\s*\d+|\s*[-–—]\s*\d+\s*[-–—]\s*)$/i;

const INLINE_ANSWER_REGEX =
  /^(?:Correct\s+Answer|Answer|Ans\.?|Key)\s*[:\-–.]\s*(.+)$/i;

const INLINE_EXPLANATION_START_REGEX =
  /^(?:Explanation|Solution|Rationale|Hint)\s*[:\-–]\s*(.*)$/i;

const OPTION_LINE_START_REGEX =
  /^(?:\(([A-Ha-h1-8])\)|\[([A-Ha-h1-8])\]|([A-Ha-h])[:.)])\s+(.+)$/;

const PROSE_PREFIX_REGEX =
  /(?:\b(?:Point|Vitamin|Figure|Fig|Table|Type|Part|Section|Group|Grade|Class|Step|Item|Rule|Case|Phase|Block|Appendix|Lemma|Theorem|Sample|Method|Set|Line|Angle|Triangle|Matrix|Vector|Equation|Stage|Level|Model)\s+)$/i;

function extractQuestionNumberAndBody(line: string): {
  rawNumber: string;
  normalizedId: string;
  body: string;
} | null {
  const trimmed = line.trim();
  // Avoid matching inside markdown pipe tables
  if (trimmed.startsWith("|")) return null;

  const match = trimmed.match(QUESTION_START_REGEX);
  if (!match) return null;

  const rawToken = (match[1] || match[2] || match[3] || match[4] || "").trim();
  const body = (match[5] || match[6] || "").trim();
  if (!rawToken) return null;

  const normalizedId = normalizeQuestionIdentifier(rawToken);
  return {
    rawNumber: rawToken,
    normalizedId,
    body
  };
}

export function normalizeQuestionIdentifier(raw: string): string {
  return raw
    .trim()
    .replace(/^Question\s+/i, "")
    .replace(/^Q\.?\s*/i, "")
    .replace(/[.):]+$/, "")
    .replace(/^0+(\d)/, "$1")
    .toLowerCase();
}

interface RawQuestionAccumulator {
  rawQuestionNumber: string;
  normalizedId: string;
  sectionName: string | null;
  sectionTypeHint: QuestionTypeEnum | null;
  explicitTypeTag: QuestionTypeEnum | null;
  startPage: number;
  endPage: number;
  minOcrConfidence: number;
  stemLines: string[];
  optionMap: Map<string, string[]>;
  optionOrder: string[];
  currentOptionId: string | null;
  inlineAnswerRaw: string | null;
  explanationLines: string[];
  inExplanation: boolean;
  sharedPassageText: string | null;
  rawLines: string[];
  warnings: string[];
}

/**
 * Segments continuous multi-page text into individual structured questions,
 * matching end-of-document answer keys and explanation sections, detecting question types,
 * and converting all content into validated Tiptap JSON.
 */
export function segmentAndParseQuestions(
  pages: PageTextInput[]
): SegmentedQuestionCandidate[] {
  const indexedLines: IndexedLine[] = [];
  const pageWarningsMap = new Map<number, string[]>();

  for (const page of pages) {
    const normalized = normalizePageText(page.text);
    const conf = page.ocrConfidence ?? 1.0;
    if (page.warnings && page.warnings.length > 0) {
      pageWarningsMap.set(page.pageNumber, page.warnings);
    }
    const splitLines = normalized.split("\n");
    for (const line of splitLines) {
      indexedLines.push({
        pageNumber: page.pageNumber,
        text: line,
        ocrConfidence: conf
      });
    }
  }

  let mode: "QUESTIONS" | "ANSWER_KEY" | "EXPLANATIONS" = "QUESTIONS";
  let currentSection: string | null = null;
  let currentSectionTypeHint: QuestionTypeEnum | null = null;
  let activePassageText: string | null = null;
  let activePassageEndQ: number | null = null;
  let collectingPassage = false;
  let passageLines: string[] = [];

  const questions: RawQuestionAccumulator[] = [];
  let currentQ: RawQuestionAccumulator | null = null;

  const answerKeyLines: Array<{ section: string | null; line: string }> = [];
  let answerKeySection: string | null = null;

  const explanationSectionMap = new Map<string, string[]>();
  let currentExplanationTargetId: string | null = null;

  const flushCurrentQuestion = () => {
    if (currentQ) {
      const hasStem = currentQ.stemLines.some((l) => l.trim().length > 0);
      const hasOptions = currentQ.optionOrder.length > 0;
      if (hasStem || hasOptions) {
        questions.push(currentQ);
      }
      currentQ = null;
    }
  };

  for (let i = 0; i < indexedLines.length; i++) {
    const { pageNumber, text: rawLine, ocrConfidence } = indexedLines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      if (mode === "QUESTIONS" && currentQ && currentQ.inExplanation) {
        currentQ.explanationLines.push("");
      } else if (
        mode === "EXPLANATIONS" &&
        currentExplanationTargetId &&
        explanationSectionMap.has(currentExplanationTargetId)
      ) {
        explanationSectionMap.get(currentExplanationTargetId)!.push("");
      }
      continue;
    }

    // Ignore page footers/page numbers so they do not pollute stems, options, or passages
    if (PAGE_FOOTER_REGEX.test(trimmed)) {
      continue;
    }

    // Check for top-level Answer Key section header
    if (ANSWER_KEY_HEADER_REGEX.test(trimmed)) {
      flushCurrentQuestion();
      collectingPassage = false;
      mode = "ANSWER_KEY";
      answerKeySection = null;
      continue;
    }

    // Check for top-level Explanations / Solutions section header
    if (EXPLANATION_SECTION_HEADER_REGEX.test(trimmed)) {
      flushCurrentQuestion();
      collectingPassage = false;
      mode = "EXPLANATIONS";
      currentExplanationTargetId = null;
      continue;
    }

    if (mode === "ANSWER_KEY") {
      const secMatch = trimmed.match(SECTION_HEADER_REGEX);
      if (secMatch) {
        answerKeySection = `Section ${secMatch[1].toUpperCase()}`;
        continue;
      }
      answerKeyLines.push({ section: answerKeySection, line: trimmed });
      continue;
    }

    if (mode === "EXPLANATIONS") {
      const qStart = extractQuestionNumberAndBody(trimmed);
      if (qStart) {
        currentExplanationTargetId = qStart.normalizedId;
        explanationSectionMap.set(
          currentExplanationTargetId,
          qStart.body ? [qStart.body] : []
        );
      } else if (currentExplanationTargetId) {
        const existing = explanationSectionMap.get(currentExplanationTargetId) || [];
        existing.push(trimmed);
        explanationSectionMap.set(currentExplanationTargetId, existing);
      }
      continue;
    }

    // Inside QUESTIONS mode:
    // 1. Check Section Header
    const sectionMatch = trimmed.match(SECTION_HEADER_REGEX);
    if (sectionMatch) {
      const secId = sectionMatch[1].toUpperCase();
      const secDesc = (sectionMatch[2] || "").trim();
      const candidateSection = secDesc ? `Section ${secId}: ${secDesc}` : `Section ${secId}`;

      // Check if this is a repeated running section header across pages
      const isRepeatedSectionHeader =
        currentSection !== null &&
        (candidateSection.toLowerCase() === currentSection.toLowerCase() ||
          currentSection.toLowerCase().startsWith(`section ${secId.toLowerCase()}:`) ||
          currentSection.toLowerCase() === `section ${secId.toLowerCase()}`) &&
        pageNumber > 1 &&
        currentQ !== null;

      if (isRepeatedSectionHeader) {
        // Do not flush the active multi-page question
        continue;
      }

      flushCurrentQuestion();
      collectingPassage = false;
      currentSection = candidateSection;
      currentSectionTypeHint = inferTypeFromText(secDesc);
      activePassageText = null;
      activePassageEndQ = null;
      continue;
    }

    // 2. Check Shared Passage Header
    const passageMatch = trimmed.match(PASSAGE_HEADER_REGEX);
    if (passageMatch) {
      flushCurrentQuestion();
      collectingPassage = true;
      passageLines = [];
      if (passageMatch[2]) {
        activePassageEndQ = Number.parseInt(passageMatch[2], 10);
      } else {
        activePassageEndQ = null;
      }
      if (passageMatch[3]?.trim()) {
        passageLines.push(passageMatch[3].trim());
      }
      continue;
    }

    // 3. Check Question Start
    const qStart = extractQuestionNumberAndBody(trimmed);
    if (qStart) {
      if (collectingPassage && passageLines.length > 0) {
        activePassageText = passageLines.join("\n").trim();
        collectingPassage = false;
      }
      flushCurrentQuestion();

      const numericNum = Number.parseInt(qStart.normalizedId, 10);
      if (
        activePassageEndQ !== null &&
        Number.isFinite(numericNum) &&
        numericNum > activePassageEndQ
      ) {
        activePassageText = null;
        activePassageEndQ = null;
      }

      let bodyText = qStart.body;
      let explicitTypeTag: QuestionTypeEnum | null = null;
      const typeTagMatch = bodyText.match(/^\[TYPE:(MCQ|MSQ|TRUE_FALSE|UNKNOWN)\]\s*(.*)$/i);
      if (typeTagMatch) {
        explicitTypeTag = typeTagMatch[1].toUpperCase() as QuestionTypeEnum;
        bodyText = typeTagMatch[2];
      }

      currentQ = {
        rawQuestionNumber: qStart.rawNumber,
        normalizedId: qStart.normalizedId,
        sectionName: currentSection,
        sectionTypeHint: currentSectionTypeHint,
        explicitTypeTag,
        startPage: pageNumber,
        endPage: pageNumber,
        minOcrConfidence: ocrConfidence,
        stemLines: bodyText ? [bodyText] : [],
        optionMap: new Map(),
        optionOrder: [],
        currentOptionId: null,
        inlineAnswerRaw: null,
        explanationLines: [],
        inExplanation: false,
        sharedPassageText: activePassageText,
        rawLines: [trimmed],
        warnings: [...(pageWarningsMap.get(pageNumber) || [])]
      };
      continue;
    }

    if (collectingPassage) {
      passageLines.push(trimmed);
      continue;
    }

    if (!currentQ) {
      continue;
    }

    currentQ.endPage = Math.max(currentQ.endPage, pageNumber);
    currentQ.minOcrConfidence = Math.min(currentQ.minOcrConfidence, ocrConfidence);
    currentQ.rawLines.push(trimmed);
    if (pageNumber > currentQ.startPage) {
      const pageWarns = pageWarningsMap.get(pageNumber) || [];
      for (const w of pageWarns) {
        if (!currentQ.warnings.includes(w)) {
          currentQ.warnings.push(w);
        }
      }
    }

    // 4. Check Inline Answer inside current question
    const ansMatch = trimmed.match(INLINE_ANSWER_REGEX);
    if (ansMatch) {
      currentQ.inlineAnswerRaw = ansMatch[1].trim();
      currentQ.currentOptionId = null;
      currentQ.inExplanation = false;
      continue;
    }

    // 5. Check Inline Explanation start
    const expMatch = trimmed.match(INLINE_EXPLANATION_START_REGEX);
    if (expMatch) {
      currentQ.inExplanation = true;
      currentQ.currentOptionId = null;
      if (expMatch[1]?.trim()) {
        currentQ.explanationLines.push(expMatch[1].trim());
      }
      continue;
    }

    if (currentQ.inExplanation) {
      currentQ.explanationLines.push(trimmed);
      continue;
    }

    // 6. Check Option line (including multiple inline options on a single line)
    const inlineOptions = parseOptionsFromLine(trimmed);
    if (inlineOptions.length > 0) {
      for (const opt of inlineOptions) {
        const optId = opt.id.toUpperCase();
        if (currentQ.optionMap.has(optId)) {
          currentQ.warnings.push(`Duplicate option label (${optId}) detected.`);
        } else {
          currentQ.optionOrder.push(optId);
        }
        currentQ.optionMap.set(optId, [opt.text]);
        currentQ.currentOptionId = optId;
      }
      continue;
    }

    // 7. Continuation line: append to active option if inside options, otherwise append to question stem
    if (currentQ.currentOptionId) {
      const existingOptLines = currentQ.optionMap.get(currentQ.currentOptionId) || [];
      existingOptLines.push(trimmed);
      currentQ.optionMap.set(currentQ.currentOptionId, existingOptLines);
    } else {
      currentQ.stemLines.push(trimmed);
    }
  }

  flushCurrentQuestion();

  // Parse end-of-document Answer Key entries
  const parsedAnswerKey = parseAnswerKeyEntries(answerKeyLines);

  // Check if question identifiers are duplicated across sections (for answer key ambiguity check)
  const idFrequency = new Map<string, number>();
  for (const q of questions) {
    idFrequency.set(q.normalizedId, (idFrequency.get(q.normalizedId) || 0) + 1);
  }

  return questions.map((q, idx) =>
    buildQuestionCandidate(
      q,
      idx + 1,
      parsedAnswerKey,
      explanationSectionMap,
      idFrequency
    )
  );
}

function parseOptionsFromLine(line: string): Array<{ id: string; text: string }> {
  // Check for multiple options on the same line, supporting delimiters:
  // (A), [A], A), A., A:, (1), [1] separated by one or more spaces
  const multiRegex =
    /(?:^|\s+)(?:(\(([A-Ha-h1-8])\))|(\[([A-Ha-h1-8])\])|([A-Ha-h])([:.)]))(?=\s+)/g;

  interface Token {
    id: string;
    style: "PAREN" | "BRACKET" | "POST_PAREN" | "POST_DOT" | "POST_COLON";
    startIdx: number;
    contentStartIdx: number;
  }

  const rawTokens: Token[] = [];
  let m: RegExpExecArray | null;

  while ((m = multiRegex.exec(line)) !== null) {
    let style: Token["style"] = "POST_DOT";
    let id = "";

    if (m[1]) {
      style = "PAREN";
      id = m[2].toUpperCase();
    } else if (m[3]) {
      style = "BRACKET";
      id = m[4].toUpperCase();
    } else if (m[5]) {
      id = m[5].toUpperCase();
      const delim = m[6];
      if (delim === ")") style = "POST_PAREN";
      else if (delim === ":") style = "POST_COLON";
      else style = "POST_DOT";
    }

    const tokenStartInLine =
      m.index === 0 ? 0 : m.index + (m[0].length - m[0].trimStart().length);
    const contentStartIdx = m.index + m[0].length;

    // Reject token if preceded by common prose nouns like "Vitamin A.", "Point B."
    const precedingText = line.slice(0, tokenStartInLine);
    if (tokenStartInLine > 0 && PROSE_PREFIX_REGEX.test(precedingText)) {
      continue;
    }

    rawTokens.push({
      id,
      style,
      startIdx: tokenStartInLine,
      contentStartIdx
    });
  }

  // To be valid inline options, the line must start with an option at index 0
  if (rawTokens.length >= 2 && rawTokens[0].startIdx === 0) {
    const firstToken = rawTokens[0];
    const targetStyle = firstToken.style;
    const selected: Token[] = [firstToken];
    let expectedCharCode = firstToken.id.charCodeAt(0) + 1;

    for (let i = 1; i < rawTokens.length; i++) {
      const candidate = rawTokens[i];
      // Must match same delimiter style and exact alphabetical sequence progression (e.g. A -> B -> C -> D)
      if (
        candidate.style === targetStyle &&
        candidate.id.charCodeAt(0) === expectedCharCode
      ) {
        // Ensure there is non-empty content between previous option and candidate
        const prev = selected[selected.length - 1];
        const contentBetween = line.slice(prev.contentStartIdx, candidate.startIdx).trim();
        if (contentBetween.length > 0) {
          selected.push(candidate);
          expectedCharCode++;
        }
      }
    }

    // Must have at least 2 validated sequential options and non-empty last option
    if (selected.length >= 2) {
      const last = selected[selected.length - 1];
      const lastContent = line.slice(last.contentStartIdx).trim();
      if (lastContent.length > 0) {
        return selected.map((item, idx) => {
          const endIdx =
            idx + 1 < selected.length ? selected[idx + 1].startIdx : line.length;
          return {
            id: item.id,
            text: line.slice(item.contentStartIdx, endIdx).trim()
          };
        });
      }
    }
  }

  // Fallback to single option per line
  const singleMatch = line.match(OPTION_LINE_START_REGEX);
  if (singleMatch) {
    const id = (singleMatch[1] || singleMatch[2] || singleMatch[3] || "").toUpperCase();
    return [{ id, text: singleMatch[4].trim() }];
  }

  return [];
}

interface ParsedAnswerKeyMap {
  bySectionAndId: Map<string, string[]>;
  byIdOnly: Map<string, string[][]>;
}

function parseAnswerKeyEntries(
  entries: Array<{ section: string | null; line: string }>
): ParsedAnswerKeyMap {
  const bySectionAndId = new Map<string, string[]>();
  const byIdOnly = new Map<string, string[][]>();

  // Matches "1. B", "Q1: A, C", "1(a) - True", "02) (D)", "1. Ans. B", "1. Correct Answer: (C)", "1. (1)"
  const pairRegex =
    /(?:Q\.?\s*)?(\d{1,3}(?:\([a-z]\))?)\s*[:.)\-–]\s*(?:(?:Correct\s+Answer|Answer|Ans\.?|Key)\s*[:\-–.]\s*)?(\(?[A-Fa-f1-8]\)?(?:\s*[,&]\s*\(?[A-Fa-f1-8]\)?)*|True|False)/gi;

  for (const { section, line } of entries) {
    let match: RegExpExecArray | null;
    pairRegex.lastIndex = 0;
    while ((match = pairRegex.exec(line)) !== null) {
      const qId = normalizeQuestionIdentifier(match[1]);
      const rawAns = match[2];
      const values = parseAnswerValues(rawAns);
      if (values.length === 0) continue;

      if (section) {
        const secKey = `${section.toLowerCase()}::${qId}`;
        bySectionAndId.set(secKey, values);
      }
      const existingList = byIdOnly.get(qId) || [];
      existingList.push(values);
      byIdOnly.set(qId, existingList);
    }
  }

  return { bySectionAndId, byIdOnly };
}

export function parseAnswerValues(raw: string): string[] {
  const cleaned = raw.trim();
  if (!cleaned) return [];

  if (/^true$/i.test(cleaned) || /^\(?T\)?$/i.test(cleaned)) {
    return ["True"];
  }
  if (/^false$/i.test(cleaned) || /^\(?F\)?$/i.test(cleaned)) {
    return ["False"];
  }

  // Extract option letters A-F or numbers 1-8
  const parts = cleaned
    .split(/[,;&/]+|\band\b/i)
    .map((p) => p.replace(/[()[\].\s]/g, "").toUpperCase())
    .filter((p) => /^[A-F1-8]$/.test(p));

  if (parts.length > 0) {
    return Array.from(new Set(parts));
  }

  return [cleaned];
}

export interface MatchAnswerResult {
  matchedIds: string[];
  isMatched: boolean;
  isAmbiguous: boolean;
  unmatchedReason?: string;
}

export function normalizeAnswerText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/^[(\[{'"]+/, "")
    .replace(/[)\]}'".;:,]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Matches an extracted raw answer string to actual question options.
 * Matches by:
 * 1. Exact option ID/letter (e.g. "B", "(B)", "[B]", "C.")
 * 2. Combined label + text (e.g. "B) Chennai", "(B) Chennai")
 * 3. True/False shorthand ("True", "False", "T", "F")
 * 4. Normalized full option text (e.g. "Chennai")
 *
 * If any token is unrecognized, invalid, or matches multiple options ambiguously,
 * returns isMatched: false and matchedIds: [] without guessing.
 */
export function matchAnswerToOptions(
  rawAnswer: string,
  options: QuestionOption[]
): MatchAnswerResult {
  const cleaned = rawAnswer.trim();
  if (!cleaned) {
    return { matchedIds: [], isMatched: false, isAmbiguous: false };
  }

  if (options.length === 0) {
    return {
      matchedIds: [],
      isMatched: false,
      isAmbiguous: false,
      unmatchedReason: "No options available to match answer against."
    };
  }

  const optionLookup = options.map((opt) => {
    const rawText = tiptapDocToPlainText(opt.content).trim();
    return {
      rawId: opt.id,
      upperId: opt.id.trim().toUpperCase(),
      plainText: rawText,
      normalizedText: normalizeAnswerText(rawText)
    };
  });

  // Split on MSQ delimiters (comma, semicolon, or word 'and' / '&')
  const tokens = cleaned
    .split(/[,;&]|\band\b/i)
    .map((t) => t.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return { matchedIds: [], isMatched: false, isAmbiguous: false };
  }

  const matchedSet = new Set<string>();

  for (const token of tokens) {
    // 1. Exact option ID match: e.g. "B", "(B)", "[B]", "B.", "(C)"
    const idCandidate = token
      .replace(/^[(\[{'"]+/, "")
      .replace(/[)\]}'".;:,]+$/, "")
      .trim()
      .toUpperCase();

    const idMatches = optionLookup.filter((o) => o.upperId === idCandidate);
    if (idMatches.length === 1) {
      matchedSet.add(idMatches[0].rawId);
      continue;
    }

    // 2. Combined label + text match: e.g. "B) Chennai", "(B) Chennai", "B. Chennai", "Option B: Chennai"
    const combinedMatch = token.match(
      /^(?:Option\s+)?\(?([A-Za-z0-9]+)\)?[.:\-–\s]+\s*(.+)$/i
    );
    if (combinedMatch) {
      const labelToken = combinedMatch[1].trim().toUpperCase();
      const textToken = normalizeAnswerText(combinedMatch[2]);
      const labelMatches = optionLookup.filter((o) => o.upperId === labelToken);
      if (labelMatches.length === 1) {
        matchedSet.add(labelMatches[0].rawId);
        continue;
      }
      if (textToken) {
        const textMatches = optionLookup.filter((o) => o.normalizedText === textToken);
        if (textMatches.length === 1) {
          matchedSet.add(textMatches[0].rawId);
          continue;
        } else if (textMatches.length > 1) {
          return {
            matchedIds: [],
            isMatched: false,
            isAmbiguous: true,
            unmatchedReason: `Ambiguous match: answer "${token}" matches multiple options.`
          };
        }
      }
    }

    // 3. True / False shorthand or text match
    if (/^(?:True|T)$/i.test(token)) {
      const tfMatches = optionLookup.filter(
        (o) => o.upperId === "TRUE" || o.normalizedText === "true"
      );
      if (tfMatches.length === 1) {
        matchedSet.add(tfMatches[0].rawId);
        continue;
      } else if (tfMatches.length > 1) {
        return {
          matchedIds: [],
          isMatched: false,
          isAmbiguous: true,
          unmatchedReason: `Ambiguous match: answer "${token}" matches multiple options.`
        };
      }
    }
    if (/^(?:False|F)$/i.test(token)) {
      const tfMatches = optionLookup.filter(
        (o) => o.upperId === "FALSE" || o.normalizedText === "false"
      );
      if (tfMatches.length === 1) {
        matchedSet.add(tfMatches[0].rawId);
        continue;
      } else if (tfMatches.length > 1) {
        return {
          matchedIds: [],
          isMatched: false,
          isAmbiguous: true,
          unmatchedReason: `Ambiguous match: answer "${token}" matches multiple options.`
        };
      }
    }

    // 4. Normalized full text match: e.g. "Chennai", "Mumbai"
    const normToken = normalizeAnswerText(token);
    const textMatches = optionLookup.filter(
      (o) => o.normalizedText.length > 0 && o.normalizedText === normToken
    );

    if (textMatches.length === 1) {
      matchedSet.add(textMatches[0].rawId);
      continue;
    } else if (textMatches.length > 1) {
      // Ambiguous: multiple options share identical text!
      return {
        matchedIds: [],
        isMatched: false,
        isAmbiguous: true,
        unmatchedReason: `Ambiguous match: answer "${token}" matches multiple options.`
      };
    }

    // Token could not be matched to any option!
    return {
      matchedIds: [],
      isMatched: false,
      isAmbiguous: false,
      unmatchedReason: `Unrecognized or invalid answer option "${token}".`
    };
  }

  // Preserve question optionOrder sequence for matched IDs
  const matchedList = options
    .map((o) => o.id)
    .filter((id) => matchedSet.has(id));

  return {
    matchedIds: matchedList,
    isMatched: matchedList.length > 0,
    isAmbiguous: false
  };
}

function inferTypeFromText(text: string): QuestionTypeEnum | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  if (
    lower.includes("true/false") ||
    lower.includes("true or false") ||
    lower.includes("state whether true or false")
  ) {
    return "TRUE_FALSE";
  }
  if (
    lower.includes("multiple select") ||
    lower.includes("msq") ||
    lower.includes("one or more than one") ||
    lower.includes("select all that apply") ||
    lower.includes("more than one correct")
  ) {
    return "MSQ";
  }
  if (
    lower.includes("multiple choice") ||
    lower.includes("mcq") ||
    lower.includes("single correct") ||
    lower.includes("only one option is correct") ||
    lower.includes("choose the correct option") ||
    lower.includes("which one of the following")
  ) {
    return "MCQ";
  }
  return null;
}

function buildQuestionCandidate(
  acc: RawQuestionAccumulator,
  sourceOrder: number,
  answerKey: ParsedAnswerKeyMap,
  explanationSectionMap: Map<string, string[]>,
  idFrequency: Map<string, number>
): SegmentedQuestionCandidate {
  const stemText = acc.stemLines.join("\n").trim();
  const warnings = [...acc.warnings];
  const aiRepairReasons: string[] = [];

  // Build ordered options
  const options: QuestionOption[] = acc.optionOrder.map((id) => ({
    id,
    content: textToTiptapDoc((acc.optionMap.get(id) || [""]).join("\n"))
  }));

  // Check if options are True/False
  const isTrueFalseOptions =
    options.length === 2 &&
    options.some((o) => /true/i.test(JSON.stringify(o.content))) &&
    options.some((o) => /false/i.test(JSON.stringify(o.content)));

  // Resolve Answer & Provenance
  let rawAnswerCandidate: string | null = null;
  let provenance: AnswerProvenanceEnum = "MISSING";
  let answerStatus: QuestionAnswer["status"] = "missing";

  if (acc.inlineAnswerRaw) {
    rawAnswerCandidate = acc.inlineAnswerRaw;
    provenance = "EXPLICIT_SOURCE";
    answerStatus = "extracted";
  } else {
    // Check section-scoped Answer Key first
    const secPrefix = acc.sectionName
      ? acc.sectionName.split(":")[0].trim().toLowerCase()
      : null;
    const scopedMatch = secPrefix
      ? answerKey.bySectionAndId.get(`${secPrefix}::${acc.normalizedId}`)
      : undefined;

    if (scopedMatch) {
      rawAnswerCandidate = scopedMatch.join(", ");
      provenance = "ANSWER_KEY";
      answerStatus = "answer_key";
    } else {
      const unscopedMatches = answerKey.byIdOnly.get(acc.normalizedId) || [];
      if (unscopedMatches.length === 1 && (idFrequency.get(acc.normalizedId) || 1) === 1) {
        rawAnswerCandidate = unscopedMatches[0].join(", ");
        provenance = "ANSWER_KEY";
        answerStatus = "answer_key";
      } else if (
        unscopedMatches.length > 1 ||
        (unscopedMatches.length === 1 && (idFrequency.get(acc.normalizedId) || 1) > 1)
      ) {
        // Ambiguous answer key match!
        rawAnswerCandidate = unscopedMatches[0].join(", ");
        provenance = "ANSWER_KEY";
        answerStatus = "uncertain";
        warnings.push(
          `Ambiguous answer key match for question "${acc.rawQuestionNumber}" across multiple sections.`
        );
        aiRepairReasons.push("AMBIGUOUS_ANSWER_KEY_MATCH");
      }
    }
  }

  // Pre-detect True/False to populate True/False options if needed before matching
  const stemTypeHint = inferTypeFromText(stemText);
  const isRawTrueFalse =
    rawAnswerCandidate !== null &&
    /^(?:True|False|T|F)$/i.test(rawAnswerCandidate.trim());

  if (
    !acc.explicitTypeTag &&
    (isTrueFalseOptions ||
      stemTypeHint === "TRUE_FALSE" ||
      acc.sectionTypeHint === "TRUE_FALSE" ||
      isRawTrueFalse)
  ) {
    if (options.length === 0) {
      options.push(
        { id: "True", content: textToTiptapDoc("True") },
        { id: "False", content: textToTiptapDoc("False") }
      );
    }
  }

  // Match raw answer to actual options
  let answerValues: string[] = [];
  if (rawAnswerCandidate) {
    const matchResult = matchAnswerToOptions(rawAnswerCandidate, options);
    if (matchResult.isMatched) {
      answerValues = matchResult.matchedIds;
    } else {
      answerValues = [];
      if (matchResult.isAmbiguous) {
        answerStatus = "uncertain";
        warnings.push(
          `Ambiguous answer "${rawAnswerCandidate.trim()}" matches multiple options; leaving options unselected for manual review.`
        );
      } else {
        answerStatus = "missing";
        warnings.push(
          `Unrecognized or invalid answer "${rawAnswerCandidate.trim()}" rejected; leaving options unselected for manual review.`
        );
      }
    }
  }

  // Detect Question Type (FR-06)
  let detectedType: QuestionTypeEnum = "UNKNOWN";

  if (acc.explicitTypeTag) {
    detectedType = acc.explicitTypeTag;
  } else if (
    isTrueFalseOptions ||
    stemTypeHint === "TRUE_FALSE" ||
    acc.sectionTypeHint === "TRUE_FALSE" ||
    isRawTrueFalse ||
    (answerValues.length === 1 && /^(True|False)$/i.test(answerValues[0]))
  ) {
    detectedType = "TRUE_FALSE";
  } else if (
    stemTypeHint === "MSQ" ||
    acc.sectionTypeHint === "MSQ" ||
    answerValues.length > 1 ||
    (rawAnswerCandidate && /[,;&]|\band\b/i.test(rawAnswerCandidate))
  ) {
    detectedType = "MSQ";
  } else if (stemTypeHint === "MCQ" || acc.sectionTypeHint === "MCQ") {
    detectedType = "MCQ";
  } else if (
    options.length >= 2 &&
    answerValues.length === 1 &&
    !/option\(s\)|one or more/i.test(stemText)
  ) {
    detectedType = "MCQ";
  } else if (options.length >= 2 && /option\(s\)/i.test(stemText)) {
    // Source does not distinguish MCQ from MSQ ("select the correct option(s)")
    detectedType = "UNKNOWN";
    warnings.push(
      "Source does not distinguish whether this question is single-choice (MCQ) or multiple-select (MSQ)."
    );
    aiRepairReasons.push("UNCERTAIN_QUESTION_TYPE");
  } else if (options.length >= 2) {
    // Check if options are well-formed A, B, C, D; if no answer and no explicit section/stem cue, mark for review
    detectedType = "UNKNOWN";
    warnings.push(
      "Question has options but no explicit MCQ/MSQ indicator or answer key to confirm single vs multiple select."
    );
  } else {
    detectedType = "UNKNOWN";
    warnings.push("No standard options detected; question type is UNKNOWN.");
    aiRepairReasons.push("MISSING_OR_MALFORMED_OPTIONS");
  }

  // Validate option label sequence for MCQ/MSQ
  if (options.length > 0 && detectedType !== "TRUE_FALSE") {
    const isNumericOptions = /^[1-9]$/.test(options[0].id);
    const expectedLabels = isNumericOptions
      ? ["1", "2", "3", "4", "5", "6", "7", "8"]
      : ["A", "B", "C", "D", "E", "F"];
    for (let i = 0; i < options.length; i++) {
      if (options[i].id !== expectedLabels[i]) {
        warnings.push(
          `Option label sequence irregularity: expected (${expectedLabels[i]}) but found (${options[i].id}).`
        );
        aiRepairReasons.push("MALFORMED_OPTION_LABELS");
        break;
      }
    }
    if (options.length < 2) {
      warnings.push("Fewer than 2 options extracted for choice question.");
      aiRepairReasons.push("INCOMPLETE_OPTIONS");
    }
  }

  // Resolve Explanation (inline or from end-of-document Explanations section)
  let explanationDoc: TiptapDoc | null = null;
  if (acc.explanationLines.length > 0) {
    explanationDoc = textToTiptapDoc(acc.explanationLines.join("\n"));
  } else if (explanationSectionMap.has(acc.normalizedId)) {
    const secExpLines = explanationSectionMap.get(acc.normalizedId)!;
    if (secExpLines.length > 0) {
      explanationDoc = textToTiptapDoc(secExpLines.join("\n"));
    }
  }

  const answerTypeMap: Record<QuestionTypeEnum, QuestionAnswer["type"]> = {
    MCQ: "mcq",
    MSQ: "msq",
    TRUE_FALSE: "true_false",
    UNKNOWN: "unknown"
  };

  const answerObj: QuestionAnswer = {
    type: answerTypeMap[detectedType],
    value: answerValues,
    status: answerStatus
  };

  // Compute parser confidence
  let confidence = acc.minOcrConfidence;
  if (detectedType === "UNKNOWN") confidence = Math.min(confidence, 0.68);
  if (provenance === "MISSING") confidence = Math.min(confidence, 0.82);
  if (aiRepairReasons.length > 0) confidence = Math.min(confidence, 0.65);
  confidence = Number(Math.max(0.1, Math.min(1.0, confidence)).toFixed(2));

  if (acc.minOcrConfidence < 0.78) {
    warnings.push(
      `Low OCR confidence (${(acc.minOcrConfidence * 100).toFixed(0)}%) on source page.`
    );
    aiRepairReasons.push("LOW_OCR_CONFIDENCE");
  }

  const reviewStatus: QuestionReviewStatusEnum =
    warnings.length > 0 || detectedType === "UNKNOWN" || confidence < 0.8
      ? "NEEDS_ATTENTION"
      : "PENDING_REVIEW";

  const boundingBox: BoundingBox = {
    page: acc.startPage,
    x: 44,
    y: 60 + ((sourceOrder - 1) % 5) * 130,
    width: 520,
    height: 110
  };

  const payload: ValidatedQuestionPayload = ValidatedQuestionPayloadSchema.parse({
    question: textToTiptapDoc(stemText),
    options,
    answer: answerObj,
    explanation: explanationDoc,
    type: detectedType,
    sourcePage: acc.startPage,
    sourcePageEnd: acc.endPage > acc.startPage ? acc.endPage : undefined,
    sourceQuestionNumber: acc.rawQuestionNumber,
    sourceSection: acc.sectionName,
    sourceOrder,
    confidence,
    answerProvenance: provenance,
    reviewStatus,
    sharedPassage: acc.sharedPassageText ? textToTiptapDoc(acc.sharedPassageText) : null,
    boundingBox,
    warnings,
    aiRepaired: false,
    aiRepairModel: null,
    aiRepairReason: null
  });

  return {
    payload,
    rawBlockText: acc.rawLines.join("\n"),
    needsAiRepair: aiRepairReasons.length > 0,
    aiRepairReasons
  };
}
