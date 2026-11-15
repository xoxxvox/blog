import { json, errorJson, getSessionUser, githubPutFile, base64ToBytes } from "./_lib.js";

const MIME_MAP = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
};

const MAX_R2_BYTES = 10 * 1024 * 1024; // 10 MB when using R2
const MAX_GH_BYTES = 4 * 1024 * 1024;  // 4 MB fallback for GitHub

export async function onRequestPost({ request, env }) {
  const user = await getSessionUser(request, env);
  if (!user) return errorJson("请先登录", 401);
  if (user.role !== "admin") return errorJson("仅管理员可上传图片", 403);

  let body;
  try {
    body = await request.json();
  } catch {
    return errorJson("请求格式无效", 400);
  }

  const filename = String(body.filename || "image.png").trim();
  const dataUrl = String(body.dataUrl || "");
  const match = dataUrl.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/);
  if (!match) {
    return errorJson("无效的图片格式", 400);
  }

  const rawExt = filename.split(".").pop()?.toLowerCase() || "";
  const mimeExt = match[1].toLowerCase().replace("svg+xml", "svg");
  const ext = MIME_MAP[rawExt] ? rawExt : MIME_MAP[mimeExt] ? mimeExt : null;
  if (!ext) {
    return errorJson("仅支持 png / jpg / webp / gif / svg 图片", 400);
  }

  const bytes = base64ToBytes(match[2]);
  const safeBase =
    filename
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-zA-Z0-9_-]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 36) || "img";
  const objectKey = `images/${Date.now()}-${safeBase}.${ext}`;

  // 最佳实践：优先写入 Cloudflare R2（绑定变量名 IMAGES）
  if (env.IMAGES) {
    if (bytes.byteLength > MAX_R2_BYTES) {
      return errorJson("图片大小不能超过 10MB", 400);
    }
    try {
      await env.IMAGES.put(objectKey, bytes, {
        httpMetadata: { contentType: MIME_MAP[ext] },
      });
      return json({
        ok: true,
        storage: "r2",
        path: objectKey,
        url: `/api/image?key=${encodeURIComponent(objectKey)}`,
      });
    } catch (err) {
      return errorJson(err.message || "图片上传到 R2 失败", 500);
    }
  }

  // 未绑定 R2 时，自动回退写入 GitHub 仓库 images/ 目录
  if (bytes.byteLength > MAX_GH_BYTES) {
    return errorJson("未绑定 R2 时图片不能超过 4MB", 400);
  }
  try {
    await githubPutFile(
      env,
      objectKey,
      bytes,
      `chore(assets): upload ${safeBase}.${ext} by ${user.username}`,
      true
    );
    return json({
      ok: true,
      storage: "github",
      path: objectKey,
      url: `/api/image?path=${encodeURIComponent(objectKey)}`,
    });
  } catch (err) {
    return errorJson(err.message || "图片上传 GitHub 失败", 500);
  }
}
