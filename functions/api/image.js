import { errorJson, githubGetFile } from "./_lib.js";

const MIME_MAP = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
};

function buildImageHeaders(contentType, cacheControl, extra = {}) {
  const headers = {
    "Content-Type": contentType,
    "Cache-Control": cacheControl,
    "X-Content-Type-Options": "nosniff",
    ...extra,
  };
  if (String(contentType).toLowerCase().includes("svg")) {
    headers["Content-Security-Policy"] = "default-src 'none'; sandbox";
  }
  return headers;
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const proxyUrl = url.searchParams.get("proxy") || "";
  if (proxyUrl) {
    const allowedOrigins = [
      "https://pub-105437dbb4d349c4ba6d4580b46b8611.r2.dev/",
      "https://imghub-8t7.pages.dev/",
    ];
    if (!allowedOrigins.some((origin) => proxyUrl.startsWith(origin))) {
      return errorJson("不允许代理该图片地址", 403);
    }
    try {
      const signal = typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined;
      const upstream = await fetch(proxyUrl, signal ? { signal } : undefined);
      if (!upstream.ok) return errorJson("代理获取图片失败", upstream.status);
      const upstreamType = upstream.headers.get("Content-Type") || "image/webp";
      return new Response(upstream.body, {
        status: 200,
        headers: buildImageHeaders(upstreamType, "public, max-age=3600", {
          "Access-Control-Allow-Origin": "*",
        }),
      });
    } catch {
      return errorJson("代理图片异常", 500);
    }
  }

  const key = url.searchParams.get("key") || "";
  const path = url.searchParams.get("path") || "";
  const target = key || path;

  if (!target.startsWith("images/") || target.includes("..")) {
    return errorJson("非法的图片路径", 400);
  }

  const ext = target.split(".").pop()?.toLowerCase() || "";
  const contentType = MIME_MAP[ext];
  if (!contentType) {
    return errorJson("不支持的图片类型", 400);
  }

  // 优先从 Cloudflare R2 读取（当使用 ?key= 或已绑定 R2 时）
  if (env.IMAGES && (key || !path)) {
    try {
      const obj = await env.IMAGES.get(target);
      if (obj) {
        const resolvedType = obj.httpMetadata?.contentType || contentType;
        return new Response(obj.body, {
          status: 200,
          headers: buildImageHeaders(resolvedType, "public, max-age=31536000, immutable", obj.httpEtag ? { ETag: obj.httpEtag } : {}),
        });
      }
      if (key) return errorJson("R2 图片不存在", 404);
    } catch {
      return errorJson("读取 R2 图片失败", 500);
    }
  }

  // 兼容 GitHub 仓库图片读取
  try {
    const file = await githubGetFile(env, target);
    if (!file) return errorJson("图片不存在", 404);

    return new Response(file.bytes, {
      status: 200,
      headers: buildImageHeaders(contentType, "public, max-age=31536000, immutable"),
    });
  } catch {
    return errorJson("读取图片失败", 500);
  }
}
