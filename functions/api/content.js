import { json, errorJson, getSessionUser, githubGetFile, githubPutFile } from "./_lib.js";

const POSTS_PATH = "data/posts.json";
const PROFILE_PATH = "data/profile.json";

export async function onRequestGet({ env }) {
  try {
    const [postsFile, profileFile] = await Promise.all([
      githubGetFile(env, POSTS_PATH),
      githubGetFile(env, PROFILE_PATH),
    ]);
    return json({
      posts: postsFile ? JSON.parse(postsFile.text) : null,
      profile: profileFile ? JSON.parse(profileFile.text) : null,
      source: "github",
    });
  } catch (err) {
    return json({
      posts: null,
      profile: null,
      source: "fallback",
      warning: err.message,
    });
  }
}

export async function onRequestPost({ request, env }) {
  const user = await getSessionUser(request, env);
  if (!user) return errorJson("请先登录", 401);
  if (user.role !== "admin") return errorJson("仅管理员可执行此操作", 403);

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
      await githubPutFile(
        env,
        POSTS_PATH,
        JSON.stringify(body.posts, null, 2),
        `chore(blog): update posts by ${user.username}`
      );
      return json({ ok: true, posts: body.posts });
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
