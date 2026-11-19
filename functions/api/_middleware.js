/**
 * Cloudflare Pages Functions 全局 CORS 中间件（仅作用于 /api/* 路由）
 *
 * 在 Cloudflare Pages（前端仓库项目）环境变量中配置：
 *   ADMIN_ORIGIN = https://admin.xxx.com
 * 如需同时允许多个后台来源（例如本地调试 + 生产域名），用英文逗号分隔：
 *   ADMIN_ORIGIN = https://admin.xxx.com,http://localhost:8788
 */

function parseAllowedOrigins(env) {
  const raw = String(env.ADMIN_ORIGIN || "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => item.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

function resolveCorsOrigin(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return null;

  const normalizedOrigin = origin.replace(/\/+$/, "");
  const selfOrigin = new URL(request.url).origin.replace(/\/+$/, "");

  // 同源请求直接放行
  if (normalizedOrigin === selfOrigin) {
    return normalizedOrigin;
  }

  // 精确匹配白名单（携带 Cookie 时严禁返回通配符 *）
  const allowedOrigins = parseAllowedOrigins(env);
  if (allowedOrigins.includes(normalizedOrigin)) {
    return normalizedOrigin;
  }

  return null;
}

function buildCorsHeaders(allowedOrigin) {
  const headers = new Headers();
  if (!allowedOrigin) return headers;

  headers.set("Access-Control-Allow-Origin", allowedOrigin);
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  headers.set("Access-Control-Max-Age", "86400");
  headers.set("Vary", "Origin");
  return headers;
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const allowedOrigin = resolveCorsOrigin(request, env);

  // 处理浏览器跨域预检请求（Preflight）
  if (request.method === "OPTIONS") {
    if (!allowedOrigin) {
      return new Response(null, { status: 403 });
    }
    return new Response(null, {
      status: 204,
      headers: buildCorsHeaders(allowedOrigin),
    });
  }

  const response = await next();
  if (!allowedOrigin) {
    return response;
  }

  // 克隆响应头，避免覆盖下游接口返回的 Set-Cookie
  const headers = new Headers(response.headers);
  const corsHeaders = buildCorsHeaders(allowedOrigin);
  corsHeaders.forEach((value, key) => {
    headers.set(key, value);
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
