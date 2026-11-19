# `functions/api/` 目录说明

本目录存放博客的全部后端 API 接口，每个文件（不以下划线 `_` 开头）都会自动映射为同名的 `/api/<文件名>` 路由。

## 文件清单与接口职责

| 文件名 | 对应路由 | 职责说明 |
| :--- | :--- | :--- |
| `_middleware.js` | （全局 CORS 中间件，不对外暴露） | 拦截 `/api/*` 请求与 `OPTIONS` 预检，按 `ADMIN_ORIGIN` 白名单附加 `Access-Control-Allow-Origin` 与 `Access-Control-Allow-Credentials: true` |
| `_lib.js` | （内部公共模块，不对外暴露） | 提供统一 JSON 响应、PBKDF2 密码哈希与校验、Cookie 会话读写、GitHub Contents API 读写封装 |
| `auth.js` | `/api/auth` | 处理当前登录态查询（`GET`）、登录 / 邀请码注册 / 退出登录（`POST`） |
| `content.js` | `/api/content` | 从 GitHub 读取 `data/posts.json` 与 `data/profile.json`（`GET`）；管理员保存文章或资料并自动提交到 GitHub（`POST`） |
| `upload.js` | `/api/upload` | 校验管理员权限与图片格式/大小，优先上传到 **Cloudflare R2（`IMAGES`）**，未绑定 R2 时自动回退写入 GitHub `images/` 目录（`POST`） |
| `image.js` | `/api/image` | 优先从 **Cloudflare R2** 读取 `?key=...`，并兼容从 GitHub 读取 `?path=images/...`（`GET`） |
| `comments.js` | `/api/comments` | 获取文章评论列表（`GET`）、登录用户发表评论（`POST`）、管理员或评论本人删除评论（`DELETE`） |
| `invites.js` | `/api/invites` | 仅限管理员查看邀请码列表（`GET`）、生成普通用户或管理员邀请码（`POST`）、删除邀请码（`DELETE`） |

## 依赖配置（在 Cloudflare Pages 后台设置）

- **D1 数据库绑定**：变量名 `DB`
- **R2 存储桶绑定（推荐）**：变量名 `IMAGES`
- **环境变量（Secrets）**：`GITHUB_TOKEN`、`GITHUB_OWNER`、`GITHUB_REPO`、`GITHUB_BRANCH`、`ADMIN_INVITE_CODE`、`ADMIN_ORIGIN`（独立后台完整来源，如 `https://admin.xxx.com`）
