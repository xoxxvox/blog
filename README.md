# XXOXOVX · Blog（纯净前端 + API 仓库）

公开展示前端与 Cloudflare Pages Functions 后端接口仓库（部署域名例如 `blog.xxx.com`）。
前台页面 `index.html` 已彻底剥离所有后台管理面板、登录弹窗、编辑按钮及相关 CSS/JS，仅保留纯展示与只读数据拉取逻辑。

## 目录结构

```text
blog-frontend/
├── README.md                  # 项目说明
├── index.html                 # 纯净前端单页（零后台痕迹，仅保留阅读与只读展示）
├── schema.sql                 # Cloudflare D1 数据库初始化脚本
├── data/                      # 博客结构化数据（由独立后台通过 GitHub API 自动提交更新）
│   ├── README.md
│   ├── posts.json
│   ├── profile.json
│   └── posts/
├── images/                    # 备用图片目录（未绑定 R2 时回退写入此处）
│   └── README.md
└── functions/                 # Cloudflare Pages Functions 接口目录（挂载于 /api/*）
    ├── README.md
    └── api/
        ├── README.md
        ├── _middleware.js     # 全局 CORS 中间件（放行 ADMIN_ORIGIN 跨域携带 Cookie 请求）
        ├── _lib.js            # 公共工具库（已将 Cookie 升级为 SameSite=None; Secure）
        ├── auth.js            # 登录 / 退出 / 会话查询
        ├── content.js         # 读取与写入 GitHub 仓库的 posts.json / profile.json / posts/*.md
        ├── comments.js        # 评论读取与管理
        ├── invites.js         # 邀请码管理
        ├── upload.js          # 图片上传（R2 优先，GitHub 兜底）
        └── image.js           # 图片代理读取
```

## Cloudflare Pages 环境变量与绑定

- **D1 绑定**：变量名 `DB`
- **R2 绑定（推荐）**：变量名 `IMAGES`
- **环境变量（Secrets）**：
  - `GITHUB_TOKEN`：具有本仓库 `Contents: Read and write` 权限的 PAT
  - `GITHUB_OWNER`：GitHub 用户名
  - `GITHUB_REPO`：本前端仓库名（例如 `blog-frontend`）
  - `GITHUB_BRANCH`：分支名（默认 `main`）
  - `ADMIN_INVITE_CODE`：首个管理员初始化邀请码
  - `ADMIN_ORIGIN`：**新增必填**，独立后台的完整来源地址（例如 `https://admin.xxx.com`，多个来源用英文逗号分隔）
