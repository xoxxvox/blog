import { json, errorJson, getSessionUser } from "./_lib.js";
import { LEVELS, CATALOG, loadPolicies, savePolicies, permissionsFor, normalizeRole, isSuperAdmin } from "./_permissions.js";
export async function onRequestGet({ request, env }) {
  const user = await getSessionUser(request, env);
  const result = { role: normalizeRole(user?.role), levels: LEVELS, permissions: await permissionsFor(env, user) };
  if (isSuperAdmin(user)) Object.assign(result, { catalog: CATALOG, policies: await loadPolicies(env) });
  return json(result, 200, { "Cache-Control": "no-store" });
}
export async function onRequestPost({ request, env }) {
  const user = await getSessionUser(request, env);
  if (!isSuperAdmin(user)) return errorJson("仅后台最高权限管理员可修改等级权限", 403);
  return errorJson("三档权限由系统固定，无需单独配置", 410);
}
