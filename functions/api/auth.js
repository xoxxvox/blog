import { normalizeRole, upgradedRole, can } from "./_permissions.js";
import {
  json,
  errorJson,
  hashPassword,
  verifyPassword,
  createSession,
  getSessionUser,
  buildSessionCookie,
  clearSessionCookie,
  cleanupExpiredAccounts,
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
  if (!user) return json({ user: null }, 200, { "Cache-Control": "no-store" });
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
  }, 200, { "Cache-Control": "no-store" });
}

function generateRandomAvatar(seed) {
  const palettes = [
    ["#34d399", "#059669"],
    ["#60a5fa", "#2563eb"],
    ["#a78bfa", "#7c3aed"],
    ["#f472b6", "#db2777"],
    ["#fbbf24", "#d97706"],
    ["#2dd4bf", "#0d9488"],
    ["#fb7185", "#e11d48"],
    ["#818cf8", "#4f46e5"],
    ["#38bdf8", "#0284c7"],
    ["#c084fc", "#9333ea"],
  ];
  const idx = Math.floor(Math.random() * palettes.length);
  const pattern = Math.floor(Math.random() * 3);
  const [c1, c2] = palettes[idx];
  const ch = (String(seed || "?").trim()[0] || "?").toUpperCase();
  const safeCh = ch.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const decor =
    pattern === 0
      ? `<circle cx='60' cy='20' r='18' fill='rgba(255,255,255,0.16)'/><circle cx='18' cy='66' r='12' fill='rgba(255,255,255,0.10)'/>`
      : pattern === 1
      ? `<rect x='46' y='-6' width='36' height='36' rx='10' transform='rotate(24 64 12)' fill='rgba(255,255,255,0.15)'/><circle cx='16' cy='62' r='10' fill='rgba(255,255,255,0.10)'/>`
      : `<circle cx='40' cy='40' r='34' fill='none' stroke='rgba(255,255,255,0.16)' stroke-width='2' stroke-dasharray='6 6'/><circle cx='62' cy='22' r='12' fill='rgba(255,255,255,0.14)'/>`;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='${c1}'/><stop offset='100%' stop-color='${c2}'/></linearGradient></defs><rect width='80' height='80' rx='40' fill='url(#g)'/>${decor}<text x='50%' y='53%' dominant-baseline='middle' text-anchor='middle' font-family='system-ui,-apple-system,sans-serif' font-size='34' font-weight='600' fill='#ffffff'>${safeCh}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
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
    await cleanupExpiredAccounts(env);
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    if (!username || !password) {
      return errorJson("请输入用户名和密码", 400);
    }

    const user = await env.DB.prepare(
      "SELECT id, username, email, password_hash, role, profile_json, disabled_at FROM users WHERE LOWER(username) = LOWER(?)"
    )
      .bind(username)
      .first();

    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return errorJson("用户名或密码错误", 401);
    }
    if (user.role !== "admin" && user.disabled_at) {
      return errorJson("该账号关联的邀请码已过期或被删除，账号已失效（失效7天后自动注销）", 403);
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

    if (inviteCode) {
      if (isFirstUser && bootstrapCode && inviteCode === bootstrapCode) {
        assignedRole = "admin";
      } else {
        matchedInvite = await env.DB.prepare(
          "SELECT code, role, expires_at, used_by FROM invites WHERE code = ?"
        )
          .bind(inviteCode.toUpperCase())
          .first();

        if (!matchedInvite) {
          return errorJson("邀请码无效", 403);
        }
        if (matchedInvite.used_by) {
          return errorJson("该邀请码已被使用", 403);
        }
        if (matchedInvite.expires_at && Date.parse(matchedInvite.expires_at) <= Date.now()) {
          return errorJson("该邀请码已过期", 403);
        }
        assignedRole = normalizeRole(matchedInvite.role);
      }
    }

    const nowIso = new Date().toISOString();
    const passwordHash = await hashPassword(password);
    const initialProfile = {
      avatar: generateRandomAvatar(username),
      profileName: username,
      tags: [],
      info: {
        name: "",
        gender: "",
        age: "",
        hobby: "",
        city: "",
        qq: "",
        wechat: "",
        email: "",
        extraInfo: [],
      },
      contacts: [],
    };

    if (matchedInvite) {
      const claim = await env.DB.prepare("UPDATE invites SET used_by = ?, used_at = ? WHERE code = ? AND used_by IS NULL AND (expires_at IS NULL OR expires_at > ?)").bind(username, nowIso, matchedInvite.code, nowIso).run();
      if (!claim.meta?.changes) return errorJson("邀请码已被使用或已到期", 409);
    }
    let insertRes;
    try {
      insertRes = await env.DB.prepare(
      "INSERT INTO users (username, email, password_hash, role, invite_code, profile_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(username, email, passwordHash, assignedRole, matchedInvite ? matchedInvite.code : null, JSON.stringify(initialProfile), nowIso)
      .run();
    } catch (error) {
      if (matchedInvite) await env.DB.prepare("UPDATE invites SET used_by = NULL, used_at = NULL WHERE code = ? AND used_by = ? AND used_at = ?").bind(matchedInvite.code, username, nowIso).run();
      throw error;
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
          profile: initialProfile,
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
    if (!await can(env, sessionUser, "profile_edit")) return errorJson("当前等级无权修改个人资料", 403);
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
        hobby: String(body.profile.info?.hobby || "").trim(),
        city: String(body.profile.info?.city || "").trim(),
        qq: String(body.profile.info?.qq || "").trim(),
        wechat: String(body.profile.info?.wechat || "").trim(),
        email: String(body.profile.info?.email || "").trim(),
        extraInfo: Array.isArray(body.profile.info?.extraInfo)
          ? body.profile.info.extraInfo
              .map((item) => ({
                label: String(item?.label || "").trim(),
                value: String(item?.value || "").trim(),
              }))
              .filter((item) => item.label && item.value)
              .slice(0, 12)
          : [],
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

  if (action === "redeem_invite") {
    const sessionUser = await getSessionUser(request, env);
    if (!sessionUser) return errorJson("请先登录", 401);
    const inviteCode = String(body.inviteCode || "").trim().toUpperCase();
    if (!inviteCode) return errorJson("请输入邀请码", 400);

    const matchedInvite = await env.DB.prepare(
      "SELECT code, role, expires_at, used_by FROM invites WHERE code = ?"
    )
      .bind(inviteCode)
      .first();

    if (!matchedInvite) return errorJson("邀请码无效", 403);
    if (matchedInvite.used_by && matchedInvite.used_by !== sessionUser.username) {
      return errorJson("该邀请码已被其他用户使用", 403);
    }
    if (matchedInvite.expires_at && Date.parse(matchedInvite.expires_at) <= Date.now()) {
      return errorJson("该邀请码已过期", 403);
    }

    const nowIso = new Date().toISOString();
    const nextRole = upgradedRole(sessionUser.role, matchedInvite.role);
    if (normalizeRole(matchedInvite.role) !== nextRole) return errorJson("不能使用低于当前账号等级的邀请码续期或降级", 400);
    const claim = await env.DB.prepare("UPDATE invites SET used_by = ?, used_at = ? WHERE code = ? AND (used_by IS NULL OR used_by = ?) AND (expires_at IS NULL OR expires_at > ?)").bind(sessionUser.username, nowIso, matchedInvite.code, sessionUser.username, nowIso).run();
    if (!claim.meta?.changes) return errorJson("邀请码已被使用或已到期", 409);
    await env.DB.prepare("UPDATE users SET role = ?, invite_code = ?, disabled_at = NULL WHERE id = ?")
      .bind(nextRole, matchedInvite.code, sessionUser.id)
      .run();

    const row = await env.DB.prepare("SELECT profile_json FROM users WHERE id = ?").bind(sessionUser.id).first();
    return json({
      ok: true,
      user: {
        id: sessionUser.id,
        username: sessionUser.username,
        email: sessionUser.email,
        role: nextRole,
        invite_code: matchedInvite.code,
        profile: parseUserProfile(row?.profile_json),
      },
    });
  }

  return errorJson("不支持的操作类型", 400);
}
