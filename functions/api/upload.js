import { json, errorJson, getSessionUser, githubPutFile, base64ToBytes } from "./_lib.js";

const ALLOWED_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg"]);
const MAX_BYTES = 4 * 1024 * 1024; // 4 MB

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
  const ext = ALLOWED_EXT.has(rawExt) ? rawExt : ALLOWED_EXT.has(mimeExt) ? mimeExt : null;
  if (!ext) {
    return errorJson("仅支持 png / jpg / webp / gif / svg 图片", 400);
  }

  const bytes = base64ToBytes(match[2]);
  if (bytes.byteLength > MAX_BYTES) {
    return errorJson("图片大小不能超过 4MB", 400);
  }

  const safeBase = filename
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 36) || "img";
  const filePath = `images/${Date.now()}-${safeBase}.${ext}`;

  try {
    await githubPutFile(
      env,
      filePath,
      bytes,
      `chore(assets): upload ${safeBase}.${ext} by ${user.username}`,
      true
    );
    return json({
      ok: true,
      path: filePath,
      url: `/api/image?path=${encodeURIComponent(filePath)}`,
    });
  } catch (err) {
    return errorJson(err.message || "图片上传 GitHub 失败", 500);
  }
}
