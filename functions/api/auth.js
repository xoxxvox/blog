import {
  json,
  errorJson,
  hashPassword,
  verifyPassword,
  createSession,
  getSessionUser,
  buildSessionCookie,
  clearSessionCookie,
} from "./_lib.js";

async function ensureProfileColumn(env) {
  try {
    await env.DB.prepare("SELECT profile_json FROM users LIMIT 1").first();
  } catch {
    try {
      await env.DB.prepare("ALTER TABLE users ADD COLUMN profile_json TEXT").run();
    } catch {}
  }
}

function parseUserProfile(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) {
    return errorJson("尚未绑定 D1 数据库（变量名需为 DB）", 500);
  }
  await ensureProfileColumn(env);
  const user = await getSessionUser(request, env);
  if (!user) return json({ user: null });
  const row = await env.DB.prepare("SELECT profile_json FROM users WHERE id = ?")
    .bind(user.id)
    .first();
  return json({
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      profile: parseUserProfile(row?.profile_json),
    },
  });
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) {
    return errorJson("尚未绑定 D1 数据库（变量名需为 DB）", 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorJson("请求格式无效", 400);
  }

  const action = body.action;

  if (action === "logout") {
    const user = await getSessionUser(request, env);
    if (user?.sessionToken) {
      await env.DB.prepare("DELETE FROM sessions WHERE token = ?")
        .bind(user.sessionToken)
        .run();
    }
    return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
  }

  if (action === "login") {
    await ensureProfileColumn(env);
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    if (!username || !password) {
      return errorJson("请输入用户名和密码", 400);
    }

    const user = await env.DB.prepare(
      "SELECT id, username, email, password_hash, role, profile_json FROM users WHERE LOWER(username) = LOWER(?)"
    )
      .bind(username)
      .first();

    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return errorJson("用户名或密码错误", 401);
    }

    const token = await createSession(env, user.id);
    return json(
      {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          profile: parseUserProfile(user.profile_json),
        },
      },
      200,
      { "Set-Cookie": buildSessionCookie(token) }
    );
  }

  if (action === "register") {
    const username = String(body.username || "").trim();
    const email = String(body.email || "").trim();
    const password = String(body.password || "");
    const inviteCode = String(body.inviteCode || "").trim();

    if (username.length < 2 || username.length > 24) {
      return errorJson("用户名长度需在 2 到 24 个字符之间", 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return errorJson("请输入有效的邮箱地址", 400);
    }
    if (password.length < 6) {
      return errorJson("密码长度至少 6 位", 400);
    }
    if (!inviteCode) {
      return errorJson("请输入邀请码", 400);
    }

    const dup = await env.DB.prepare(
      "SELECT id FROM users WHERE LOWER(username) = LOWER(?)"
    )
      .bind(username)
      .first();
    if (dup) {
      return errorJson("该用户名已被注册", 409);
    }

    const countRow = await env.DB.prepare("SELECT COUNT(*) AS cnt FROM users").first();
    const isFirstUser = Number(countRow?.cnt || 0) === 0;
    const bootstrapCode = String(env.ADMIN_INVITE_CODE || "").trim();

    let assignedRole = "user";
    let matchedInvite = null;

    if (isFirstUser && bootstrapCode && inviteCode === bootstrapCode) {
      assignedRole = "admin";
    } else {
      matchedInvite = await env.DB.prepare(
        "SELECT code, role, used_by FROM invites WHERE code = ?"
      )
        .bind(inviteCode)
        .first();

      if (!matchedInvite) {
        return errorJson("邀请码无效", 403);
      }
      if (matchedInvite.used_by) {
        return errorJson("该邀请码已被使用", 403);
      }
      assignedRole = matchedInvite.role === "admin" ? "admin" : "user";
    }

    const nowIso = new Date().toISOString();
    const passwordHash = await hashPassword(password);

    const insertRes = await env.DB.prepare(
      "INSERT INTO users (username, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(username, email, passwordHash, assignedRole, nowIso)
      .run();

    if (matchedInvite) {
      await env.DB.prepare(
        "UPDATE invites SET used_by = ?, used_at = ? WHERE code = ?"
      )
        .bind(username, nowIso, matchedInvite.code)
        .run();
    }

    const newUserId = insertRes.meta?.last_row_id;
    const token = await createSession(env, newUserId);

    return json(
      {
        user: {
          id: newUserId,
          username,
          email,
          role: assignedRole,
        },
      },
      201,
      { "Set-Cookie": buildSessionCookie(token) }
    );
  }

  if (action === "update_profile") {
    await ensureProfileColumn(env);
    const sessionUser = await getSessionUser(request, env);
    if (!sessionUser) return errorJson("请先登录", 401);
    if (!body.profile || typeof body.profile !== "object") {
      return errorJson("个人资料格式无效", 400);
    }
    const cleanProfile = {
      avatar: String(body.profile.avatar || "").trim(),
      profileName: String(body.profile.profileName || sessionUser.username).trim(),
      tags: Array.isArray(body.profile.tags)
        ? body.profile.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 8)
        : [],
      info: {
        name: String(body.profile.info?.name || "").trim(),
        gender: String(body.profile.info?.gender || "").trim(),
        age: String(body.profile.info?.age || "").trim(),
      },
      contacts: Array.isArray(body.profile.contacts) ? body.profile.contacts : [],
    };
    await env.DB.prepare("UPDATE users SET profile_json = ? WHERE id = ?")
      .bind(JSON.stringify(cleanProfile), sessionUser.id)
      .run();
    return json({
      ok: true,
      user: {
        id: sessionUser.id,
        username: sessionUser.username,
        email: sessionUser.email,
        role: sessionUser.role,
        profile: cleanProfile,
      },
    });
  }

  return errorJson("不支持的操作类型", 400);
}
