import { z } from "zod";

export const TiptapMarkTypeSchema = z.enum([
  "bold",
  "italic",
  "underline",
  "subscript",
  "superscript",
  "code"
]);

export const TiptapMarkSchema = z.object({
  type: TiptapMarkTypeSchema,
  attrs: z.record(z.unknown()).optional()
});

export type TiptapMark = z.infer<typeof TiptapMarkSchema>;

export const TiptapNodeTypeSchema = z.enum([
  "doc",
  "paragraph",
  "heading",
  "text",
  "bulletList",
  "orderedList",
  "listItem",
  "table",
  "tableRow",
  "tableHeader",
  "tableCell",
  "mathInline",
  "mathBlock",
  "imageInline",
  "imageBlock",
  "image",
  "codeBlock",
  "hardBreak"
]);

export type TiptapNodeType = z.infer<typeof TiptapNodeTypeSchema>;

export interface TiptapNode {
  type: TiptapNodeType;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  marks?: TiptapMark[];
  text?: string;
}

export const TiptapNodeSchema: z.ZodType<TiptapNode> = z.lazy(() =>
  z
    .object({
      type: TiptapNodeTypeSchema,
      attrs: z.record(z.unknown()).optional(),
      content: z.array(TiptapNodeSchema).optional(),
      marks: z.array(TiptapMarkSchema).optional(),
      text: z.string().optional()
    })
    .superRefine((node, ctx) => {
      if (node.type === "text" && typeof node.text !== "string") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Text node must include a string 'text' property."
        });
      }
      if (
        (node.type === "imageInline" ||
          node.type === "imageBlock" ||
          node.type === "image") &&
        node.attrs
      ) {
        const src = String(node.attrs.src || "");
        if (src.startsWith("data:image/") && src.length > 4096) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "Large base64 images must not be stored directly inside Tiptap JSONB. Use asset storage references."
          });
        }
      }
    })
);

export const TiptapDocSchema = z
  .object({
    type: z.literal("doc"),
    content: z.array(TiptapNodeSchema).min(1, "Tiptap doc must contain at least one block node")
  })
  .strict();

export type TiptapDoc = z.infer<typeof TiptapDocSchema>;

export const QuestionOptionSchema = z
  .object({
    id: z.string().min(1).max(16),
    content: TiptapDocSchema
  })
  .strict();

export type QuestionOption = z.infer<typeof QuestionOptionSchema>;

export const QuestionOptionsArraySchema = z.array(QuestionOptionSchema);

export const AnswerTypeSchema = z.enum(["mcq", "msq", "true_false", "unknown"]);
export const AnswerStatusSchema = z.enum([
  "extracted",
  "answer_key",
  "ai_inferred",
  "missing",
  "uncertain",
  "verified"
]);

export const QuestionAnswerSchema = z
  .object({
    type: AnswerTypeSchema,
    value: z.array(z.string()),
    status: AnswerStatusSchema
  })
  .strict();

export type QuestionAnswer = z.infer<typeof QuestionAnswerSchema>;

export const QuestionTypeEnumSchema = z.enum(["MCQ", "MSQ", "TRUE_FALSE", "UNKNOWN"]);
export type QuestionTypeEnum = z.infer<typeof QuestionTypeEnumSchema>;

export const PrismaAnswerStatusSchema = z.enum([
  "EXTRACTED",
  "ANSWER_KEY",
  "AI_INFERRED",
  "MISSING",
  "UNCERTAIN",
  "VERIFIED"
]);
export type PrismaAnswerStatus = z.infer<typeof PrismaAnswerStatusSchema>;

export function toDomainAnswerType(type: QuestionTypeEnum | string): z.infer<typeof AnswerTypeSchema> {
  switch (type.toUpperCase()) {
    case "MCQ":
      return "mcq";
    case "MSQ":
      return "msq";
    case "TRUE_FALSE":
      return "true_false";
    case "UNKNOWN":
      return "unknown";
    default:
      return "unknown";
  }
}

export function toPrismaQuestionType(type: string): QuestionTypeEnum {
  switch (type.toUpperCase()) {
    case "MCQ":
      return "MCQ";
    case "MSQ":
      return "MSQ";
    case "TRUE_FALSE":
      return "TRUE_FALSE";
    case "UNKNOWN":
      return "UNKNOWN";
    default:
      return "UNKNOWN";
  }
}

export function toDomainAnswerStatus(
  status: PrismaAnswerStatus | string
): z.infer<typeof AnswerStatusSchema> {
  switch (status.toUpperCase()) {
    case "EXTRACTED":
      return "extracted";
    case "ANSWER_KEY":
      return "answer_key";
    case "AI_INFERRED":
      return "ai_inferred";
    case "MISSING":
      return "missing";
    case "UNCERTAIN":
      return "uncertain";
    case "VERIFIED":
      return "verified";
    default:
      return "missing";
  }
}

