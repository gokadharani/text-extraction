type LogLevel = "debug" | "info" | "warn" | "error";

const SENSITIVE_KEYS = new Set([
  "apikey",
  "api_key",
  "openaiapikey",
  "openai_api_key",
  "secret",
  "secretaccesskey",
  "password",
  "token",
  "authorization",
  "rawtext",
  "fulltext",
  "documentbuffer",
  "filebuffer",
  "internalpath"
]);

function sanitizeMeta(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[MaxDepth]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    // Redact anything looking like an sk-... key
    const redacted = value.replace(/sk-[a-zA-Z0-9_-]{16,}/g, "[REDACTED_API_KEY]");
    if (redacted.length > 500) {
      return `${redacted.slice(0, 500)}...[TRUNCATED_${redacted.length}_CHARS]`;
    }
    return redacted;
  }
  if (typeof value !== "object") return value;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return `[BinaryBuffer:${value.byteLength}B]`;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 25).map((item) => sanitizeMeta(item, depth + 1));
  }
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (SENSITIVE_KEYS.has(normalizedKey)) {
      result[key] = "[REDACTED]";
    } else {
      result[key] = sanitizeMeta(val, depth + 1);
    }
  }
  return result;
}

export class StructuredLogger {
  constructor(private readonly component: string) {}

  private emit(level: LogLevel, event: string, meta?: Record<string, unknown>) {
    if (process.env.NODE_ENV === "test" && level !== "error" && !process.env.ENABLE_TEST_LOGS) {
      return;
    }
    const payload = {
      timestamp: new Date().toISOString(),
      level,
      component: this.component,
      event,
      ...(meta ? (sanitizeMeta(meta) as Record<string, unknown>) : {})
    };
    const serialized = JSON.stringify(payload);
    if (level === "error") {
      console.error(serialized);
    } else if (level === "warn") {
      console.warn(serialized);
    } else {
      console.log(serialized);
    }
  }

  debug(event: string, meta?: Record<string, unknown>) {
    this.emit("debug", event, meta);
  }

  info(event: string, meta?: Record<string, unknown>) {
    this.emit("info", event, meta);
  }

  warn(event: string, meta?: Record<string, unknown>) {
    this.emit("warn", event, meta);
  }

  error(event: string, meta?: Record<string, unknown>) {
    this.emit("error", event, meta);
  }
}

export function createLogger(component: string): StructuredLogger {
  return new StructuredLogger(component);
}
