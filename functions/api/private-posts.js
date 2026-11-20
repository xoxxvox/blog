import { json, errorJson, getSessionUser } from "./_lib.js";
import { can, isSuperAdmin } from "./_permissions.js";
import { ensurePrivatePosts, postCategories } from "./_private-posts.js";
const noCache = { "Cache-Control": "private, no-store", Vary: "Cookie" };
export async function onRequestGet({ request, env }) {
  if (!env.DB) return errorJson("未绑定 D1 数据库", 500);
  const user = await getSessionUser(request, env);
  if (!user || !await can(env, user, "private_read")) return errorJson("隐秘空间仅限 VIP 及管理员阅读", 403);
  await ensurePrivatePosts(env); const url = new URL(request.url), id = url.searchParams.get("id");
  if (id) {
    const post = await env.DB.prepare("SELECT * FROM private_posts WHERE id = ?").bind(id).first();
    if (!post) return errorJson("文章不存在", 404);
    if (url.searchParams.get("download") === "1") {
      if (!await can(env, user, "private_export")) return errorJson("当前等级无权下载隐秘文章", 403);
      return new Response(`# ${post.title}\n\n${post.body}`, { headers: { ...noCache, "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="private-note.md"; filename*=UTF-8''${encodeURIComponent(post.title + ".md")}` } });
    }
    return json({ post }, 200, noCache);
  }
  const { results } = await env.DB.prepare("SELECT id,title,excerpt,category,date,LENGTH(body) AS word_count,updated_at FROM private_posts ORDER BY date DESC,updated_at DESC LIMIT 500").all();
  return json({ posts: results || [], categories: await postCategories(env) }, 200, noCache);
}
export async function onRequestPost({ request, env }) {
  if (!env.DB) return errorJson("未绑定 D1 数据库", 500);
  const user = await getSessionUser(request, env);
  if (!isSuperAdmin(user)) return errorJson("仅后台最高权限管理员可管理隐秘文章", 403);
  await ensurePrivatePosts(env);
  let body; try { body = await request.json(); } catch { return errorJson("请求格式无效", 400); }
  const id = String(body.id || crypto.randomUUID()).trim(), title = String(body.title || "").trim(), excerpt = String(body.excerpt || "").trim(), content = String(body.body || ""), category = String(body.category || "未分类").trim(), date = String(body.date || "");
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || !title || title.length > 160 || excerpt.length > 500 || !content.trim() || content.length > 200000 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || !(await postCategories(env)).includes(category)) return errorJson("请检查文章标题、正文、分类和日期", 400);
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO private_posts(id,title,excerpt,body,category,date,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,excerpt=excluded.excerpt,body=excluded.body,category=excluded.category,date=excluded.date,updated_at=excluded.updated_at").bind(id,title,excerpt,content,category,date,now,now).run();
  return json({ ok: true, post: await env.DB.prepare("SELECT * FROM private_posts WHERE id = ?").bind(id).first() }, 200, noCache);
}
export async function onRequestDelete({ request, env }) {
  if (!env.DB) return errorJson("未绑定 D1 数据库", 500);
  const user = await getSessionUser(request, env);
  if (!isSuperAdmin(user)) return errorJson("仅后台最高权限管理员可删除隐秘文章", 403);
  await ensurePrivatePosts(env); const id = new URL(request.url).searchParams.get("id");
  if (!id) return errorJson("缺少文章 ID", 400);
  await env.DB.prepare("DELETE FROM private_posts WHERE id = ?").bind(id).run();
  return json({ ok: true });
}
