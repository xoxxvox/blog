import { json, errorJson, getSessionUser } from "./_lib.js";
import { can, isSuperAdmin, isAdminOrAbove } from "./_permissions.js";
import { ensurePrivatePosts, postCategories } from "./_private-posts.js";
const noCache = { "Cache-Control": "private, no-store", Vary: "Cookie" };
export async function onRequestGet({ request, env }) {
  if (!env.DB) return errorJson("未绑定 D1 数据库", 500);
  const user = await getSessionUser(request, env);
  if (!user || !isAdminOrAbove(user)) return errorJson("历史归档仅限管理员阅读", 403);
  await ensurePrivatePosts(env); const url = new URL(request.url), id = url.searchParams.get("id");
  if (id) {
    const post = await env.DB.prepare("SELECT * FROM private_posts WHERE id = ?").bind(id).first();
    if (!post) return errorJson("文章不存在", 404);
    if (url.searchParams.get("download") === "1") {
      if (!isAdminOrAbove(user)) return errorJson("当前等级无权下载隐秘文章", 403);
      return new Response(`# ${post.title}\n\n${post.body}`, { headers: { ...noCache, "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="private-note.md"; filename*=UTF-8''${encodeURIComponent(post.title + ".md")}` } });
    }
    return json({ post }, 200, noCache);
  }
  const { results } = await env.DB.prepare("SELECT id,title,excerpt,category,date,LENGTH(body) AS word_count,updated_at FROM private_posts ORDER BY date DESC,updated_at DESC LIMIT 500").all();
  return json({ posts: results || [], categories: await postCategories(env) }, 200, noCache);
}
export async function onRequestPost() { return errorJson("历史归档仅供查看，已停用新增和编辑", 410); }
export async function onRequestDelete() { return errorJson("历史归档保留，已停用删除", 410); }
