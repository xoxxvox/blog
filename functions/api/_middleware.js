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
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Session");
  headers.set("Access-Control-Max-Age", "86400");
  headers.set("Vary", "Origin");
  return headers;
}

function withSecurityHeaders(headers) {
  if (!headers.has("X-Content-Type-Options")) {
    headers.set("X-Content-Type-Options", "nosniff");
  }
  if (!headers.has("Referrer-Policy")) {
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  }
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
      headers: withSecurityHeaders(buildCorsHeaders(allowedOrigin)),
    });
  }

  // 写操作若携带不在白名单的 Origin，直接拒绝
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method.toUpperCase()) && request.headers.has("Origin") && !allowedOrigin) {
    return new Response(JSON.stringify({ error: "非法请求来源" }), {
      status: 403,
      headers: withSecurityHeaders(new Headers({ "Content-Type": "application/json; charset=utf-8" })),
    });
  }

  const response = await next();

  // 克隆响应头，避免覆盖下游接口返回的 Set-Cookie
  const headers = withSecurityHeaders(new Headers(response.headers));
  if (allowedOrigin) {
    const corsHeaders = buildCorsHeaders(allowedOrigin);
    corsHeaders.forEach((value, key) => {
      if (key.toLowerCase() === 'vary') {
        const tokens = new Set((headers.get('Vary') || '').split(',').map(token => token.trim()).filter(Boolean));
        if (![...tokens].some(token => token.toLowerCase() === 'origin')) tokens.add('Origin');
        headers.set('Vary', [...tokens].join(', '));
      } else headers.set(key, value);
    });
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
