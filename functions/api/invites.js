import { json, errorJson, getSessionUser } from "./_lib.js";

function randomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let out = "XXO-";
  for (let i = 0; i < 8; i++) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) return errorJson("未绑定 D1 数据库", 500);
  const user = await getSessionUser(request, env);
  if (!user || user.role !== "admin") return errorJson("仅管理员可查看邀请码", 403);

  const { results } = await env.DB.prepare(
    "SELECT code, role, created_by, used_by, used_at, created_at FROM invites ORDER BY created_at DESC LIMIT 100"
  ).all();

  return json({ invites: results || [] });
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return errorJson("未绑定 D1 数据库", 500);
  const user = await getSessionUser(request, env);
  if (!user || user.role !== "admin") return errorJson("仅管理员可生成邀请码", 403);

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const custom = String(body.code || "").trim().toUpperCase();
  const code = custom || randomCode();
  const role = body.role === "admin" ? "admin" : "user";

  if (code.length < 4 || code.length > 32) {
    return errorJson("邀请码长度需在 4 到 32 位之间", 400);
  }

  const exists = await env.DB.prepare("SELECT code FROM invites WHERE code = ?").bind(code).first();
  if (exists) return errorJson("该邀请码已存在", 409);

  const nowIso = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO invites (code, role, created_by, created_at) VALUES (?, ?, ?, ?)"
  )
    .bind(code, role, user.username, nowIso)
    .run();

  return json({ invite: { code, role, created_by: user.username, used_by: null, created_at: nowIso } }, 201);
}

export async function onRequestDelete({ request, env }) {
  if (!env.DB) return errorJson("未绑定 D1 数据库", 500);
  const user = await getSessionUser(request, env);
  if (!user || user.role !== "admin") return errorJson("仅管理员可删除邀请码", 403);

  const url = new URL(request.url);
  const code = String(url.searchParams.get("code") || "").trim();
  if (!code) return errorJson("缺少邀请码参数", 400);

  await env.DB.prepare("DELETE FROM invites WHERE code = ?").bind(code).run();
  return json({ ok: true });
}
