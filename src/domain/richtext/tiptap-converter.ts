import crypto from "crypto";
import {
  TiptapDoc,
  TiptapDocSchema,
  TiptapMark,
  TiptapNode,
  QuestionOption,
  QuestionTypeEnum
} from "@/domain/schemas/question.schema";

/**
 * Parses inline text containing math expressions ($...$, \(...\)), image tokens ([IMAGE:id:alt]),
 * and inline formatting (**bold**, *italic*, __underline__, ^sup^, ~sub~, `code`) into Tiptap inline nodes.
 */
export function parseInlineContent(text: string): TiptapNode[] {
  if (!text) return [];

  const nodes: TiptapNode[] = [];
  // Combined tokenizer for inline math, inline asset images, and inline formatting marks
  const tokenRegex =
    /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\$[^$\n]+\$|\\\([\s\S]+?\\\)|\[IMAGE:([a-zA-Z0-9_-]+)(?::([^\]]*))?\]|`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|(?<!\*)\*[^*\n]+\*(?!\*)|\^[0-9a-zA-Z+\-=()]+\^|~[0-9a-zA-Z+\-=()]+~)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const plain = text.slice(lastIndex, match.index);
      if (plain) {
        nodes.push({ type: "text", text: plain });
      }
    }

    const token = match[0];

    if (token.startsWith("$$") && token.endsWith("$$")) {
      const latex = token.slice(2, -2).trim();
      nodes.push({
        type: "mathInline",
        attrs: { latex, display: "block" }
      });
    } else if (token.startsWith("\\[") && token.endsWith("\\]")) {
      const latex = token.slice(2, -2).trim();
      nodes.push({
        type: "mathInline",
        attrs: { latex, display: "block" }
      });
    } else if (token.startsWith("$") && token.endsWith("$")) {
      const latex = token.slice(1, -1).trim();
      nodes.push({
        type: "mathInline",
        attrs: { latex, display: "inline" }
      });
    } else if (token.startsWith("\\(") && token.endsWith("\\)")) {
      const latex = token.slice(2, -2).trim();
      nodes.push({
        type: "mathInline",
        attrs: { latex, display: "inline" }
      });
    } else if (token.startsWith("[IMAGE:")) {
      const assetId = match[2];
      const alt = match[3] || "Question diagram";
      nodes.push({
        type: "imageInline",
        attrs: {
          assetId,
          src: `/api/assets/${assetId}`,
          alt
        }
      });
    } else if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push({
        type: "text",
        text: token.slice(1, -1),
        marks: [{ type: "code" }]
      });
    } else if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push({
        type: "text",
        text: token.slice(2, -2),
        marks: [{ type: "bold" }]
      });
    } else if (token.startsWith("__") && token.endsWith("__")) {
      nodes.push({
        type: "text",
        text: token.slice(2, -2),
        marks: [{ type: "underline" }]
      });
    } else if (token.startsWith("*") && token.endsWith("*")) {
      nodes.push({
        type: "text",
        text: token.slice(1, -1),
        marks: [{ type: "italic" }]
      });
    } else if (token.startsWith("^") && token.endsWith("^")) {
      nodes.push({
        type: "text",
        text: token.slice(1, -1),
        marks: [{ type: "superscript" }]
      });
    } else if (token.startsWith("~") && token.endsWith("~")) {
      nodes.push({
        type: "text",
        text: token.slice(1, -1),
        marks: [{ type: "subscript" }]
      });
    } else {
      nodes.push({ type: "text", text: token });
    }

    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex);
    if (remaining) {
      nodes.push({ type: "text", text: remaining });
    }
  }

  return nodes;
}

export function createParagraphNode(text: string, marks?: TiptapMark[]): TiptapNode {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      type: "paragraph",
      content: [{ type: "text", text: " " }]
    };
  }
  if (marks && marks.length > 0) {
    return {
      type: "paragraph",
      content: [{ type: "text", text: trimmed, marks }]
    };
  }
  const inlineNodes = parseInlineContent(trimmed);
  return {
    type: "paragraph",
    content: inlineNodes.length > 0 ? inlineNodes : [{ type: "text", text: trimmed }]
  };
}

export function tableMatrixToTiptapNode(
  rows: string[][],
  hasHeader = true
): TiptapNode {
  if (!rows || rows.length === 0) {
    return createParagraphNode("");
  }

  const maxCols = Math.max(...rows.map((r) => r.length), 1);
  const tableRows: TiptapNode[] = rows.map((row, rowIdx) => {
    const isHeaderRow = hasHeader && rowIdx === 0;
    const cells: TiptapNode[] = [];
    for (let colIdx = 0; colIdx < maxCols; colIdx++) {
      const cellText = row[colIdx] ?? "";
      cells.push({
        type: isHeaderRow ? "tableHeader" : "tableCell",
        attrs: { colspan: 1, rowspan: 1 },
        content: [createParagraphNode(cellText)]
      });
    }
    return {
      type: "tableRow",
      content: cells
    };
  });

  return {
    type: "table",
    content: tableRows
  };
}

export function createImageBlockNode(assetId: string, alt = "Diagram"): TiptapNode {
  return {
    type: "imageBlock",
    attrs: {
      assetId,
      src: `/api/assets/${assetId}`,
      alt
    }
  };
}

export function createMathBlockNode(latex: string): TiptapNode {
  return {
    type: "mathBlock",
    attrs: {
      latex: latex.trim(),
      display: "block"
    }
  };
}

/**
 * Converts rich structured text (including paragraphs, markdown tables, code blocks,
 * block math $$...$$, bullet lists, ordered lists, and asset image tags) into a valid TiptapDoc.
 */
export function textToTiptapDoc(rawText: string): TiptapDoc {
  const normalized = (rawText || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: " " }]
        }
      ]
    };
  }

  const lines = normalized.split("\n");
  const blocks: TiptapNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // 1. Code block ```
    if (trimmed.startsWith("```")) {
      const language = trimmed.slice(3).trim() || "plaintext";
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip closing ```
      blocks.push({
        type: "codeBlock",
        attrs: { language },
        content: [{ type: "text", text: codeLines.join("\n") || " " }]
      });
      continue;
    }

    // 2. Standalone block math $$ ... $$
    if (trimmed.startsWith("$$")) {
      if (trimmed.endsWith("$$") && trimmed.length > 4) {
        blocks.push(createMathBlockNode(trimmed.slice(2, -2)));
        i++;
        continue;
      }
      const mathLines: string[] = [trimmed.slice(2)];
      i++;
      while (i < lines.length && !lines[i].trim().endsWith("$$")) {
        mathLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) {
        mathLines.push(lines[i].trim().slice(0, -2));
        i++;
      }
      blocks.push(createMathBlockNode(mathLines.join("\n")));
      continue;
    }

    // 3. Standalone block image [IMAGE_BLOCK:assetId:alt]
    const imgBlockMatch = trimmed.match(/^\[IMAGE_BLOCK:([a-zA-Z0-9_-]+)(?::([^\]]*))?\]$/);
    if (imgBlockMatch) {
      blocks.push(createImageBlockNode(imgBlockMatch[1], imgBlockMatch[2] || "Question figure"));
      i++;
      continue;
    }

    // 4. Pipe table | col1 | col2 |
    if (trimmed.startsWith("|") && trimmed.endsWith("|") && trimmed.split("|").length >= 3) {
      const tableRows: string[][] = [];
      while (
        i < lines.length &&
        lines[i].trim().startsWith("|") &&
        lines[i].trim().endsWith("|")
      ) {
        const rowLine = lines[i].trim();
        // Skip markdown separator row |---|---|
        if (/^\|[\s\-:|]+\|$/.test(rowLine)) {
          i++;
          continue;
        }
        const cells = rowLine
          .slice(1, -1)
          .split("|")
          .map((c) => c.trim());
        tableRows.push(cells);
        i++;
      }
      if (tableRows.length > 0) {
        blocks.push(tableMatrixToTiptapNode(tableRows, true));
      }
      continue;
    }

    // 5. Heading (#, ##, ###)
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        attrs: { level: headingMatch[1].length },
        content: parseInlineContent(headingMatch[2])
      });
      i++;
      continue;
    }

    // 6. Bullet list (- item or • item)
    if (/^[-•*]\s+/.test(trimmed)) {
      const listItems: TiptapNode[] = [];
      while (i < lines.length && /^[-•*]\s+/.test(lines[i].trim())) {
        const itemText = lines[i].trim().replace(/^[-•*]\s+/, "");
        listItems.push({
          type: "listItem",
          content: [createParagraphNode(itemText)]
        });
        i++;
      }
      blocks.push({
        type: "bulletList",
        content: listItems
      });
      continue;
    }

    // 7. Ordered list (i., ii., iii. or 1., 2. inside question body)
    if (/^(?:[ivxIVX]+)\.\s+/.test(trimmed)) {
      const listItems: TiptapNode[] = [];
      while (i < lines.length && /^(?:[ivxIVX]+)\.\s+/.test(lines[i].trim())) {
        const itemText = lines[i].trim().replace(/^(?:[ivxIVX]+)\.\s+/, "");
        listItems.push({
          type: "listItem",
          content: [createParagraphNode(itemText)]
        });
        i++;
      }
      blocks.push({
        type: "orderedList",
        content: listItems
      });
      continue;
    }

    // 8. Standard paragraph
    blocks.push(createParagraphNode(trimmed));
    i++;
  }

  if (blocks.length === 0) {
    blocks.push(createParagraphNode(normalized));
  }

  const doc: TiptapDoc = {
    type: "doc",
    content: blocks
  };

  return TiptapDocSchema.parse(doc);
}

/**
 * Converts HTML generated by Mammoth (for DOCX extraction) into TiptapDoc
 * without storing raw HTML. Preserves tables, bold, italic, underline, sup, sub, lists, and asset images.
 */
export function htmlToTiptapDoc(html: string): TiptapDoc {
  if (!html || !html.trim()) {
    return textToTiptapDoc("");
  }

  // Convert HTML structures into intermediate markdown/DSL markers that textToTiptapDoc parses cleanly
  let working = html
    .replace(/\r\n/g, "\n")
    // Convert tables
    .replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, tableInner: string) => {
      const rows: string[] = [];
      const rowMatches = tableInner.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
      for (const rowHtml of rowMatches) {
        const cellMatches = rowHtml.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/gi) || [];
        const cells = cellMatches.map((cellHtml) =>
          stripHtmlInlineToDSL(cellHtml.replace(/^<t[hd][^>]*>|<\/t[hd]>$/gi, "")).replace(
            /\|/g,
            "\\|"
          )
        );
        if (cells.length > 0) {
          rows.push(`| ${cells.join(" | ")} |`);
        }
      }
      return `\n${rows.join("\n")}\n`;
    })
    // Convert headings
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, inner) => `\n# ${stripHtmlInlineToDSL(inner)}\n`)
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, inner) => `\n## ${stripHtmlInlineToDSL(inner)}\n`)
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, inner) => `\n### ${stripHtmlInlineToDSL(inner)}\n`)
    // Convert code blocks
    .replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_, inner) => {
      return `\n\`\`\`\n${decodeHtmlEntities(inner.replace(/<[^>]+>/g, ""))}\n\`\`\`\n`;
    })
    // Convert list items
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, inner) => `\n- ${stripHtmlInlineToDSL(inner)}\n`)
    // Convert paragraphs and line breaks
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n");

  working = stripHtmlInlineToDSL(working);
  return textToTiptapDoc(working);
}

