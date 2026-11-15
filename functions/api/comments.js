import { json, errorJson, getSessionUser } from "./_lib.js";

export async function onRequestGet({ request, env }) {
  if (!env.DB) return errorJson("未绑定 D1 数据库", 500);
  const url = new URL(request.url);
  const postId = String(url.searchParams.get("postId") || "").trim();
  if (!postId) return errorJson("缺少 postId", 400);

  const { results } = await env.DB.prepare(
    "SELECT id, post_id, user_id, username, content, created_at FROM comments WHERE post_id = ? ORDER BY id DESC LIMIT 100"
  )
    .bind(postId)
    .all();

  return json({ comments: results || [] });
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return errorJson("未绑定 D1 数据库", 500);
  const user = await getSessionUser(request, env);
  if (!user) return errorJson("请先登录后再发表评论", 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return errorJson("请求格式无效", 400);
  }

  const postId = String(body.postId || "").trim();
  const content = String(body.content || "").trim();
  if (!postId) return errorJson("缺少 postId", 400);
  if (content.length < 1 || content.length > 1000) {
    return errorJson("评论内容需在 1 到 1000 字之间", 400);
  }

  const nowIso = new Date().toISOString();
  const res = await env.DB.prepare(
    "INSERT INTO comments (post_id, user_id, username, content, created_at) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(postId, user.id, user.username, content, nowIso)
    .run();

  return json(
    {
      comment: {
        id: res.meta?.last_row_id,
        post_id: postId,
        user_id: user.id,
        username: user.username,
        content,
        created_at: nowIso,
      },
    },
    201
  );
}

export async function onRequestDelete({ request, env }) {
  if (!env.DB) return errorJson("未绑定 D1 数据库", 500);
  const user = await getSessionUser(request, env);
  if (!user) return errorJson("请先登录", 401);

  const url = new URL(request.url);
  const id = Number(url.searchParams.get("id"));
  if (!id) return errorJson("缺少评论 id", 400);

  const comment = await env.DB.prepare(
    "SELECT id, user_id FROM comments WHERE id = ?"
  )
    .bind(id)
    .first();

  if (!comment) return errorJson("评论不存在", 404);
  if (user.role !== "admin" && comment.user_id !== user.id) {
    return errorJson("无权删除该评论", 403);
  }

  await env.DB.prepare("DELETE FROM comments WHERE id = ?").bind(id).run();
  return json({ ok: true });
}
