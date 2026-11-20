import { isSuperAdmin } from "./_permissions.js";
import { json, errorJson, getSessionUser, githubGetFile, githubPutFile, githubDeleteFile } from "./_lib.js";

const POSTS_PATH = "data/posts.json";
const PROFILE_PATH = "data/profile.json";
const CATEGORY_ALIAS = {
  "网络自动化": "科学网络",
  "软件推荐": "小众软件",
  "网站推荐": "网站优选",
};

function normalizeCategory(category) {
  const raw = String(category || "").trim();
  return CATEGORY_ALIAS[raw] || raw || "技术手记";
}

function getPostMarkdownPath(post) {
  const cat = normalizeCategory(post?.category).replace(/[\\/:*?"<>|]/g, "-");
  const safeId = String(post?.id || "untitled").replace(/[^a-zA-Z0-9_-]/g, "-");
  return `data/posts/${cat}/${safeId}.md`;
}

function formatPostMarkdown(post) {
  const esc = (v) => JSON.stringify(String(v ?? ""));
  const lines = [
    "---",
    `id: ${esc(post.id || "")}`,
    `title: ${esc(post.title || "")}`,
    `category: ${esc(normalizeCategory(post.category))}`,
    `date: ${esc(post.date || "")}`,
    `readTime: ${esc(post.readTime || "")}`,
    `featured: ${Boolean(post.featured)}`,
    `excerpt: ${esc(post.excerpt || "")}`,
    "---",
    "",
    String(post.body || ""),
    "",
  ];
  return lines.join("\n");
}

export async function onRequestGet({ request, env }) {
  async function readContent(path) {
    try {
      const file = await githubGetFile(env, path);
      if (file) return { value: JSON.parse(file.text), live: true };
    } catch {}
    try {
      const response = await env.ASSETS.fetch(new URL(`/${path}`, request.url));
      if (response.ok) return { value: await response.json(), live: false };
    } catch {}
    return { value: null, live: false };
  }
  const [posts, profile] = await Promise.all([readContent(POSTS_PATH), readContent(PROFILE_PATH)]);
  return json({ posts: posts.value, profile: profile.value, source: posts.live && profile.live ? "github" : "fallback" });
}

export async function onRequestPost({ request, env }) {
  const user = await getSessionUser(request, env);
  if (!user) return errorJson("请先登录", 401);
  if (!isSuperAdmin(user)) return errorJson("仅后台最高权限管理员可执行此操作", 403);

  let body;
  try {
    body = await request.json();
  } catch {
    return errorJson("请求格式无效", 400);
  }

  try {
    if (body.type === "posts") {
      if (!Array.isArray(body.posts)) {
        return errorJson("posts 必须是数组", 400);
      }
      const nextPosts = body.posts.map((p) => ({
        ...p,
        category: normalizeCategory(p.category),
      }));

      let prevPosts = [];
      try {
        const prevFile = await githubGetFile(env, POSTS_PATH);
        if (prevFile?.text) {
          const parsed = JSON.parse(prevFile.text);
          if (Array.isArray(parsed)) prevPosts = parsed;
        }
      } catch {}

      await githubPutFile(
        env,
        POSTS_PATH,
        JSON.stringify(nextPosts, null, 2),
        `chore(blog): update posts by ${user.username}`
      );

      const prevMap = new Map(prevPosts.map((p) => [getPostMarkdownPath(p), p]));
      const nextPaths = new Set();

      for (const post of nextPosts) {
        const mdPath = getPostMarkdownPath(post);
        nextPaths.add(mdPath);
        const mdText = formatPostMarkdown(post);
        const prevPost = prevMap.get(mdPath);
        if (!prevPost || formatPostMarkdown(prevPost) !== mdText) {
          await githubPutFile(
            env,
            mdPath,
            mdText,
            `docs(${normalizeCategory(post.category)}): update ${post.id || "post"} by ${user.username}`
          );
        }
      }

      for (const oldPath of prevMap.keys()) {
        if (!nextPaths.has(oldPath)) {
          await githubDeleteFile(
            env,
            oldPath,
            `docs(blog): remove ${oldPath} by ${user.username}`
          );
        }
      }

      return json({ ok: true, posts: nextPosts });
    }

    if (body.type === "profile") {
      if (!body.profile || typeof body.profile !== "object") {
        return errorJson("profile 数据无效", 400);
      }
      await githubPutFile(
        env,
        PROFILE_PATH,
        JSON.stringify(body.profile, null, 2),
        `chore(blog): update profile by ${user.username}`
      );
      return json({ ok: true, profile: body.profile });
    }

    return errorJson("未知的保存类型", 400);
  } catch (err) {
    return errorJson(err.message || "保存到 GitHub 失败", 500);
  }
}
