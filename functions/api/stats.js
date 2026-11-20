import { json, errorJson, getSessionUser } from "./_lib.js";
import { isSuperAdmin } from "./_permissions.js";

async function ensureMetricsTable(env) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS site_metrics (key TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0)"
    ).run();
  } catch {}
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) return errorJson("未绑定 D1 数据库", 500);
  const user = await getSessionUser(request, env);
  if (!isSuperAdmin(user)) return errorJson("仅后台最高权限管理员可查看统计", 403);

  await ensureMetricsTable(env);
  const nowSec = Math.floor(Date.now() / 1000);
  const [commentsRow, privateRow, usersRow, sessionsRow, viewsRow] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS cnt FROM comments").first().catch(() => ({ cnt: 0 })),
    env.DB.prepare("SELECT COUNT(*) AS cnt FROM private_posts").first().catch(() => ({ cnt: 0 })),
    env.DB.prepare("SELECT COUNT(*) AS cnt FROM users").first().catch(() => ({ cnt: 0 })),
    env.DB.prepare("SELECT COUNT(*) AS cnt FROM sessions WHERE expires_at > ?").bind(nowSec).first().catch(() => ({ cnt: 0 })),
    env.DB.prepare("SELECT value FROM site_metrics WHERE key = 'total_visits'").first().catch(() => ({ value: 0 })),
  ]);

  return json({
    commentsCount: Number(commentsRow?.cnt || 0),
    privatePostsCount: Number(privateRow?.cnt || 0),
    usersCount: Number(usersRow?.cnt || 0),
    activeSessionsCount: Number(sessionsRow?.cnt || 0),
    visitsCount: Number(viewsRow?.value || 0),
  });
}

export async function onRequestPost({ env }) {
  if (!env.DB) return json({ ok: false }, 200);
  await ensureMetricsTable(env);
  await env.DB.prepare(
    "INSERT INTO site_metrics (key, value) VALUES ('total_visits', 1) ON CONFLICT(key) DO UPDATE SET value = value + 1"
  ).run().catch(() => {});
  return json({ ok: true });
}
