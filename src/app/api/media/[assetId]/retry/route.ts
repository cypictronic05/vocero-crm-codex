import { apiError, withAuth } from "@/lib/api";
import { canAccessMediaAsset } from "@/server/assignments/access";
import {
  retryAssetDownload,
  serializeMediaAsset,
} from "@/server/whatsapp/media";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ assetId: string }> };

export const POST = withAuth(async (session, _req: Request, ctx: Params) => {
  const { assetId } = await ctx.params;
  if (!/^[\w.-]{1,64}$/.test(assetId)) {
    return apiError(422, "invalid", "assetId inválido");
  }
  if (!(await canAccessMediaAsset(session, assetId))) {
    return apiError(404, "not_found", "Adjunto no encontrado");
  }
  const asset = await retryAssetDownload(session.organizationId, assetId);
  if (!asset) {
    return apiError(409, "not_failed", "El adjunto ya no está en estado fallido");
  }
  return Response.json({ media: serializeMediaAsset(asset) });
});