function stripHtmlInlineToDSL(fragment: string): string {
  const processed = fragment
    .replace(
      /<img[^>]*data-asset-id=["']([a-zA-Z0-9_-]+)["'][^>]*alt=["']([^"']*)["'][^>]*\/?>/gi,
      "[IMAGE:$1:$2]"
    )
    .replace(/<img[^>]*data-asset-id=["']([a-zA-Z0-9_-]+)["'][^>]*\/?>/gi, "[IMAGE:$1:Diagram]")
    .replace(/<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, "**$1**")
    .replace(/<(?:em|i)[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, "*$1*")
    .replace(/<u[^>]*>([\s\S]*?)<\/u>/gi, "__$1__")
    .replace(/<sup[^>]*>([\s\S]*?)<\/sup>/gi, "^$1^")
    .replace(/<sub[^>]*>([\s\S]*?)<\/sub>/gi, "~$1~")
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
    .replace(/<[^>]+>/g, "");

  return decodeHtmlEntities(processed).trim();
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Extracts flattened human-readable text from a TiptapDoc for CSV export,
 * search, and content hash computation.
 */
export function tiptapDocToPlainText(doc: TiptapDoc | null | undefined): string {
  if (!doc || !Array.isArray(doc.content)) return "";

  const visit = (node: TiptapNode): string => {
    if (node.type === "text") {
      return node.text || "";
    }
    if (node.type === "mathInline") {
      return `$${String(node.attrs?.latex || "")}$`;
    }
    if (node.type === "mathBlock") {
      return `$$${String(node.attrs?.latex || "")}$$`;
    }
    if (
      node.type === "imageInline" ||
      node.type === "imageBlock" ||
      node.type === "image"
    ) {
      return `[Image:${String(node.attrs?.assetId || node.attrs?.alt || "diagram")}]`;
    }
    if (node.type === "tableRow" && node.content) {
      return `| ${node.content.map(visit).join(" | ")} |`;
    }
    if (!node.content || node.content.length === 0) {
      return "";
    }
    const separator =
      node.type === "doc" ||
      node.type === "table" ||
      node.type === "bulletList" ||
      node.type === "orderedList"
        ? "\n"
        : "";
    return node.content.map(visit).join(separator);
  };

  return visit(doc).replace(/\s+\n/g, "\n").trim();
}

/**
 * Computes a deterministic SHA-256 hash over question stem + ordered option contents + question type.
 * Prevents false-positive duplicates when two questions have similar stems but different options or equations.
 */
export function computeQuestionContentHash(
  questionDoc: TiptapDoc,
  options: QuestionOption[],
  type: QuestionTypeEnum
): string {
  const normalizeForHash = (str: string) =>
    str
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();

  const stemText = normalizeForHash(tiptapDocToPlainText(questionDoc));
  const optionsSignature = options
    .map((opt) => `${opt.id.trim().toUpperCase()}:${normalizeForHash(tiptapDocToPlainText(opt.content))}`)
    .join("||");

  const canonical = `TYPE:${type}|STEM:${stemText}|OPTS:${optionsSignature}`;
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}
