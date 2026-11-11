import crypto from "crypto";
import { getAppConfig } from "@/config/env";

export type SupportedFileCategory =
  | "PDF"
  | "DOCX"
  | "DOC"
  | "XLSX"
  | "XLS"
  | "PNG"
  | "JPEG"
  | "WEBP";

export interface FileValidationResult {
  valid: boolean;
  category?: SupportedFileCategory;
  detectedMimeType?: string;
  sha256?: string;
  fileSize: number;
  sanitizedFileName: string;
  errorCode?:
    | "EMPTY_FILE"
    | "FILE_TOO_LARGE"
    | "UNSUPPORTED_EXTENSION"
    | "SIGNATURE_MISMATCH"
    | "CORRUPTED_FILE"
    | "ENCRYPTED_DOCUMENT"
    | "SUSPICIOUS_CONTENT";
  errorMessage?: string;
}

const EICAR_SIGNATURE = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

export function sanitizeFileName(rawName: string): string {
  // Strip any directory paths (path traversal prevention)
  const base = rawName.replace(/^.*[\\/]/, "").trim();
  const cleaned = base.replace(/[^a-zA-Z0-9._\-\s()]/g, "_").replace(/\.{2,}/g, ".");
  return cleaned || "uploaded-document";
}

export function validateUploadedFile(
  buffer: Buffer,
  fileName: string,
  maxBytesOverride?: number
): FileValidationResult {
  const config = getAppConfig();
  const maxBytes = maxBytesOverride ?? config.limits.maxFileSizeBytes;
  const sanitizedFileName = sanitizeFileName(fileName);
  const fileSize = buffer.byteLength;

  if (fileSize === 0) {
    return {
      valid: false,
      fileSize,
      sanitizedFileName,
      errorCode: "EMPTY_FILE",
      errorMessage: "The uploaded file is empty (0 bytes)."
    };
  }

  if (fileSize > maxBytes) {
    return {
      valid: false,
      fileSize,
      sanitizedFileName,
      errorCode: "FILE_TOO_LARGE",
      errorMessage: `File size (${(fileSize / (1024 * 1024)).toFixed(2)} MB) exceeds maximum allowed limit (${(
        maxBytes /
        (1024 * 1024)
      ).toFixed(1)} MB).`
    };
  }

  if (fileSize < 8) {
    return {
      valid: false,
      fileSize,
      sanitizedFileName,
      errorCode: "CORRUPTED_FILE",
      errorMessage: "File is too small to contain valid document headers."
    };
  }

  // Malware / executable check
  const headAscii = buffer.subarray(0, Math.min(buffer.length, 4096)).toString("latin1");
  if (
    headAscii.includes(EICAR_SIGNATURE) ||
    (buffer[0] === 0x4d && buffer[1] === 0x5a) || // Windows PE MZ executable
    (buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) // ELF binary
  ) {
    return {
      valid: false,
      fileSize,
      sanitizedFileName,
      errorCode: "SUSPICIOUS_CONTENT",
      errorMessage: "Suspicious or executable content detected. Upload rejected."
    };
  }

  const ext = sanitizedFileName.split(".").pop()?.toLowerCase() || "";
  const allowedExtensions = new Set([
    "pdf",
    "docx",
    "doc",
    "xlsx",
    "xls",
    "png",
    "jpg",
    "jpeg",
    "webp"
  ]);

  if (!allowedExtensions.has(ext)) {
    return {
      valid: false,
      fileSize,
      sanitizedFileName,
      errorCode: "UNSUPPORTED_EXTENSION",
      errorMessage: `Unsupported file extension ".${ext}". Supported formats: PDF, DOCX, DOC, XLSX, XLS, PNG, JPG, JPEG, WEBP.`
    };
  }

  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");

  // 1. Check PDF magic bytes: %PDF- (0x25 0x50 0x44 0x46 0x2D)
  const isPdfHeader =
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46 &&
    buffer[4] === 0x2d;

  if (isPdfHeader) {
    if (ext !== "pdf") {
      return {
        valid: false,
        fileSize,
        sanitizedFileName,
        errorCode: "SIGNATURE_MISMATCH",
        errorMessage: `File has a PDF binary signature but extension is ".${ext}".`
      };
    }
    const fullAsciiSample =
      buffer.length <= 200_000
        ? buffer.toString("latin1")
        : buffer.subarray(0, 100_000).toString("latin1") +
          buffer.subarray(buffer.length - 100_000).toString("latin1");

    if (/\/Encrypt\b/.test(fullAsciiSample)) {
      return {
        valid: false,
        fileSize,
        sanitizedFileName,
        errorCode: "ENCRYPTED_DOCUMENT",
        errorMessage: "Encrypted or password-protected PDF files are not supported."
      };
    }

    if (!fullAsciiSample.includes("%%EOF") && !fullAsciiSample.includes("endobj")) {
      return {
        valid: false,
        fileSize,
        sanitizedFileName,
        errorCode: "CORRUPTED_FILE",
        errorMessage: "The PDF file appears truncated or corrupted (missing PDF structure markers)."
      };
    }

    return {
      valid: true,
      category: "PDF",
      detectedMimeType: "application/pdf",
      sha256,
      fileSize,
      sanitizedFileName
    };
  }

  // 2. Check PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
  const isPngHeader =
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a;

  if (isPngHeader) {
    if (ext !== "png") {
      return {
        valid: false,
        fileSize,
        sanitizedFileName,
        errorCode: "SIGNATURE_MISMATCH",
        errorMessage: `File has a PNG binary signature but extension is ".${ext}".`
      };
    }
    return {
      valid: true,
      category: "PNG",
      detectedMimeType: "image/png",
      sha256,
      fileSize,
      sanitizedFileName
    };
  }

  // 3. Check JPEG magic bytes: FF D8 FF
  const isJpegHeader = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (isJpegHeader) {
    if (ext !== "jpg" && ext !== "jpeg") {
      return {
        valid: false,
        fileSize,
        sanitizedFileName,
        errorCode: "SIGNATURE_MISMATCH",
        errorMessage: `File has a JPEG binary signature but extension is ".${ext}".`
      };
    }
    return {
      valid: true,
      category: "JPEG",
      detectedMimeType: "image/jpeg",
      sha256,
      fileSize,
      sanitizedFileName
    };
  }

  // 4. Check WEBP magic bytes: RIFF....WEBP
  const isWebpHeader =
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50;

  if (isWebpHeader) {
    if (ext !== "webp") {
      return {
        valid: false,
        fileSize,
        sanitizedFileName,
        errorCode: "SIGNATURE_MISMATCH",
        errorMessage: `File has a WEBP binary signature but extension is ".${ext}".`
      };
    }
    return {
      valid: true,
      category: "WEBP",
      detectedMimeType: "image/webp",
      sha256,
      fileSize,
      sanitizedFileName
    };
  }

  // 5. Check ZIP / OOXML magic bytes: PK\x03\x04 (50 4B 03 04) for DOCX & XLSX
  const isZipHeader =
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04;

  if (isZipHeader) {
    const zipString = buffer.toString("latin1");
    if (zipString.includes("EncryptedPackage") || zipString.includes("EncryptionInfo")) {
      return {
        valid: false,
        fileSize,
        sanitizedFileName,
        errorCode: "ENCRYPTED_DOCUMENT",
        errorMessage: "Encrypted Office document detected. Please upload an unencrypted file."
      };
    }

    if (ext === "docx") {
      if (!zipString.includes("word/document.xml") && !zipString.includes("[Content_Types].xml")) {
        return {
          valid: false,
          fileSize,
          sanitizedFileName,
          errorCode: "CORRUPTED_FILE",
          errorMessage: "Invalid or corrupted DOCX archive (missing word/document.xml)."
        };
      }
      return {
        valid: true,
        category: "DOCX",
        detectedMimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sha256,
        fileSize,
        sanitizedFileName
      };
    }

    if (ext === "xlsx") {
      if (!zipString.includes("xl/workbook.xml") && !zipString.includes("[Content_Types].xml")) {
        return {
          valid: false,
          fileSize,
          sanitizedFileName,
          errorCode: "CORRUPTED_FILE",
          errorMessage: "Invalid or corrupted XLSX archive (missing xl/workbook.xml)."
        };
      }
      return {
        valid: true,
        category: "XLSX",
        detectedMimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        sha256,
        fileSize,
        sanitizedFileName
      };
    }

    return {
      valid: false,
      fileSize,
      sanitizedFileName,
      errorCode: "SIGNATURE_MISMATCH",
      errorMessage: `File is a ZIP/OOXML container but extension ".${ext}" does not match DOCX or XLSX.`
    };
  }

  // 6. Check OLE2 Compound Document magic bytes: D0 CF 11 E0 A1 B1 1A E1 (DOC / XLS)
  const isOle2Header =
    buffer[0] === 0xd0 &&
    buffer[1] === 0xcf &&
    buffer[2] === 0x11 &&
    buffer[3] === 0xe0 &&
    buffer[4] === 0xa1 &&
    buffer[5] === 0xb1 &&
    buffer[6] === 0x1a &&
    buffer[7] === 0xe1;

  if (isOle2Header) {
    const oleContent = buffer.toString("latin1");
    if (oleContent.includes("EncryptedPackage") || oleContent.includes("W\x00o\x00r\x00d\x00Crypt")) {
      return {
        valid: false,
        fileSize,
        sanitizedFileName,
        errorCode: "ENCRYPTED_DOCUMENT",
        errorMessage: "Encrypted legacy Office document is not supported."
      };
    }

    if (ext === "doc") {
      return {
        valid: true,
        category: "DOC",
        detectedMimeType: "application/msword",
        sha256,
        fileSize,
        sanitizedFileName
      };
    }
    if (ext === "xls") {
      return {
        valid: true,
        category: "XLS",
        detectedMimeType: "application/vnd.ms-excel",
        sha256,
        fileSize,
        sanitizedFileName
      };
    }
    return {
      valid: false,
      fileSize,
      sanitizedFileName,
      errorCode: "SIGNATURE_MISMATCH",
      errorMessage: `File has an OLE2 binary signature but extension is ".${ext}".`
    };
  }

  return {
    valid: false,
    fileSize,
    sanitizedFileName,
    errorCode: "SIGNATURE_MISMATCH",
    errorMessage: `File binary signature does not match extension ".${ext}" or any supported document format.`
  };
}
