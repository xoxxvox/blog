import { errorJson, githubGetFile } from "./_lib.js";

const MIME_MAP = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
};

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const path = url.searchParams.get("path") || "";

  if (!path.startsWith("images/") || path.includes("..")) {
    return errorJson("非法的图片路径", 400);
  }

  const ext = path.split(".").pop()?.toLowerCase() || "";
  const contentType = MIME_MAP[ext];
  if (!contentType) {
    return errorJson("不支持的图片类型", 400);
  }

  try {
    const file = await githubGetFile(env, path);
    if (!file) return errorJson("图片不存在", 404);

    return new Response(file.bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    return errorJson(err.message || "读取图片失败", 500);
  }
}
