export const SCOPE = "blog";
export const CATALOG = [["private_read", "阅读隐秘空间文章（VIP 起）", "隐秘空间"], ["private_export", "下载隐秘文章 Markdown（VIP 起）", "隐秘空间"], ["comment_delete_own", "删除自己的评论", "博客评论与附件"], ["comments_read", "查看评论", "博客评论与附件"], ["comment", "发表评论和回复", "博客评论与附件"], ["upload", "上传博客附件", "博客评论与附件"], ["profile_edit", "修改自己的个人资料", "账号与个人资料"]];
const DEFAULTS = {"guest": ["comments_read"], "user": ["comments_read", "comment", "comment_delete_own", "profile_edit", "upload"]};
// Five account levels. Existing `user` records remain ordinary accounts.
export const LEVELS = { guest: "游客", user: "普通", advanced: "高级", vip: "VIP", admin: "管理员" };
export const KEYS = CATALOG.map(([key]) => key);
export function isSuperAdmin(user) { return user?.role === "superadmin"; }
export function isAdminOrAbove(user) { return user?.role === "superadmin" || user?.role === "admin"; }
export function normalizeRole(role) { return Object.hasOwn(LEVELS, role) ? role : "guest"; }
export function upgradedRole(current, invited) {
  if (current === "superadmin") return "superadmin";
  const order = Object.keys(LEVELS);
  return order[Math.max(order.indexOf(normalizeRole(current)), order.indexOf(normalizeRole(invited)))];
}
export function defaults() {
  DEFAULTS.vip = [...DEFAULTS.user, "private_read", "private_export"];
  return Object.fromEntries(Object.keys(LEVELS).map(role => [role, role === "admin" ? [...KEYS] : [...(DEFAULTS[role] || DEFAULTS.user)]]));
}
export function validatePolicies(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("权限配置格式无效");
  const result = {};
  for (const role of Object.keys(LEVELS)) {
    if (role === "admin") { result.admin = [...KEYS]; continue; }
    const list = input[role];
    if (!Array.isArray(list) || list.some(key => typeof key !== "string" || !KEYS.includes(key))) throw new Error("权限配置包含无效等级或权限");
    if (!["vip", "admin"].includes(role) && list.some(key => ["private_read", "private_export"].includes(key))) throw new Error("隐秘文章仅能授权 VIP 和管理员");
    result[role] = [...new Set(list)];
  }
  return result;
}
async function ensureTable(env) {
  if (!env.DB) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS access_policies (scope TEXT PRIMARY KEY, policies_json TEXT NOT NULL)").run();
}
export async function loadPolicies(env) {
  if (!env.DB) return defaults();
  await ensureTable(env);
  const row = await env.DB.prepare("SELECT policies_json FROM access_policies WHERE scope = ?").bind(SCOPE).first();
  return row ? validatePolicies(JSON.parse(row.policies_json)) : defaults();
}
export async function savePolicies(env, input) {
  if (!env.DB) throw new Error("请先绑定 D1 数据库后保存权限");
  const policies = validatePolicies(input);
  await ensureTable(env);
  await env.DB.prepare("INSERT INTO access_policies (scope, policies_json) VALUES (?, ?) ON CONFLICT(scope) DO UPDATE SET policies_json = excluded.policies_json").bind(SCOPE, JSON.stringify(policies)).run();
  return policies;
}
export async function permissionsFor(env, user) {
  if (isAdminOrAbove(user)) return [...KEYS];
  const role = normalizeRole(user?.role), granted = (await loadPolicies(env))[role] || [];
  return ["vip", "admin"].includes(role) ? granted : granted.filter(key => !["private_read", "private_export"].includes(key));
}
export async function can(env, user, permission) { return (await permissionsFor(env, user)).includes(permission); }
