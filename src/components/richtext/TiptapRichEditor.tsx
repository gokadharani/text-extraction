"use client";

import React, { useEffect, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { Node, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  List,
  ListOrdered,
  Code,
  Sigma,
  Table as TableIcon,
  Subscript as SubIcon,
  Superscript as SupIcon,
  FileCode
} from "lucide-react";
import { TiptapDoc } from "@/domain/schemas/question.schema";
import {
  textToTiptapDoc,
  tiptapDocToPlainText
} from "@/domain/richtext/tiptap-converter";

/**
 * Custom Tiptap ProseMirror nodes for mathInline, mathBlock, imageInline, and imageBlock
 * so Tiptap natively preserves and edits our rich-text JSON schema.
 */
const MathInlineNode = Node.create({
  name: "mathInline",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return {
      latex: { default: "" },
      display: { default: "inline" }
    };
  },
  parseHTML() {
    return [{ tag: "span[data-math-inline]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-math-inline": "",
        class:
          "inline-block rounded bg-indigo-50 px-1.5 py-0.5 font-mono text-xs text-indigo-800 border border-indigo-200"
      }),
      `$${HTMLAttributes.latex || ""}$`
    ];
  }
});

const MathBlockNode = Node.create({
  name: "mathBlock",
  group: "block",
  atom: true,
  addAttributes() {
    return {
      latex: { default: "" },
      display: { default: "block" }
    };
  },
  parseHTML() {
    return [{ tag: "div[data-math-block]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-math-block": "",
        class:
          "my-1.5 rounded bg-indigo-50/70 px-3 py-1.5 font-mono text-xs text-indigo-900 border border-indigo-200"
      }),
      `$$${HTMLAttributes.latex || ""}$$`
    ];
  }
});

const ImageInlineNode = Node.create({
  name: "imageInline",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return {
      assetId: { default: "" },
      src: { default: "" },
      alt: { default: "Diagram" }
    };
  },
  parseHTML() {
    return [{ tag: "span[data-image-inline]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-image-inline": "",
        class: "inline-block rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800 border border-amber-200"
      }),
      `[Image: ${HTMLAttributes.alt || HTMLAttributes.assetId}]`
    ];
  }
});

const ImageBlockNode = Node.create({
  name: "imageBlock",
  group: "block",
  atom: true,
  addAttributes() {
    return {
      assetId: { default: "" },
      src: { default: "" },
      alt: { default: "Diagram" }
    };
  },
  parseHTML() {
    return [{ tag: "div[data-image-block]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-image-block": "",
        class: "my-1.5 rounded bg-amber-50 px-3 py-1.5 text-xs text-amber-800 border border-amber-200"
      }),
      `[Image Block: ${HTMLAttributes.alt || HTMLAttributes.assetId}]`
    ];
  }
});

interface TiptapRichEditorProps {
  value: TiptapDoc;
  onChange: (nextDoc: TiptapDoc) => void;
  label?: string;
  compact?: boolean;
}

