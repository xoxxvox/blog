// Three fixed tiers. Existing elevated member accounts remain normal signed-in users.
export const SCOPE = "blog";
export const LEVELS = { guest: '游客', user: '登录用户', admin: '管理员' };
export const CATALOG = [["read", "查看普通文章", "文章阅读"], ["like", "点赞文章", "文章互动"], ["bookmark", "收藏文章", "文章互动"], ["share", "分享文章", "文章互动"], ["comment_delete_own", "删除自己的评论", "博客评论与附件"], ["comments_read", "查看评论", "博客评论与附件"], ["comment", "发表评论和回复", "博客评论与附件"], ["upload", "上传博客附件", "博客评论与附件"], ["profile_edit", "修改自己的个人资料", "账号与个人资料"]];
export const KEYS = CATALOG.map(([key]) => key);
export function isSuperAdmin(user) { return ['admin','superadmin'].includes(user?.role); }
export function isAdminOrAbove(user) { return isSuperAdmin(user); }
export function normalizeRole(role) {
 if (['admin','superadmin'].includes(role)) return 'admin';
 return ['guest','user','advanced','vip'].includes(role) ? 'user' : 'guest';
}
export function upgradedRole(current, invited) { return normalizeRole(current) === 'admin' || normalizeRole(invited) === 'admin' ? 'admin' : 'user'; }
export function defaults() { return { guest: ["read", "comments_read"], user: ["read", "like", "bookmark", "share", "comments_read", "comment", "comment_delete_own", "profile_edit", "upload"], admin: [...KEYS] }; }
export function validatePolicies(input) {
 if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('权限配置格式无效');
 for (const role of Object.keys(LEVELS)) if (!Array.isArray(input[role]) || input[role].some(key => !KEYS.includes(key))) throw new Error('权限配置包含无效等级或权限');
 return defaults();
}
export async function loadPolicies() { return defaults(); }
export async function savePolicies() { throw new Error('三档权限由系统固定，无需单独配置'); }
export async function permissionsFor(env, user) { return defaults()[user ? normalizeRole(user.role) : 'guest']; }
export async function can(env, user, permission) { return (await permissionsFor(env, user)).includes(permission); }
