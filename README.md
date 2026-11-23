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


### 三档固定权限

- 等级仅保留游客（未登录）、登录用户和管理员。旧高级、VIP 和游客账号登录后按登录用户处理；管理员拥有全部权限。
- 在统一后台“用户与安全 → 邀请码管理”选择博客或图床，只读查看三档权限，并生成登录用户或管理员邀请码。两站仍使用各自管理员会话；旧 access_policies 记录保留但不再决定权限。
- 管理员始终拥有全部权限。注册时填写邀请码可直接获得对应等级；已有账号可兑换同级或更高等级的邀请码，低级邀请码不能延长高级账号有效期。
- 权限变更在服务端立即生效，刷新页面可同步按钮状态。已在外部公开分发的存储源链接不受页面权限控制；需要保密的源文件应保存在非公开存储中。

本地权限与邀请码回归验证（使用支持 node:sqlite 的 Node.js 环境）：

```sh
node --test test/permissions.test.mjs
```

### 隐秘空间已退役，历史数据保留

前台不再显示隐秘空间或兑换解锁入口；独立简介、联系方式、分类设置及会员隐秘权限已移除。历史文章只在统一后台“博客内容 → 历史文章归档”供管理员只读查看；历史非公开图片保留在后台“历史图片归档”，不自动公开或删除。非管理员账号不能通过旧接口、图片直链或下载地址读取归档。普通文章、图库、上传、评论、AI、存储、账号与邀请码逻辑保留。

现有数据库不需要迁移或清表。旧五档自定义权限不再参与授权，统一使用三档固定权限，不重写历史权限记录；历史文章、分类和个人资料表保留，旧设置写入接口返回 410。归档图片不参与前台到期自动清理。

发布时同步更新 blog、imghub、blog-admin、imghub-admin 四个项目，避免旧页面继续请求退役接口；部署后强制刷新缓存。不要 DROP private_posts、private_post_categories、private_bio，或批量修改图片 is_public。


### 当前三档权限与三天临时上传

- 游客：查看普通文章、图片；不能点赞、评论、上传或使用下载接口。
- 登录用户：文章点赞、收藏、评论、个人资料；图床查看、下载、复制链接、上传及原有本人 AI 打标。不可编辑或删除全站图片、操作归档、管理账号及系统设置。
- 管理员：全部管理能力，兼容旧 superadmin；可选原有存储源，管理员图片不套用三天有效期。

普通用户图片由服务端固定写入 Telegram，严格 72 小时有效，客户端不能修改存储源或有效期。到期时网站查看／下载链接立即失效，元数据由访问清理或定时任务移除；Telegram 原消息保留，不调用删除消息接口。没有 D1 时拒绝普通临时上传，避免无法追踪到期。历史管理员归档不参与清理。

同步更新四个项目，并部署 imghub-admin/cleanup-worker 中的定时 Worker，绑定图床现有 D1。只更新 Pages 无法在零访问时定时删除数据库记录；但链接仍会在到期时失效。详见该目录 README。无需清库或批量改写旧账号等级。