export function toPrismaAnswerStatus(
  status: z.infer<typeof AnswerStatusSchema> | string
): PrismaAnswerStatus {
  switch (status.toLowerCase()) {
    case "extracted":
      return "EXTRACTED";
    case "answer_key":
      return "ANSWER_KEY";
    case "ai_inferred":
      return "AI_INFERRED";
    case "missing":
      return "MISSING";
    case "uncertain":
      return "UNCERTAIN";
    case "verified":
      return "VERIFIED";
    default:
      return "MISSING";
  }
}

export const AnswerProvenanceEnumSchema = z.enum([
  "EXPLICIT_SOURCE",
  "ANSWER_KEY",
  "AI_INFERRED",
  "MISSING"
]);
export type AnswerProvenanceEnum = z.infer<typeof AnswerProvenanceEnumSchema>;

export const QuestionReviewStatusEnumSchema = z.enum([
  "PENDING_REVIEW",
  "NEEDS_ATTENTION",
  "APPROVED",
  "REJECTED"
]);
export type QuestionReviewStatusEnum = z.infer<typeof QuestionReviewStatusEnumSchema>;

export const BoundingBoxSchema = z.object({
  page: z.number().int().min(1),
  x: z.number().min(0),
  y: z.number().min(0),
  width: z.number().min(0),
  height: z.number().min(0)
});

export type BoundingBox = z.infer<typeof BoundingBoxSchema>;

export const ValidatedQuestionPayloadSchema = z
  .object({
    question: TiptapDocSchema,
    options: QuestionOptionsArraySchema,
    answer: QuestionAnswerSchema,
    explanation: TiptapDocSchema.nullable(),
    type: QuestionTypeEnumSchema,
    sourcePage: z.number().int().min(1),
    sourcePageEnd: z.number().int().min(1).optional(),
    sourceQuestionNumber: z.string().min(1),
    sourceSection: z.string().nullable().optional(),
    sourceOrder: z.number().int().min(1),
    confidence: z.number().min(0).max(1),
    answerProvenance: AnswerProvenanceEnumSchema,
    reviewStatus: QuestionReviewStatusEnumSchema,
    sharedPassage: TiptapDocSchema.nullable().optional(),
    boundingBox: BoundingBoxSchema.nullable().optional(),
    warnings: z.array(z.string()).default([]),
    aiRepaired: z.boolean().default(false),
    aiRepairModel: z.string().nullable().optional(),
    aiRepairReason: z.string().nullable().optional()
  })
  .superRefine((data, ctx) => {
    if (data.options.length > 0 && data.answer.value.length > 0) {
      const validIds = new Set(data.options.map((o) => o.id));
      for (const val of data.answer.value) {
        if (!validIds.has(val)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["answer", "value"],
            message: `Invalid option ID "${val}" in answer; must be one of [${Array.from(validIds).join(", ")}].`
          });
        }
      }
    }
  });

export type ValidatedQuestionPayload = z.infer<typeof ValidatedQuestionPayloadSchema>;

export const QuestionUpdateRequestSchema = z
  .object({
    question: TiptapDocSchema.optional(),
    options: QuestionOptionsArraySchema.optional(),
    answer: QuestionAnswerSchema.optional(),
    explanation: TiptapDocSchema.nullable().optional(),
    type: QuestionTypeEnumSchema.optional(),
    reviewStatus: QuestionReviewStatusEnumSchema.optional(),
    sourceQuestionNumber: z.string().min(1).optional(),
    sourceSection: z.string().nullable().optional(),
    notes: z.string().max(1000).optional()
  })
  .superRefine((data, ctx) => {
    if (data.options && data.options.length > 0 && data.answer && data.answer.value.length > 0) {
      const validIds = new Set(data.options.map((o) => o.id));
      for (const val of data.answer.value) {
        if (!validIds.has(val)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["answer", "value"],
            message: `Invalid option ID "${val}" in answer; must be one of [${Array.from(validIds).join(", ")}].`
          });
        }
      }
    }
  });

export const UserDeclaredFormatEnumSchema = z.enum([
  "AUTO_DETECT",
  "DIGITAL_PDF",
  "SCANNED_PRINTED_PDF",
  "SCANNED_HANDWRITTEN_PDF",
  "DOCX",
  "XLSX",
  "IMAGE"
]);
export type UserDeclaredFormat = z.infer<typeof UserDeclaredFormatEnumSchema>;

export const ImportParametersSchema = z.object({
  userDeclaredFormat: UserDeclaredFormatEnumSchema.default("AUTO_DETECT"),
  rejectDuplicate: z.boolean().default(false),
  aiBudgetUsd: z.number().min(0).max(10).default(0.5)
});
export type ImportParameters = z.infer<typeof ImportParametersSchema>;

