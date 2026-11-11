"use client";

import React from "react";
import katex from "katex";
import { TiptapDoc, TiptapNode } from "@/domain/schemas/question.schema";

interface StudentLivePreviewProps {
  doc: TiptapDoc | null | undefined;
  className?: string;
}

function renderLatexSafe(latex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      strict: "ignore",
      output: "html"
    });
  } catch {
    return latex;
  }
}

function renderInlineMarks(text: string, marks?: TiptapNode["marks"]): React.ReactNode {
  let element: React.ReactNode = text;
  if (!marks || marks.length === 0) return element;

  for (const mark of marks) {
    switch (mark.type) {
      case "bold":
        element = <strong className="font-semibold text-slate-900">{element}</strong>;
        break;
      case "italic":
        element = <em className="italic">{element}</em>;
        break;
      case "underline":
        element = <u className="underline underline-offset-2">{element}</u>;
        break;
      case "subscript":
        element = <sub>{element}</sub>;
        break;
      case "superscript":
        element = <sup>{element}</sup>;
        break;
      case "code":
        element = (
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-800 border border-slate-200">
            {element}
          </code>
        );
        break;
      default:
        break;
    }
  }
  return element;
}

function renderTiptapNode(node: TiptapNode, key: string): React.ReactNode {
  switch (node.type) {
    case "doc":
      return (
        <div key={key} className="space-y-2">
          {node.content?.map((child, idx) => renderTiptapNode(child, `${key}-${idx}`))}
        </div>
      );

    case "paragraph":
      return (
        <p key={key} className="leading-relaxed text-slate-800">
          {node.content?.map((child, idx) => renderTiptapNode(child, `${key}-${idx}`))}
        </p>
      );

    case "heading": {
      const level = Number(node.attrs?.level || 2);
      const cls =
        level === 1
          ? "text-lg font-bold text-slate-900"
          : level === 2
            ? "text-base font-semibold text-slate-900"
            : "text-sm font-semibold text-slate-800";
      return (
        <div key={key} className={cls}>
          {node.content?.map((child, idx) => renderTiptapNode(child, `${key}-${idx}`))}
        </div>
      );
    }

    case "text":
      return (
        <React.Fragment key={key}>
          {renderInlineMarks(node.text || "", node.marks)}
        </React.Fragment>
      );

    case "mathInline": {
      const latex = String(node.attrs?.latex || "");
      const isBlock = node.attrs?.display === "block";
      const html = renderLatexSafe(latex, isBlock);
      return (
        <span
          key={key}
          className={isBlock ? "my-2 block overflow-x-auto py-1 text-center" : "mx-0.5 inline-block"}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      );
    }

    case "mathBlock": {
      const latex = String(node.attrs?.latex || "");
      const html = renderLatexSafe(latex, true);
      return (
        <div
          key={key}
          className="my-2 overflow-x-auto rounded-md bg-slate-50/80 px-3 py-2 text-center border border-slate-200/70"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      );
    }

    case "bulletList":
      return (
        <ul key={key} className="list-disc space-y-1 pl-5 text-slate-800">
          {node.content?.map((child, idx) => renderTiptapNode(child, `${key}-${idx}`))}
        </ul>
      );

    case "orderedList":
      return (
        <ol key={key} className="list-decimal space-y-1 pl-5 text-slate-800">
          {node.content?.map((child, idx) => renderTiptapNode(child, `${key}-${idx}`))}
        </ol>
      );

    case "listItem":
      return (
        <li key={key}>
          {node.content?.map((child, idx) => renderTiptapNode(child, `${key}-${idx}`))}
        </li>
      );

    case "table":
      return (
        <div key={key} className="my-2 overflow-x-auto rounded-md border border-slate-200">
          <table className="w-full border-collapse text-left text-sm">
            <tbody>
              {node.content?.map((child, idx) => renderTiptapNode(child, `${key}-${idx}`))}
            </tbody>
          </table>
        </div>
      );

    case "tableRow":
      return (
        <tr key={key} className="border-b border-slate-200 last:border-b-0">
          {node.content?.map((child, idx) => renderTiptapNode(child, `${key}-${idx}`))}
        </tr>
      );

    case "tableHeader":
      return (
        <th
          key={key}
          className="border-r border-slate-200 bg-slate-100 px-3 py-2 font-semibold text-slate-900 last:border-r-0"
        >
          {node.content?.map((child, idx) => renderTiptapNode(child, `${key}-${idx}`))}
        </th>
      );

    case "tableCell":
      return (
        <td
          key={key}
          className="border-r border-slate-200 px-3 py-2 text-slate-700 last:border-r-0"
        >
          {node.content?.map((child, idx) => renderTiptapNode(child, `${key}-${idx}`))}
        </td>
      );

    case "codeBlock":
      return (
        <pre
          key={key}
          className="my-2 overflow-x-auto rounded-md bg-slate-900 p-3 font-mono text-xs text-slate-100"
        >
          <code>
            {node.content?.map((c) => c.text || "").join("")}
          </code>
        </pre>
      );

    case "imageInline":
    case "imageBlock":
    case "image": {
      const src = String(node.attrs?.src || "");
      const alt = String(node.attrs?.alt || "Question diagram");
      return (
        <div
          key={key}
          className="my-2 inline-flex flex-col items-start rounded-md border border-slate-200 bg-slate-50 p-2"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            className="max-h-60 rounded object-contain"
          />
          <span className="mt-1 text-xs text-slate-500">{alt}</span>
        </div>
      );
    }

    case "hardBreak":
      return <br key={key} />;

    default:
      return null;
  }
}

export function StudentLivePreview({ doc, className = "" }: StudentLivePreviewProps) {
  if (!doc || !doc.content || doc.content.length === 0) {
    return <span className="italic text-slate-400">Empty content</span>;
  }

  return (
    <div className={`text-sm ${className}`}>
      {renderTiptapNode(doc, "root")}
    </div>
  );
}
