-- Cloudflare D1 数据库初始化脚本
-- 在 Cloudflare D1 Console 中直接复制执行即可

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  profile_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'user',
  created_by TEXT NOT NULL,
  used_by TEXT,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments(post_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- Five-level permissions are stored separately for blog and imghub.
CREATE TABLE IF NOT EXISTS access_policies (
  scope TEXT PRIMARY KEY,
  policies_json TEXT NOT NULL
);

-- Private articles are deliberately separate from public GitHub content.
CREATE TABLE IF NOT EXISTS private_posts (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, excerpt TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL, category TEXT NOT NULL DEFAULT '未分类', date TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS private_post_categories (name TEXT PRIMARY KEY);
INSERT OR IGNORE INTO private_post_categories(name) VALUES ('未分类');

CREATE TABLE IF NOT EXISTS private_bio (id INTEGER PRIMARY KEY CHECK(id=1), bio_json TEXT NOT NULL);
