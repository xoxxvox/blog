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
  isAdminRequest,
  sessionCookieName,
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

async function ensureEmailVerificationsTable(env) {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS email_verifications (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, code TEXT NOT NULL, purpose TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)"
  ).run();
}

function generate6DigitCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(3));
  return String(((bytes[0] << 16) | (bytes[1] << 8) | bytes[2]) % 900000 + 100000);
}

async function sendResendEmail(env, to, subject, text) {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM) {
    return { configured: false, ok: false };
  }
  try {
    const mailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.RESEND_FROM,
        to: [to],
        subject,
        text,
      }),
    });
    return { configured: true, ok: mailRes.ok };
  } catch {
    return { configured: true, ok: false };
  }
}

async function findResetUser(env, username, email) {
  if (username) {
    const user = await env.DB.prepare(
      "SELECT id, username, email, role, invite_code FROM users WHERE LOWER(username) = LOWER(?) AND LOWER(email) = LOWER(?)"
    )
      .bind(username, email)
      .first();
    if (!user) return { error: errorJson("用户名与注册邮箱不匹配", 404) };
    return { user };
  }
  const { results } = await env.DB.prepare(
    "SELECT id, username, email, role, invite_code FROM users WHERE LOWER(email) = LOWER(?)"
  )
    .bind(email)
    .all();
  const rows = results || [];
  if (rows.length === 0) return { error: errorJson("未找到该邮箱对应的账号", 404) };
  if (rows.length > 1) return { error: errorJson("该邮箱绑定了多个账号，请同时填写用户名", 409) };
  return { user: rows[0] };
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
    return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie(sessionCookieName(request)) });
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
    if (!["admin", "superadmin"].includes(user.role) && user.disabled_at) {
      return errorJson("该账号关联的邀请码已过期或被删除，账号已失效（失效7天后自动注销）", 403);
    }
    if (isAdminRequest(request) && user.role !== "superadmin") {
      return errorJson("仅最高等级管理员账号允许登录独立后台", 403);
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
      { "Set-Cookie": buildSessionCookie(token, undefined, sessionCookieName(request)) }
    );
  }

  if (action === "send_register_code") {
    await ensureEmailVerificationsTable(env);
    const email = String(body.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return errorJson("请输入有效的邮箱地址", 400);
    }
    if (!env.RESEND_API_KEY || !env.RESEND_FROM) {
      return errorJson("尚未配置邮件发送服务（RESEND_API_KEY / RESEND_FROM），暂无法发送注册验证码", 503);
    }
    const nowSec = Math.floor(Date.now() / 1000);
    const recent = await env.DB.prepare(
      "SELECT created_at FROM email_verifications WHERE LOWER(email) = LOWER(?) AND purpose = 'register' AND created_at > ? ORDER BY id DESC LIMIT 1"
    )
      .bind(email, nowSec - 60)
      .first();
    if (recent) {
      const wait = Math.max(1, 60 - (nowSec - Number(recent.created_at)));
      return errorJson(`发送过于频繁，请 ${wait} 秒后再试`, 429);
    }

    const code = generate6DigitCode();
    const expiresAt = nowSec + 900;
    await env.DB.prepare("DELETE FROM email_verifications WHERE LOWER(email) = LOWER(?) AND purpose = 'register'")
      .bind(email)
      .run();
    await env.DB.prepare(
      "INSERT INTO email_verifications (email, code, purpose, created_at, expires_at) VALUES (?, ?, 'register', ?, ?)"
    )
      .bind(email, code, nowSec, expiresAt)
      .run();

    const mail = await sendResendEmail(
      env,
      email,
      "XXOXOVX Blog 注册邮箱验证码",
      `你的注册验证码为：${code}（15 分钟内有效）。如非本人操作请忽略。`
    );
    if (!mail.ok) {
      await env.DB.prepare("DELETE FROM email_verifications WHERE LOWER(email) = LOWER(?) AND purpose = 'register' AND code = ?")
        .bind(email, code)
        .run();
      return errorJson("验证码发送失败，请检查邮箱地址或稍后重试", 502);
    }
    return json({ ok: true, message: "验证码已发送至邮箱，15 分钟内有效" });
  }

  if (action === "register") {
    await ensureEmailVerificationsTable(env);
    const username = String(body.username || "").trim();
    const email = String(body.email || "").trim();
    const emailCode = String(body.emailCode || "").trim();
    const password = String(body.password || "");
    const inviteCode = String(body.inviteCode || "").trim();

    if (username.length < 2 || username.length > 24) {
      return errorJson("用户名长度需在 2 到 24 个字符之间", 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return errorJson("请输入有效的邮箱地址", 400);
    }
    if (!/^\d{6}$/.test(emailCode)) {
      return errorJson("请输入 6 位邮箱验证码", 400);
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

    const nowSec = Math.floor(Date.now() / 1000);
    const verifiedRow = await env.DB.prepare(
      "SELECT id FROM email_verifications WHERE LOWER(email) = LOWER(?) AND code = ? AND purpose = 'register' AND expires_at > ?"
    )
      .bind(email, emailCode, nowSec)
      .first();
    if (!verifiedRow) {
      return errorJson("邮箱验证码无效或已过期", 403);
    }

    const countRow = await env.DB.prepare("SELECT COUNT(*) AS cnt FROM users").first();
    const isFirstUser = Number(countRow?.cnt || 0) === 0;
    const bootstrapCode = String(env.ADMIN_INVITE_CODE || "").trim();

    let assignedRole = "user";
    let matchedInvite = null;

    if (inviteCode) {
      if (isFirstUser && bootstrapCode && inviteCode === bootstrapCode) {
        assignedRole = "superadmin";
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
    await env.DB.prepare("DELETE FROM email_verifications WHERE LOWER(email) = LOWER(?) AND purpose = 'register'")
      .bind(email)
      .run();
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
    if (sessionUser.role === "superadmin") return errorJson("最高等级账号无需兑换邀请码", 400);
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

  if (action === "list_sessions") {
    const sessionUser = await getSessionUser(request, env);
    if (!sessionUser || sessionUser.role !== "superadmin") {
      return errorJson("仅后台最高权限管理员可查看活跃会话", 403);
    }
    const nowSec = Math.floor(Date.now() / 1000);
    const { results } = await env.DB.prepare(
      `SELECT s.token, s.expires_at, u.username, u.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.expires_at > ?
       ORDER BY s.expires_at DESC
       LIMIT 100`
    )
      .bind(nowSec)
      .all();
    const sessions = (results || []).map((row) => ({
      id: `${String(row.token).slice(0, 8)}…`,
      username: row.username,
      role: row.role,
      isCurrent: row.token === sessionUser.sessionToken,
      expiresAt: new Date(Number(row.expires_at) * 1000).toISOString(),
    }));
    return json({ sessions });
  }

  if (action === "revoke_other_sessions") {
    const sessionUser = await getSessionUser(request, env);
    if (!sessionUser || sessionUser.role !== "superadmin") {
      return errorJson("仅后台最高权限管理员可注销会话", 403);
    }
    const res = await env.DB.prepare("DELETE FROM sessions WHERE token != ?")
      .bind(sessionUser.sessionToken)
      .run();
    return json({ ok: true, removed: Number(res.meta?.changes || 0) });
  }

  if (action === "change_password") {
    const sessionUser = await getSessionUser(request, env);
    if (!sessionUser) return errorJson("请先登录", 401);
    const currentPassword = String(body.currentPassword || "");
    const newPassword = String(body.newPassword || "");
    if (!currentPassword || newPassword.length < 6) {
      return errorJson("请输入当前密码，且新密码至少 6 位", 400);
    }
    const row = await env.DB.prepare("SELECT password_hash FROM users WHERE id = ?")
      .bind(sessionUser.id)
      .first();
    if (!row || !(await verifyPassword(currentPassword, row.password_hash))) {
      return errorJson("当前密码不正确", 403);
    }
    const nextHash = await hashPassword(newPassword);
    await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
      .bind(nextHash, sessionUser.id)
      .run();
    await env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND token != ?")
      .bind(sessionUser.id, sessionUser.sessionToken)
      .run();
    return json({ ok: true });
  }

  if (action === "request_password_reset") {
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS password_resets (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, code TEXT NOT NULL, expires_at INTEGER NOT NULL)"
    ).run();
    const username = String(body.username || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return errorJson("请输入有效的注册邮箱", 400);
    }
    const found = await findResetUser(env, username, email);
    if (found.error) return found.error;
    const user = found.user;

    const nowSec = Math.floor(Date.now() / 1000);
    const recent = await env.DB.prepare(
      "SELECT expires_at FROM password_resets WHERE user_id = ? AND expires_at > ? ORDER BY id DESC LIMIT 1"
    )
      .bind(user.id, nowSec + 840)
      .first();
    if (recent) {
      const wait = Math.max(1, Number(recent.expires_at) - (nowSec + 840));
      return errorJson(`发送过于频繁，请 ${wait} 秒后再试`, 429);
    }

    const code = generate6DigitCode();
    const expiresAt = nowSec + 900;
    await env.DB.prepare("DELETE FROM password_resets WHERE user_id = ?").bind(user.id).run();
    await env.DB.prepare("INSERT INTO password_resets (user_id, code, expires_at) VALUES (?, ?, ?)")
      .bind(user.id, code, expiresAt)
      .run();

    let delivered = false;
    const mail = await sendResendEmail(
      env,
      user.email,
      "XXOXOVX Blog 找回密码验证码",
      `账号 ${user.username} 的找回密码验证码为：${code}（15 分钟内有效）。如非本人操作请忽略。`
    );
    if (mail.configured) {
      delivered = mail.ok;
    } else if (["admin", "superadmin"].includes(user.role) && env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
      try {
        const tgRes = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: env.TELEGRAM_CHAT_ID,
            text: `【找回密码】账号 ${user.username} 验证码：${code}（15 分钟内有效）`,
          }),
        });
        delivered = tgRes.ok;
      } catch {}
    }

    return json({
      ok: true,
      delivered,
      username: user.username,
      hasInviteCode: Boolean(user.invite_code),
      message: delivered
        ? "验证码已发送到您的绑定邮箱，15 分钟内有效"
        : "未配置邮件发送服务；若账号绑定了邀请码，可直接填写原邀请码重置密码，或联系站长",
    });
  }

  if (action === "reset_password") {
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS password_resets (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, code TEXT NOT NULL, expires_at INTEGER NOT NULL)"
    ).run();
    const username = String(body.username || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const code = String(body.code || "").trim().toUpperCase();
    const newPassword = String(body.newPassword || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !code || newPassword.length < 6) {
      return errorJson("请完整填写注册邮箱、验证码/邀请码与至少 6 位新密码", 400);
    }
    const found = await findResetUser(env, username, email);
    if (found.error) return found.error;
    const user = found.user;

    const nowSec = Math.floor(Date.now() / 1000);
    const resetRow = await env.DB.prepare(
      "SELECT id FROM password_resets WHERE user_id = ? AND code = ? AND expires_at > ?"
    )
      .bind(user.id, code, nowSec)
      .first();
    const inviteMatched = Boolean(user.invite_code && user.invite_code.toUpperCase() === code);
    if (!resetRow && !inviteMatched) {
      return errorJson("验证码已过期或邀请码不匹配", 403);
    }

    const nextHash = await hashPassword(newPassword);
    await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
      .bind(nextHash, user.id)
      .run();
    await env.DB.prepare("DELETE FROM password_resets WHERE user_id = ?").bind(user.id).run();
    await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id).run();
    return json({ ok: true, username: user.username });
  }

  return errorJson("不支持的操作类型", 400);
}
