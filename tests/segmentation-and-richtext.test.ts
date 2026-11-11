import { describe, it, expect } from "vitest";
import { segmentAndParseQuestions } from "@/domain/extraction/question-segmenter";
import {
  textToTiptapDoc,
  tiptapDocToPlainText,
  computeQuestionContentHash
} from "@/domain/richtext/tiptap-converter";
import { TiptapDocSchema, ValidatedQuestionPayloadSchema } from "@/domain/schemas/question.schema";

describe("Question Segmentation, Type Detection & Tiptap Rich-Text JSON", () => {
  it("1. Supports all required question numbering styles: 1., 1), Q1., Q.1, Question 1, 01., 1(a), 1(b)", () => {
    const rawText = [
      "Section A - Single Choice Questions (MCQ)",
      "1. First question with dot?",
      "(A) Opt 1",
      "(B) Opt 2",
      "1) Second question with parenthesis?",
      "(A) Opt 1",
      "(B) Opt 2",
      "Q1. Third question with Q prefix?",
      "(A) Opt 1",
      "(B) Opt 2",
      "Q.1 Fourth question with Q dot prefix?",
      "(A) Opt 1",
      "(B) Opt 2",
      "Question 1: Fifth question with full word?",
      "(A) Opt 1",
      "(B) Opt 2",
      "01. Sixth question with leading zero?",
      "(A) Opt 1",
      "(B) Opt 2",
      "1(a) Seventh sub-question a?",
      "(A) Opt 1",
      "(B) Opt 2",
      "1(b) Eighth sub-question b?",
      "(A) Opt 1",
      "(B) Opt 2"
    ].join("\n");

    const results = segmentAndParseQuestions([{ pageNumber: 1, text: rawText }]);
    expect(results.length).toBe(8);
    expect(results.map((r) => r.payload.sourceQuestionNumber)).toEqual([
      "1",
      "1",
      "Q1",
      "Q.1",
      "Question 1",
      "01",
      "1(a)",
      "1(b)"
    ]);
  });

  it("2. Parses MCQ, MSQ, TRUE_FALSE, and marks ambiguous optioned questions as UNKNOWN", () => {
    const rawText = [
      "Q1. Which one of the following is a prime number?",
      "(A) 4",
      "(B) 7",
      "(C) 9",
      "(D) 15",
      "Answer: B",
      "",
      "Q2. Which of the following numbers are even? Select all that apply.",
      "(A) 2",
      "(B) 3",
      "(C) 8",
      "(D) 10",
      "Answer: A, C, D",
      "",
      "Q3. The sum of angles in a Euclidean triangle is 180 degrees. (True/False)",
      "Answer: True",
      "",
      "Q4. Consider the following statements about eigenvalues:",
      "(A) Statement 1",
      "(B) Statement 2",
      "(C) Statement 3",
      "(D) Statement 4"
    ].join("\n");

    const results = segmentAndParseQuestions([{ pageNumber: 1, text: rawText }]);
    expect(results.length).toBe(4);

    // Q1 -> MCQ
    expect(results[0].payload.type).toBe("MCQ");
    expect(results[0].payload.answer).toEqual({
      type: "mcq",
      value: ["B"],
      status: "extracted"
    });
    expect(results[0].payload.answerProvenance).toBe("EXPLICIT_SOURCE");

    // Q2 -> MSQ
    expect(results[1].payload.type).toBe("MSQ");
    expect(results[1].payload.answer).toEqual({
      type: "msq",
      value: ["A", "C", "D"],
      status: "extracted"
    });

    // Q3 -> TRUE_FALSE
    expect(results[2].payload.type).toBe("TRUE_FALSE");
    expect(results[2].payload.answer).toEqual({
      type: "true_false",
      value: ["True"],
      status: "extracted"
    });

    // Q4 -> Has options, no answer, and no MCQ/MSQ indicator -> must NOT blindly assume MCQ!
    expect(results[3].payload.type).toBe("UNKNOWN");
    expect(results[3].payload.answerProvenance).toBe("MISSING");
    expect(results[3].payload.answer.value).toEqual([]);
    expect(results[3].payload.reviewStatus).toBe("NEEDS_ATTENTION");
  });

  it("3. Preserves questions spanning multiple pages without splitting them at the page boundary", () => {
    const page1 = [
      "Section A - Single Choice Questions (MCQ)",
      "Q1. A long multi-page physics problem begins at the bottom of page 1,",
      "describing a projectile launched with initial velocity $v_0 = 25\\text{ m/s}$"
    ].join("\n");

    const page2 = [
      "at an angle of $\\theta = 30^\\circ$ above the horizontal.",
      "(A) $15.9\\text{ m}$",
      "(B) $31.8\\text{ m}$",
      "(C) $27.6\\text{ m}$",
      "(D) $12.4\\text{ m}$",
      "Answer: C",
      "Explanation: Range is given by $R = \\frac{v_0^2 \\sin(2\\theta)}{g}$."
    ].join("\n");

    const results = segmentAndParseQuestions([
      { pageNumber: 1, text: page1 },
      { pageNumber: 2, text: page2 }
    ]);

    expect(results.length).toBe(1);
    const q = results[0].payload;
    expect(q.sourcePage).toBe(1);
    expect(q.sourcePageEnd).toBe(2);
    expect(q.options.length).toBe(4);
    expect(tiptapDocToPlainText(q.question)).toContain("angle of $\\theta = 30^\\circ$");
  });

  it("4. Matches end-of-document Answer Keys and flags ambiguous cross-section answer keys", () => {
    const textWithAmbiguousKey = [
      "Section A - MCQ",
      "1. First section question 1?",
      "(A) Opt A1",
      "(B) Opt B1",
      "",
      "Section B - MCQ",
      "1. Second section question 1 (numbering reset)?",
      "(A) Opt A2",
      "(B) Opt B2",
      "",
      "Answer Key:",
      "1: A"
    ].join("\n");

    const results = segmentAndParseQuestions([{ pageNumber: 1, text: textWithAmbiguousKey }]);
    expect(results.length).toBe(2);
    // Because both Section A and Section B have question "1" and the answer key is unscoped, both should be flagged!
    expect(results[0].payload.answer.status).toBe("uncertain");
    expect(results[0].payload.reviewStatus).toBe("NEEDS_ATTENTION");
    expect(results[0].payload.warnings.some((w) => w.includes("Ambiguous answer key"))).toBe(
      true
    );
  });

  it("5. Converts mathematical expressions, tables, lists, code blocks, and formatting marks into valid Tiptap JSON", () => {
    const richInput = [
      "# Thermodynamics & Calculus",
      "Evaluate the integral $\\int_0^1 x^2 dx$ with **bold**, *italic*, __underline__, H~2~O, and x^2^:",
      "$$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$",
      "| Quantity | Symbol | Unit |",
      "|---|---|---|---|",
      "| Entropy | $S$ | J/K |",
      "| Enthalpy | $H$ | J |",
      "- First bullet point",
      "- Second bullet point",
      "```python",
      "def f(x): return x ** 2",
      "```"
    ].join("\n");

    const doc = textToTiptapDoc(richInput);
    const parsed = TiptapDocSchema.safeParse(doc);
    expect(parsed.success).toBe(true);

    const nodeTypes = doc.content.map((n) => n.type);
    expect(nodeTypes).toContain("heading");
    expect(nodeTypes).toContain("paragraph");
    expect(nodeTypes).toContain("mathBlock");
    expect(nodeTypes).toContain("table");
    expect(nodeTypes).toContain("bulletList");
    expect(nodeTypes).toContain("codeBlock");

    // Reject oversized base64 images inside Tiptap JSONB
    const invalidBase64Doc = {
      type: "doc",
      content: [
        {
          type: "imageBlock",
          attrs: {
            src: `data:image/png;base64,${"A".repeat(5000)}`
          }
        }
      ]
    };
    expect(TiptapDocSchema.safeParse(invalidBase64Doc).success).toBe(false);
  });

  it("6. Duplicate detection: distinguishes questions with similar stems but different options", () => {
    const stem = textToTiptapDoc("What is the value of $x$ in the equation?");
    const opts1 = [
      { id: "A", content: textToTiptapDoc("10") },
      { id: "B", content: textToTiptapDoc("20") }
    ];
    const opts2 = [
      { id: "A", content: textToTiptapDoc("30") },
      { id: "B", content: textToTiptapDoc("40") }
    ];

    const hash1 = computeQuestionContentHash(stem, opts1, "MCQ");
    const hash2 = computeQuestionContentHash(stem, opts2, "MCQ");
    const hash1Duplicate = computeQuestionContentHash(stem, opts1, "MCQ");

    expect(hash1).not.toBe(hash2);
    expect(hash1).toBe(hash1Duplicate);
  });

  it("7. Regression: Segments questions with and without whitespace after punctuation and preserves stems", () => {
    const ocrText = [
      "3. Which part of a neuron receives information?",
      "A) Dendrite",
      "B) Axon",
      "Ans: A",
      "",
      "3.Which part of a neuron receives information?",
      "A) Dendrite",
      "B) Axon",
      "Ans: A",
      "",
      "Q3. Which part of a neuron receives information?",
      "A) Dendrite",
      "B) Axon",
      "Ans: A",
      "",
      "Q3.Which part of a neuron receives information?",
      "A) Dendrite",
      "B) Axon",
      "Ans: A",
      "",
      "10.The main advantage of a nervous system is rapid communication.",
      "The signal propagation velocity exceeds 3.14159 m/s.",
      "A) True",
      "B) False",
      "Ans: B"
    ].join("\n");

    const results = segmentAndParseQuestions([{ pageNumber: 1, text: ocrText }]);

    // 1. All 5 questions must be detected
    expect(results.length).toBe(5);

    // 2. Verify source question numbers for all spacing variants
    expect(results.map((r) => r.payload.sourceQuestionNumber)).toEqual([
      "3",
      "3",
      "Q3",
      "Q3",
      "10"
    ]);

    // 3. Verify original question stems are fully preserved without character clipping
    const stems = results.map((r) => tiptapDocToPlainText(r.payload.question));
    expect(stems[0]).toBe("Which part of a neuron receives information?");
    expect(stems[1]).toBe("Which part of a neuron receives information?");
    expect(stems[2]).toBe("Which part of a neuron receives information?");
    expect(stems[3]).toBe("Which part of a neuron receives information?");
    expect(stems[4]).toContain("The main advantage of a nervous system is rapid communication.");
    expect(stems[4]).toContain("3.14159 m/s.");

    // 4. Verify option labels (A, B) and answer markers (Ans:B) are NOT question starts
    for (const r of results) {
      expect(["A", "B", "Ans", "3.14159"]).not.toContain(r.payload.sourceQuestionNumber);
      expect(r.payload.options.length).toBe(2);
    }

    // 5. Verify answers are properly matched
    expect(results[0].payload.answer.value).toEqual(["A"]);
    expect(results[1].payload.answer.value).toEqual(["A"]);
    expect(results[2].payload.answer.value).toEqual(["A"]);
    expect(results[3].payload.answer.value).toEqual(["A"]);
    expect(results[4].payload.answer.value).toEqual(["B"]);
  });

  it("8. Recognizes various answer formats (Answer: B, Ans. B, Correct Answer: (C)) and matches option letters or text", () => {
    const rawText = [
      "Section A - MCQ",
      "Q1. Which city is known as the Silicon Valley of India?",
      "A) Hyderabad",
      "B) Chennai",
      "C) Mumbai",
      "Answer: B",
      "",
      "Q2. Which city is the capital of Tamil Nadu?",
      "A) Hyderabad",
      "B) Chennai",
      "C) Mumbai",
      "Ans. B",
      "",
      "Q3. Which city is the financial capital of India?",
      "A) Hyderabad",
      "B) Chennai",
      "C) Mumbai",
      "Correct Answer: (C)",
      "",
      "Q4. Which city hosts the Marina Beach?",
      "A) Hyderabad",
      "B) Chennai",
      "C) Mumbai",
      "Answer: Chennai",
      "",
      "Q5. Which port city is on the western coast?",
      "A) Hyderabad",
      "B) Chennai",
      "C) Mumbai",
      "Ans. (C) Mumbai",
      "",
      "Q6. Which city has Charminar?",
      "A) Hyderabad",
      "B) Chennai",
      "C) Mumbai",
      "Ans. B) Chennai"
    ].join("\n");

    const results = segmentAndParseQuestions([{ pageNumber: 1, text: rawText }]);
    expect(results.length).toBe(6);

    // Q1: Answer: B -> selects B (Chennai)
    expect(results[0].payload.answer.value).toEqual(["B"]);
    expect(results[0].payload.answerProvenance).toBe("EXPLICIT_SOURCE");
    expect(results[0].payload.answer.status).toBe("extracted");

    // Q2: Ans. B -> selects B (Chennai)
    expect(results[1].payload.answer.value).toEqual(["B"]);
    expect(results[1].payload.answerProvenance).toBe("EXPLICIT_SOURCE");

    // Q3: Correct Answer: (C) -> selects C (Mumbai)
    expect(results[2].payload.answer.value).toEqual(["C"]);
    expect(results[2].payload.answerProvenance).toBe("EXPLICIT_SOURCE");

    // Q4: Answer: Chennai -> text matches Option B -> selects B
    expect(results[3].payload.answer.value).toEqual(["B"]);

    // Q5: Ans. (C) Mumbai -> combined matches Option C -> selects C
    expect(results[4].payload.answer.value).toEqual(["C"]);

    // Q6: Ans. B) Chennai -> combined matches Option B -> selects B
    expect(results[5].payload.answer.value).toEqual(["B"]);
  });

  it("9. Leaves answer.value empty when unrecognized, invalid, or ambiguous, preserving question for manual review without guessing", () => {
    const rawText = [
      "Section A - MCQ",
      "Q1. Which city is the capital of Telangana?",
      "A) Hyderabad",
      "B) Chennai",
      "C) Mumbai",
      "Answer: Kolkata",
      "",
      "Q2. Which city is known for pearls?",
      "A) Hyderabad",
      "B) Chennai",
      "C) Mumbai",
      "Answer: Z",
      "",
      "Q3. Select the correct option:",
      "A) None of the above",
      "B) None of the above",
      "Answer: None of the above"
    ].join("\n");

    const results = segmentAndParseQuestions([{ pageNumber: 1, text: rawText }]);
    expect(results.length).toBe(3);

    // Q1: Kolkata does not match A, B, or C -> leave unselected
    expect(results[0].payload.answer.value).toEqual([]);
    expect(results[0].payload.answer.status).toBe("missing");
    expect(results[0].payload.answerProvenance).toBe("EXPLICIT_SOURCE");
    expect(results[0].payload.reviewStatus).toBe("NEEDS_ATTENTION");
    expect(results[0].payload.warnings.some((w) => w.includes("rejected"))).toBe(true);

    // Q2: Option ID 'Z' is invalid -> leave unselected
    expect(results[1].payload.answer.value).toEqual([]);
    expect(results[1].payload.answer.status).toBe("missing");
    expect(results[1].payload.reviewStatus).toBe("NEEDS_ATTENTION");
    expect(results[1].payload.warnings.some((w) => w.includes("rejected"))).toBe(true);

    // Q3: Ambiguous match between options with duplicate text -> leave unselected
    expect(results[2].payload.answer.value).toEqual([]);
    expect(results[2].payload.answer.status).toBe("uncertain");
    expect(results[2].payload.reviewStatus).toBe("NEEDS_ATTENTION");
    expect(results[2].payload.warnings.some((w) => w.includes("Ambiguous"))).toBe(true);
  });

  it("10. Supports MSQ and True/False answer matching without guessing", () => {
    const rawText = [
      "Section A - Multiple Select",
      "Q1. Which of the following are coastal cities? Select all that apply.",
      "A) Hyderabad",
      "B) Chennai",
      "C) Mumbai",
      "D) Delhi",
      "Answer: Chennai, Mumbai",
      "",
      "Q2. Which of the following are metropolitan areas? Select all that apply.",
      "A) Hyderabad",
      "B) Chennai",
      "C) Mumbai",
      "D) Delhi",
      "Answer: (A) and (C)",
      "",
      "Q3. Partial invalid in MSQ must not guess:",
      "A) Hyderabad",
      "B) Chennai",
      "C) Mumbai",
      "Answer: A, Z",
      "",
      "Q4. Light travels faster in vacuum than in diamond. (True/False)",
      "A) True",
      "B) False",
      "Ans. True"
    ].join("\n");

    const results = segmentAndParseQuestions([{ pageNumber: 1, text: rawText }]);
    expect(results.length).toBe(4);

    // Q1: MSQ matched by text "Chennai, Mumbai" -> B and C
    expect(results[0].payload.type).toBe("MSQ");
    expect(results[0].payload.answer.value).toEqual(["B", "C"]);

    // Q2: MSQ matched by tokens "(A) and (C)" -> A and C
    expect(results[1].payload.type).toBe("MSQ");
    expect(results[1].payload.answer.value).toEqual(["A", "C"]);

    // Q3: One invalid option 'Z' -> reject entire answer, leave unselected
    expect(results[2].payload.answer.value).toEqual([]);
    expect(results[2].payload.reviewStatus).toBe("NEEDS_ATTENTION");

    // Q4: True/False with A) True, B) False -> matches Option A
    expect(results[3].payload.type).toBe("TRUE_FALSE");
    expect(results[3].payload.answer.value).toEqual(["A"]);
  });

  it("11. ValidatedQuestionPayloadSchema rejects invalid option IDs in answer.value", () => {
    const validDoc = textToTiptapDoc("Sample question?");
    const options = [
      { id: "A", content: textToTiptapDoc("Option 1") },
      { id: "B", content: textToTiptapDoc("Option 2") }
    ];

    const invalidPayload = {
      question: validDoc,
      options,
      answer: {
        type: "mcq",
        value: ["Z"], // Invalid option ID not in [A, B]
        status: "extracted"
      },
      explanation: null,
      type: "MCQ",
      sourcePage: 1,
      sourceQuestionNumber: "1",
      sourceOrder: 1,
      confidence: 0.9,
      answerProvenance: "EXPLICIT_SOURCE",
      reviewStatus: "PENDING_REVIEW",
      warnings: [],
      aiRepaired: false
    };

    const parseResult = ValidatedQuestionPayloadSchema.safeParse(invalidPayload);
    expect(parseResult.success).toBe(false);
    if (!parseResult.success) {
      expect(parseResult.error.issues[0].message).toContain("Invalid option ID \"Z\"");
    }
  });

  it("12. Parses single-space inline options, multiline options, and mixed formats", () => {
    // 1. Four inline options separated by single spaces
    const inlineText = [
      "Q1. Which gas is most abundant in Earth's atmosphere?",
      "A) Oxygen B) Carbon Dioxide C) Argon D) Nitrogen",
      "Answer: D"
    ].join("\n");
    const inlineRes = segmentAndParseQuestions([{ pageNumber: 1, text: inlineText }]);
    expect(inlineRes.length).toBe(1);
    const q1 = inlineRes[0].payload;
    expect(q1.options.length).toBe(4);
    expect(q1.options.map((o) => o.id)).toEqual(["A", "B", "C", "D"]);
    expect(q1.options.map((o) => tiptapDocToPlainText(o.content))).toEqual([
      "Oxygen",
      "Carbon Dioxide",
      "Argon",
      "Nitrogen"
    ]);
    expect(q1.answer.value).toEqual(["D"]);

    // 2. Four multiline options
    const multilineText = [
      "Q2. Which gas is most abundant in Earth's atmosphere?",
      "A) Oxygen",
      "B) Carbon Dioxide",
      "C) Argon",
      "D) Nitrogen",
      "Answer: D"
    ].join("\n");
    const multiRes = segmentAndParseQuestions([{ pageNumber: 1, text: multilineText }]);
    expect(multiRes.length).toBe(1);
    const q2 = multiRes[0].payload;
    expect(q2.options.length).toBe(4);
    expect(q2.options.map((o) => o.id)).toEqual(["A", "B", "C", "D"]);
    expect(q2.options.map((o) => tiptapDocToPlainText(o.content))).toEqual([
      "Oxygen",
      "Carbon Dioxide",
      "Argon",
      "Nitrogen"
    ]);

    // 3. Mixed inline and multiline options (2 options per line)
    const mixedText = [
      "Q3. Identify the major atmospheric gases:",
      "A) Oxygen B) Carbon Dioxide",
      "C) Argon D) Nitrogen",
      "Answer: D"
    ].join("\n");
    const mixedRes = segmentAndParseQuestions([{ pageNumber: 1, text: mixedText }]);
    expect(mixedRes.length).toBe(1);
    const q3 = mixedRes[0].payload;
    expect(q3.options.length).toBe(4);
    expect(q3.options.map((o) => o.id)).toEqual(["A", "B", "C", "D"]);
    expect(q3.options.map((o) => tiptapDocToPlainText(o.content))).toEqual([
      "Oxygen",
      "Carbon Dioxide",
      "Argon",
      "Nitrogen"
    ]);
  });

  it("13. Supports all option delimiters for inline options: A), A., (A), [A], A:", () => {
    const delimiters = [
      { name: "Parenthesis postfix 'A)'", text: "A) Oxygen B) Carbon Dioxide C) Argon D) Nitrogen" },
      { name: "Dot postfix 'A.'", text: "A. Oxygen B. Carbon Dioxide C. Argon D. Nitrogen" },
      { name: "Enclosed parens '(A)'", text: "(A) Oxygen (B) Carbon Dioxide (C) Argon (D) Nitrogen" },
      { name: "Enclosed brackets '[A]'", text: "[A] Oxygen [B] Carbon Dioxide [C] Argon [D] Nitrogen" },
      { name: "Colon postfix 'A:'", text: "A: Oxygen B: Carbon Dioxide C: Argon D: Nitrogen" }
    ];

    for (const { name, text } of delimiters) {
      const raw = [`Q1. Delimiter test for ${name}:`, text, "Answer: D"].join("\n");
      const res = segmentAndParseQuestions([{ pageNumber: 1, text: raw }]);
      expect(res.length).toBe(1);
      const q = res[0].payload;
      expect(q.options.length).toBe(4);
      expect(q.options.map((o) => o.id)).toEqual(["A", "B", "C", "D"]);
      expect(q.options.map((o) => tiptapDocToPlainText(o.content))).toEqual([
        "Oxygen",
        "Carbon Dioxide",
        "Argon",
        "Nitrogen"
      ]);
    }
  });

  it("14. Prevents false option detection when option text naturally contains letter references", () => {
    // Option text containing "Vitamin A.", "Point B.", "Figure A." must not be split into false options
    const rawText = [
      "Q1. Which nutritional deficiency causes night blindness?",
      "A) Deficiency of Vitamin A. in the human body B) Deficiency of Vitamin B. complex C) Point C. on the nutrition curve D) None of the above",
      "Answer: A"
    ].join("\n");

    const results = segmentAndParseQuestions([{ pageNumber: 1, text: rawText }]);
    expect(results.length).toBe(1);
    const q = results[0].payload;
    expect(q.options.length).toBe(4);
    expect(q.options.map((o) => o.id)).toEqual(["A", "B", "C", "D"]);
    expect(q.options.map((o) => tiptapDocToPlainText(o.content))).toEqual([
      "Deficiency of Vitamin A. in the human body",
      "Deficiency of Vitamin B. complex",
      "Point C. on the nutrition curve",
      "None of the above"
    ]);
    expect(q.answer.value).toEqual(["A"]);
  });

  it("15. Rejects out-of-order or duplicate inline labels and preserves question boundaries", () => {
    // Duplicate label e.g. A) ... A) ... should not form valid inline option chain
    const rawText = [
      "Q1. Duplicate inline label line:",
      "A) First part A) Second part with same label",
      "B) Regular second option",
      "Answer: B"
    ].join("\n");

    const results = segmentAndParseQuestions([{ pageNumber: 1, text: rawText }]);
    expect(results.length).toBe(1);
    const q = results[0].payload;
    expect(q.options.length).toBe(2);
    expect(q.options[0].id).toBe("A");
    expect(tiptapDocToPlainText(q.options[0].content)).toBe(
      "First part A) Second part with same label"
    );
    expect(q.options[1].id).toBe("B");
    expect(tiptapDocToPlainText(q.options[1].content)).toBe("Regular second option");
  });
});

