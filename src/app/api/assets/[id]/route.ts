import { NextRequest, NextResponse } from "next/server";
import {
  apiErrorResponse,
  verifySignedAssetUrl,
  withApiProtection
} from "@/lib/auth/security";
import { getStorageProvider } from "@/lib/storage/storage-provider";
import { questionBankRepo } from "@/repositories/question-bank.repository";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const expires = req.nextUrl.searchParams.get("expires");
  const sig = req.nextUrl.searchParams.get("sig");

  const hasValidSignedToken =
    Boolean(expires && sig) && verifySignedAssetUrl(params.id, expires!, sig!);

  if (!hasValidSignedToken) {
    const guard = withApiProtection(req);
    if (!guard.ok) return guard.response;
  }

  const asset = await questionBankRepo.getAssetById(params.id);
  if (!asset) {
    return apiErrorResponse("ASSET_NOT_FOUND", "Requested question asset not found.", 404);
  }

  try {
    const storage = getStorageProvider();
    const buffer = await storage.getObject(asset.storageKey);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": asset.mimeType || "image/png",
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch {
    return apiErrorResponse("ASSET_READ_ERROR", "Unable to read private asset object.", 404);
  }
}
