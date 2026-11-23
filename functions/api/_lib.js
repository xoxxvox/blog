import { normalizeRole } from './_permissions.js';
const SESSION_COOKIE = "blog_session";
const ADMIN_SESSION_COOKIE = "blog_admin_session";
const SESSION_TTL_SEC = 60 * 60 * 24 * 7; // 7 days

export function isAdminRequest(request) {
  return request?.headers?.get("X-Admin-Session") === "1";
}

export function sessionCookieName(request) {
  return isAdminRequest(request) ? ADMIN_SESSION_COOKIE : SESSION_COOKIE;
}

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

export function errorJson(message, status = 400) {
  return json({ error: message }, status);
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    key,
    256
  );
  return `${toHex(salt)}:${toHex(derived)}`;
}

export async function verifyPassword(password, stored) {
  const [saltHex, hashHex] = String(stored || "").split(":");
  if (!saltHex || !hashHex) return false;
  const salt = fromHex(saltHex);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    key,
    256
  );
  return toHex(derived) === hashHex;
}

export function parseCookies(request) {
  const raw = request.headers.get("Cookie") || "";
  const map = {};
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      map[k] = decodeURIComponent(v);
    }
  }
  return map;
}

export function buildSessionCookie(token, maxAge = SESSION_TTL_SEC, cookieName = SESSION_COOKIE) {
  return `${cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=${maxAge}`;
}

export function clearSessionCookie(cookieName = SESSION_COOKIE) {
  return `${cookieName}=; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=0`;
}

export async function createSession(env, userId) {
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = toHex(tokenBytes);
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
  await env.DB.prepare(
    "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)"
  )
    .bind(token, userId, expiresAt)
    .run();
  return token;
}

export async function ensureLifecycleSchema(env) {
  if (!env.DB) return;
  const alterStmts = [
    "ALTER TABLE invites ADD COLUMN duration_days INTEGER",
    "ALTER TABLE invites ADD COLUMN expires_at TEXT",
    "ALTER TABLE users ADD COLUMN invite_code TEXT",
    "ALTER TABLE users ADD COLUMN disabled_at TEXT",
    "CREATE TABLE IF NOT EXISTS schema_migrations (key TEXT PRIMARY KEY)",
  ];
  for (const sql of alterStmts) {
    try {
      await env.DB.prepare(sql).run();
    } catch {}
  }
  try {
    const migrated = await env.DB.prepare(
      "SELECT 1 FROM schema_migrations WHERE key = 'promote_existing_admin_to_superadmin'"
    ).first();
    if (!migrated) {
      await env.DB.prepare("UPDATE users SET role = 'superadmin' WHERE role = 'admin'").run();
      await env.DB.prepare(
        "INSERT OR IGNORE INTO schema_migrations (key) VALUES ('promote_existing_admin_to_superadmin')"
      ).run();
    }
  } catch {}
}

export async function cleanupExpiredAccounts(env) {
  if (!env.DB) return;
  await ensureLifecycleSchema(env);
  const nowIso = new Date().toISOString();
  const deleteCutoffIso = new Date(Date.now() - 7 * 86400000).toISOString();

  await env.DB.prepare(
    `UPDATE users
     SET disabled_at = COALESCE(disabled_at, ?)
     WHERE role NOT IN ('admin', 'superadmin')
       AND invite_code IS NOT NULL
       AND invite_code != ''
       AND (
         invite_code NOT IN (SELECT code FROM invites)
         OR invite_code IN (SELECT code FROM invites WHERE expires_at IS NOT NULL AND expires_at <= ?)
       )`
  )
    .bind(nowIso, nowIso)
    .run();

  await env.DB.prepare(
    "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role NOT IN ('admin', 'superadmin') AND disabled_at IS NOT NULL)"
  ).run();

  await env.DB.prepare(
    "DELETE FROM users WHERE role NOT IN ('admin', 'superadmin') AND disabled_at IS NOT NULL AND disabled_at <= ?"
  )
    .bind(deleteCutoffIso)
    .run();
}

export async function getSessionUser(request, env) {
  if (!env.DB) return null;
  await cleanupExpiredAccounts(env);
  const cookies = parseCookies(request);
  const token = cookies[sessionCookieName(request)];
  if (!token) return null;
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(
    `SELECT u.id, u.username, u.email, u.role
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > ? AND (u.role IN ('admin', 'superadmin') OR u.disabled_at IS NULL)`
  )
    .bind(token, now)
    .first();
  if (!row) return null;
  if (isAdminRequest(request) && !["admin","superadmin"].includes(row.role)) return null;
  return { ...row, role: normalizeRole(row.role), sessionToken: token };
}

export function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function base64ToBytes(b64) {
  const clean = b64.replace(/\s+/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function requireGitHubEnv(env) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_OWNER || !env.GITHUB_REPO) {
    throw new Error("未配置 GitHub 环境变量（GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO）");
  }
}

export async function githubFetch(env, apiPath, init = {}) {
  requireGitHubEnv(env);
  const url = `https://api.github.com${apiPath}`;
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "xxoxovx-blog-pages",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers || {}),
    },
  });
}

export async function githubGetFile(env, filePath) {
  const branch = env.GITHUB_BRANCH || "main";
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  const res = await githubFetch(
    env,
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub 读取失败 (${res.status}): ${err}`);
  }
  const data = await res.json();
  const bytes = base64ToBytes(data.content || "");
  return {
    sha: data.sha,
    bytes,
    text: new TextDecoder().decode(bytes),
  };
}

export async function githubPutFile(env, filePath, content, message, isBinary = false) {
  const branch = env.GITHUB_BRANCH || "main";
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  const existing = await githubGetFile(env, filePath).catch(() => null);

  const bytes = isBinary
    ? content
    : new TextEncoder().encode(typeof content === "string" ? content : JSON.stringify(content, null, 2));

  const body = {
    message,
    content: bytesToBase64(bytes),
    branch,
  };
  if (existing && existing.sha) {
    body.sha = existing.sha;
  }

  const res = await githubFetch(
    env,
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${encodedPath}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub 写入失败 (${res.status}): ${err}`);
  }
  return res.json();
}

export async function githubDeleteFile(env, filePath, message) {
  const branch = env.GITHUB_BRANCH || "main";
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  const existing = await githubGetFile(env, filePath).catch(() => null);
  if (!existing || !existing.sha) return null;

  const res = await githubFetch(
    env,
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${encodedPath}`,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        sha: existing.sha,
        branch,
      }),
    }
  );
  if (!res.ok && res.status !== 404) {
    const err = await res.text();
    throw new Error(`GitHub 删除失败 (${res.status}): ${err}`);
  }
  return true;
}
