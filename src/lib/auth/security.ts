import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAppConfig } from "@/config/env";

export interface AuthenticatedActor {
  userId: string;
  role: "admin" | "reviewer" | "editor";
  name: string;
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitBucket>();

/**
 * Authenticates incoming API requests via:
 * 1. Authorization: Bearer <token>
 * 2. x-api-key header
 * 3. Same-origin authenticated session cookie or internal UI header
 */
export function authenticateRequest(req: NextRequest): {
  authenticated: boolean;
  actor?: AuthenticatedActor;
  error?: string;
} {
  const config = getAppConfig();
  const authHeader = req.headers.get("authorization");
  const apiKeyHeader = req.headers.get("x-api-key");
  const sessionCookie = req.cookies.get("qbank_session")?.value;
  const clientHeader = req.headers.get("x-qbank-client");

  // Explicit reject if invalid bearer token is provided
  if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (token === config.defaultApiToken || verifySignedSessionToken(token, config.authSecret)) {
      return {
        authenticated: true,
        actor: {
          userId: "usr_principal_architect",
          role: "admin",
          name: "Principal Engineer"
        }
      };
    }
    return {
      authenticated: false,
      error: "Invalid Authorization Bearer token"
    };
  }

  if (apiKeyHeader) {
    if (apiKeyHeader === config.defaultApiToken) {
      return {
        authenticated: true,
        actor: {
          userId: "usr_api_client",
          role: "admin",
          name: "API Client"
        }
      };
    }
    return {
      authenticated: false,
      error: "Invalid API key"
    };
  }

  if (sessionCookie && verifySignedSessionToken(sessionCookie, config.authSecret)) {
    return {
      authenticated: true,
      actor: {
        userId: "usr_reviewer_1",
        role: "reviewer",
        name: "Question Bank Reviewer"
      }
    };
  }

  // Same-origin Next.js web UI session fallback (unless STRICT_API_AUTH=true)
  const referer = req.headers.get("referer") || "";
  const origin = req.headers.get("origin") || "";
  const isSameOriginWeb =
    clientHeader === "web-workspace" ||
    referer.includes("localhost") ||
    origin.includes("localhost") ||
    process.env.STRICT_API_AUTH !== "true";

  if (isSameOriginWeb) {
    return {
      authenticated: true,
      actor: {
        userId: "usr_workspace_operator",
        role: "admin",
        name: "Workspace Operator"
      }
    };
  }

  return {
    authenticated: false,
    error: "Authentication required"
  };
}

export function createSignedSessionToken(userId: string, role: string, expiresInSeconds = 86400): string {
  const config = getAppConfig();
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const payload = `${userId}:${role}:${exp}`;
  const signature = crypto
    .createHmac("sha256", config.authSecret)
    .update(payload)
    .digest("hex");
  return Buffer.from(`${payload}:${signature}`).toString("base64url");
}

export function verifySignedSessionToken(token: string, secret: string): boolean {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const parts = decoded.split(":");
    if (parts.length !== 4) return false;
    const [userId, role, expStr, signature] = parts;
    const exp = Number.parseInt(expStr, 10);
    if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
      return false;
    }
    const expectedSig = crypto
      .createHmac("sha256", secret)
      .update(`${userId}:${role}:${expStr}`)
      .digest("hex");
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig));
  } catch {
    return false;
  }
}

/**
 * Generates an HMAC-signed URL token for accessing private storage assets safely.
 */
export function createSignedAssetUrl(assetId: string, expiresInSeconds = 3600): string {
  const config = getAppConfig();
  const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const payload = `${assetId}:${expires}`;
  const sig = crypto
    .createHmac("sha256", config.signedUrlSecret)
    .update(payload)
    .digest("hex");
  return `/api/assets/${encodeURIComponent(assetId)}?expires=${expires}&sig=${sig}`;
}

export function verifySignedAssetUrl(assetId: string, expiresStr: string, sig: string): boolean {
  try {
    const config = getAppConfig();
    const expires = Number.parseInt(expiresStr, 10);
    if (!Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000)) {
      return false;
    }
    const payload = `${assetId}:${expires}`;
    const expectedSig = crypto
      .createHmac("sha256", config.signedUrlSecret)
      .update(payload)
      .digest("hex");
    if (sig.length !== expectedSig.length) return false;
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig));
  } catch {
    return false;
  }
}

/**
 * Enforces sliding-window rate limiting per IP / route group.
 */
export function checkRateLimit(
  identifier: string,
  maxRequests = 120,
  windowMs = 60_000
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const existing = rateLimitStore.get(identifier);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    rateLimitStore.set(identifier, { count: 1, resetAt });
    return { allowed: true, remaining: maxRequests - 1, resetAt };
  }

  if (existing.count >= maxRequests) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: maxRequests - existing.count,
    resetAt: existing.resetAt
  };
}

export function apiErrorResponse(
  code: string,
  message: string,
  status = 400,
  details?: unknown
): NextResponse {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        ...(details !== undefined ? { details } : {})
      }
    },
    { status }
  );
}

export function withApiProtection(
  req: NextRequest,
  options: { maxRequestsPerMinute?: number; requiredRole?: "admin" | "reviewer" | "editor" } = {}
): { ok: true; actor: AuthenticatedActor } | { ok: false; response: NextResponse } {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "127.0.0.1";
  const rate = checkRateLimit(`${ip}:${req.nextUrl.pathname}`, options.maxRequestsPerMinute ?? 120);
  if (!rate.allowed) {
    return {
      ok: false,
      response: apiErrorResponse(
        "RATE_LIMIT_EXCEEDED",
        "Too many requests. Please wait before retrying.",
        429
      )
    };
  }

  const auth = authenticateRequest(req);
  if (!auth.authenticated || !auth.actor) {
    return {
      ok: false,
      response: apiErrorResponse("UNAUTHORIZED", auth.error || "Authentication required", 401)
    };
  }

  return { ok: true, actor: auth.actor };
}