export function TiptapRichEditor({
  value,
  onChange,
  label,
  compact = false
}: TiptapRichEditorProps) {
  const [sourceMode, setSourceMode] = useState(false);
  const [rawSource, setRawSource] = useState(() => tiptapDocToPlainText(value));

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Underline,
      Subscript,
      Superscript,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      MathInlineNode,
      MathBlockNode,
      ImageInlineNode,
      ImageBlockNode
    ],
    content: value as unknown as Record<string, unknown>,
    onUpdate: ({ editor: activeEditor }) => {
      const json = activeEditor.getJSON() as unknown as TiptapDoc;
      if (json && json.type === "doc" && Array.isArray(json.content)) {
        onChange(json);
        setRawSource(tiptapDocToPlainText(json));
      }
    }
  });

  // Sync external question change (e.g. when navigating Next/Previous question)
  useEffect(() => {
    if (!editor) return;
    const currentJsonStr = JSON.stringify(editor.getJSON());
    const incomingJsonStr = JSON.stringify(value);
    if (currentJsonStr !== incomingJsonStr) {
      editor.commands.setContent(value as unknown as Record<string, unknown>, false);
      setRawSource(tiptapDocToPlainText(value));
    }
  }, [value, editor]);

  const handleSourceChange = (nextText: string) => {
    setRawSource(nextText);
    const converted = textToTiptapDoc(nextText);
    onChange(converted);
    if (editor) {
      editor.commands.setContent(converted as unknown as Record<string, unknown>, false);
    }
  };

  const insertMathSnippet = () => {
    const nextText = `${rawSource} $x^2 + y^2 = r^2$`.trim();
    handleSourceChange(nextText);
  };

  const insertTableSnippet = () => {
    const nextText = `${rawSource}\n| Column 1 | Column 2 |\n| Value A | Value B |`.trim();
    handleSourceChange(nextText);
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-1 border-b border-slate-200 bg-slate-50/80 px-2.5 py-1.5">
        <div className="flex flex-wrap items-center gap-0.5">
          {label && (
            <span className="mr-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
              {label}
            </span>
          )}
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleBold().run()}
            className={`rounded p-1 text-slate-600 hover:bg-slate-200/70 ${
              editor?.isActive("bold") ? "bg-slate-200 text-slate-900" : ""
            }`}
            title="Bold"
          >
            <Bold className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleItalic().run()}
            className={`rounded p-1 text-slate-600 hover:bg-slate-200/70 ${
              editor?.isActive("italic") ? "bg-slate-200 text-slate-900" : ""
            }`}
            title="Italic"
          >
            <Italic className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleUnderline().run()}
            className={`rounded p-1 text-slate-600 hover:bg-slate-200/70 ${
              editor?.isActive("underline") ? "bg-slate-200 text-slate-900" : ""
            }`}
            title="Underline"
          >
            <UnderlineIcon className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleSubscript().run()}
            className={`rounded p-1 text-slate-600 hover:bg-slate-200/70 ${
              editor?.isActive("subscript") ? "bg-slate-200 text-slate-900" : ""
            }`}
            title="Subscript"
          >
            <SubIcon className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleSuperscript().run()}
            className={`rounded p-1 text-slate-600 hover:bg-slate-200/70 ${
              editor?.isActive("superscript") ? "bg-slate-200 text-slate-900" : ""
            }`}
            title="Superscript"
          >
            <SupIcon className="h-3.5 w-3.5" />
          </button>
          {!compact && (
            <>
              <span className="mx-1 h-3.5 w-px bg-slate-200" />
              <button
                type="button"
                onClick={() => editor?.chain().focus().toggleBulletList().run()}
                className="rounded p-1 text-slate-600 hover:bg-slate-200/70"
                title="Bullet List"
              >
                <List className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => editor?.chain().focus().toggleOrderedList().run()}
                className="rounded p-1 text-slate-600 hover:bg-slate-200/70"
                title="Ordered List"
              >
                <ListOrdered className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
                className="rounded p-1 text-slate-600 hover:bg-slate-200/70"
                title="Code Block"
              >
                <Code className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={insertMathSnippet}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50"
                title="Insert LaTeX Equation"
              >
                <Sigma className="h-3.5 w-3.5" />
                Math
              </button>
              <button
                type="button"
                onClick={insertTableSnippet}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-200/60"
                title="Insert Pipe Table"
              >
                <TableIcon className="h-3.5 w-3.5" />
                Table
              </button>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => setSourceMode((prev) => !prev)}
          className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium transition ${
            sourceMode
              ? "bg-indigo-600 text-white"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
          title="Toggle LaTeX / Markdown Structured Edit Mode"
        >
          <FileCode className="h-3 w-3" />
          {sourceMode ? "Visual Tiptap" : "LaTeX / MD"}
        </button>
      </div>

      {sourceMode ? (
        <textarea
          value={rawSource}
          onChange={(e) => handleSourceChange(e.target.value)}
          rows={compact ? 2 : 4}
          className="w-full resize-y rounded-b-lg bg-slate-900 p-3 font-mono text-xs text-slate-100 focus:outline-none"
          placeholder="Enter text, LaTeX ($...$ or $$...$$), or pipe tables (| A | B |)..."
        />
      ) : (
        <div className={compact ? "px-3 py-2 text-sm" : "px-3.5 py-2.5 text-sm"}>
          <EditorContent editor={editor} />
        </div>
      )}
    </div>
  );
}
