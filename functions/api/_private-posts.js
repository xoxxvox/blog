export async function ensurePrivatePosts(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS private_posts (id TEXT PRIMARY KEY,title TEXT NOT NULL,excerpt TEXT NOT NULL DEFAULT '',body TEXT NOT NULL,category TEXT NOT NULL DEFAULT '未分类',date TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS private_post_categories (name TEXT PRIMARY KEY)").run();
  await env.DB.prepare("INSERT OR IGNORE INTO private_post_categories(name) VALUES ('未分类')").run();
}
export async function postCategories(env) { return (await env.DB.prepare("SELECT name FROM private_post_categories ORDER BY CASE WHEN name='未分类' THEN 1 ELSE 0 END,name").all()).results.map(row => row.name); }
export function validCategory(name) { return typeof name === "string" && name.trim().length > 0 && name.trim().length <= 30 && !["all", "全部分类"].includes(name.trim()); }
