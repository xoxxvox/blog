import { LEVELS } from "./_permissions.js";
import { json, errorJson, getSessionUser, cleanupExpiredAccounts } from "./_lib.js";

function randomCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let raw = "";
  for (let i = 0; i < 12; i++) {
    raw += chars[bytes[i] % chars.length];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) return errorJson("未绑定 D1 数据库", 500);
  const user = await getSessionUser(request, env);
  if (!user || user.role !== "admin") return errorJson("仅管理员可查看邀请码", 403);

  await cleanupExpiredAccounts(env);
  const { results } = await env.DB.prepare(
    `SELECT i.code, i.role, i.duration_days, i.expires_at, i.created_by, i.used_by, i.used_at, i.created_at,
            u.disabled_at AS user_disabled_at, COALESCE(u.username, i.used_by) AS bound_username, u.email AS bound_email
     FROM invites i
     LEFT JOIN users u ON u.username = i.used_by
     ORDER BY i.created_at DESC
     LIMIT 100`
  ).all();

  return json({ invites: results || [] });
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return errorJson("未绑定 D1 数据库", 500);
  const user = await getSessionUser(request, env);
  if (!user || user.role !== "admin") return errorJson("仅管理员可操作邀请码", 403);

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  if (body.action === "update_expiry") {
    const code = String(body.code || "").trim().toUpperCase();
    if (!code) return errorJson("缺少邀请码参数", 400);
    const expiresAt = body.expiresAt ? new Date(body.expiresAt).toISOString() : null;
    if (body.expiresAt && Number.isNaN(Date.parse(body.expiresAt))) {
      return errorJson("无效的到期时间", 400);
    }
    await env.DB.prepare("UPDATE invites SET expires_at = ? WHERE code = ?")
      .bind(expiresAt, code)
      .run();

    const isStillValid = !expiresAt || Date.parse(expiresAt) > Date.now();
    if (isStillValid) {
      await env.DB.prepare("UPDATE users SET disabled_at = NULL WHERE invite_code = ?")
        .bind(code)
        .run();
    } else {
      await cleanupExpiredAccounts(env);
    }
    return json({ ok: true, expires_at: expiresAt });
  }

  const custom = String(body.code || "").trim().toUpperCase();
  const code = custom || randomCode();
  const role = body.role || "user";
  if (!Object.hasOwn(LEVELS, role)) return errorJson("无效的账号等级", 400);
  const durationDays = Math.max(0, parseInt(body.durationDays ?? 30, 10) || 0);

  if (code.length < 4 || code.length > 32) {
    return errorJson("邀请码长度需在 4 到 32 位之间", 400);
  }

  const exists = await env.DB.prepare("SELECT code FROM invites WHERE code = ?").bind(code).first();
  if (exists) return errorJson("该邀请码已存在", 409);

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const expiresAt = durationDays > 0 ? new Date(now + durationDays * 86400000).toISOString() : null;

  await env.DB.prepare(
    "INSERT INTO invites (code, role, duration_days, expires_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(code, role, durationDays || null, expiresAt, user.username, nowIso)
    .run();

  return json(
    {
      invite: {
        code,
        role,
        duration_days: durationDays || null,
        expires_at: expiresAt,
        created_by: user.username,
        used_by: null,
        created_at: nowIso,
      },
    },
    201
  );
}

export async function onRequestDelete({ request, env }) {
  if (!env.DB) return errorJson("未绑定 D1 数据库", 500);
  const user = await getSessionUser(request, env);
  if (!user || user.role !== "admin") return errorJson("仅管理员可删除邀请码", 403);

  const url = new URL(request.url);
  const code = String(url.searchParams.get("code") || "").trim();
  if (!code) return errorJson("缺少邀请码参数", 400);

  await env.DB.prepare("DELETE FROM invites WHERE code = ?").bind(code).run();
  await cleanupExpiredAccounts(env);
  return json({ ok: true });
}
