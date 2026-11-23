import { json, errorJson, getSessionUser } from "./_lib.js";
import { can, isSuperAdmin, isAdminOrAbove } from "./_permissions.js";
import { ensurePrivatePosts, postCategories, validCategory } from "./_private-posts.js";
export async function onRequestGet({ request, env }) {
  if (!env.DB) return errorJson("未绑定 D1 数据库", 500);
  const user=await getSessionUser(request,env); if(!user||!await can(env,user,"private_read")) return errorJson("无权读取历史分类",403);
  await ensurePrivatePosts(env);return json({categories:await postCategories(env)},200,{"Cache-Control":"private, no-store"});
}
export async function onRequestPost() { return errorJson("此设置已停用，历史数据保持不变", 410); }
