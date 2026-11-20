import { json, errorJson, getSessionUser } from "./_lib.js";
import { LEVELS, CATALOG, loadPolicies, savePolicies, permissionsFor, normalizeRole, isSuperAdmin } from "./_permissions.js";
export async function onRequestGet({ request, env }) {
  const user = await getSessionUser(request, env);
  const result = { role: isSuperAdmin(user) ? "superadmin" : normalizeRole(user?.role), levels: LEVELS, permissions: await permissionsFor(env, user) };
  if (isSuperAdmin(user)) Object.assign(result, { catalog: CATALOG, policies: await loadPolicies(env) });
  return json(result, 200, { "Cache-Control": "no-store" });
}
export async function onRequestPost({ request, env }) {
  const user = await getSessionUser(request, env);
  if (!isSuperAdmin(user)) return errorJson("仅后台最高权限管理员可修改等级权限", 403);
  if (!env.DB) return errorJson("请先绑定 D1 数据库后保存权限", 400);
  let policies;
  try { policies = (await request.json()).policies; } catch { return errorJson("请求格式无效", 400); }
  try { return json({ ok: true, policies: await savePolicies(env, policies) }); }
  catch (error) { return errorJson(error.message || "保存失败", 400); }
}
