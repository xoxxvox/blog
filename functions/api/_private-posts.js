export async function ensurePrivatePosts(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS private_posts (id TEXT PRIMARY KEY,title TEXT NOT NULL,excerpt TEXT NOT NULL DEFAULT '',body TEXT NOT NULL,category TEXT NOT NULL DEFAULT '未分类',date TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS private_post_categories (name TEXT PRIMARY KEY, sort_order INTEGER NOT NULL DEFAULT 0)").run();
  try {
    await env.DB.prepare("ALTER TABLE private_post_categories ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0").run();
  } catch {}
  await env.DB.prepare("INSERT INTO private_post_categories(name, sort_order) SELECT '未分类', 0 WHERE NOT EXISTS (SELECT 1 FROM private_post_categories)").run();
}
export async function postCategories(env) {
  const list = (await env.DB.prepare("SELECT name FROM private_post_categories WHERE name != '最新动态' ORDER BY sort_order ASC, rowid ASC").all()).results.map(row => row.name);
  return list.length ? list : ["未分类"];
}
export function validCategory(name) { return typeof name === "string" && name.trim().length > 0 && name.trim().length <= 30 && !["all", "全部分类", "最新动态"].includes(name.trim()); }
