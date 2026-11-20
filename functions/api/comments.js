import { can, isAdminOrAbove } from "./_permissions.js";
import { json, errorJson, getSessionUser } from "./_lib.js";

export async function onRequestGet({ request, env }) {
  if (!env.DB) return errorJson("未绑定 D1 数据库", 500);
  if (!await can(env, await getSessionUser(request, env), "comments_read")) return errorJson("当前等级无权查看评论", 403);
  const url = new URL(request.url);
  const postId = String(url.searchParams.get("postId") || "").trim();
  if (!postId) return errorJson("缺少 postId", 400);

  let results = [];
  try {
    const res = await env.DB.prepare(
      `SELECT c.id, c.post_id, c.user_id, c.username, c.content, c.created_at,
              u.role AS author_role, u.profile_json AS author_profile_json
       FROM comments c
       LEFT JOIN users u ON c.user_id = u.id
       WHERE c.post_id = ?
       ORDER BY c.id DESC
       LIMIT 100`
    )
      .bind(postId)
      .all();
    results = res.results || [];
  } catch {
    const res = await env.DB.prepare(
      `SELECT c.id, c.post_id, c.user_id, c.username, c.content, c.created_at,
              u.role AS author_role
       FROM comments c
       LEFT JOIN users u ON c.user_id = u.id
       WHERE c.post_id = ?
       ORDER BY c.id DESC
       LIMIT 100`
    )
      .bind(postId)
      .all();
    results = res.results || [];
  }

  const comments = results.map((row) => {
    let authorProfile = null;
    if (row.author_profile_json) {
      try {
        authorProfile = JSON.parse(row.author_profile_json);
      } catch {
        authorProfile = null;
      }
    }
    return {
      id: row.id,
      post_id: row.post_id,
      user_id: row.user_id,
      username: row.username,
      content: row.content,
      created_at: row.created_at,
      author_role: row.author_role || "user",
      author_profile: authorProfile,
    };
  });

  return json({ comments });
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return errorJson("未绑定 D1 数据库", 500);
  const user = await getSessionUser(request, env);
  if (!user) return errorJson("请先登录后再发表评论", 401);
  if (!await can(env, user, "comment")) return errorJson("当前等级无权发表评论", 403);

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

  let authorProfile = null;
  try {
    const userRow = await env.DB.prepare("SELECT profile_json FROM users WHERE id = ?").bind(user.id).first();
    if (userRow?.profile_json) authorProfile = JSON.parse(userRow.profile_json);
  } catch {}

  return json(
    {
      comment: {
        id: res.meta?.last_row_id,
        post_id: postId,
        user_id: user.id,
        username: user.username,
        content,
        created_at: nowIso,
        author_role: user.role || "user",
        author_profile: authorProfile,
      },
    },
    201
  );
}

export async function onRequestDelete({ request, env }) {
  if (!env.DB) return errorJson("未绑定 D1 数据库", 500);
  const user = await getSessionUser(request, env);
  if (!user) return errorJson("请先登录", 401);

  if (!await can(env, user, "comment_delete_own")) return errorJson("当前等级无权删除评论", 403);
  const url = new URL(request.url);
  const id = Number(url.searchParams.get("id"));
  if (!id) return errorJson("缺少评论 id", 400);

  const comment = await env.DB.prepare(
    "SELECT id, user_id FROM comments WHERE id = ?"
  )
    .bind(id)
    .first();

  if (!comment) return errorJson("评论不存在", 404);
  if (!isAdminOrAbove(user) && comment.user_id !== user.id) {
    return errorJson("无权删除该评论", 403);
  }

  await env.DB.prepare("DELETE FROM comments WHERE id = ?").bind(id).run();
  return json({ ok: true });
}
