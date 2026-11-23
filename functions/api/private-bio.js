import { json, errorJson, getSessionUser } from "./_lib.js";
import { can, isSuperAdmin, isAdminOrAbove } from "./_permissions.js";
async function ensure(env) { await env.DB.prepare("CREATE TABLE IF NOT EXISTS private_bio (id INTEGER PRIMARY KEY CHECK(id=1), bio_json TEXT NOT NULL)").run(); }
export async function onRequestGet({ request, env }) {
  if (!env.DB) return errorJson("未绑定 D1 数据库", 500);
  const user = await getSessionUser(request, env);
  if (!user || !isAdminOrAbove(user)) return errorJson("无权读取历史资料", 403);
  await ensure(env); const row = await env.DB.prepare("SELECT bio_json FROM private_bio WHERE id=1").first();
  return json({ bio: row ? JSON.parse(row.bio_json) : null }, 200, { "Cache-Control": "private, no-store", Vary: "Cookie" });
}
export async function onRequestPost() { return errorJson("此设置已停用，历史数据保持不变", 410); }
