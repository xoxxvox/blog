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


### 五级账号与邀请码权限

- 等级：游客（`guest`）、普通（兼容原 `user`）、高级（`advanced`）、VIP（`vip`）、管理员（`admin`）。旧账号和邀请码不需要重建。
- 在统一后台“用户与安全 → 邀请码管理”选择博客或图床，勾选并保存等级权限，再生成对应等级的邀请码。两站使用各自的管理员会话；权限策略按站点独立存储在 D1 `access_policies` 表，接口会自动创建此表。
- 管理员始终拥有全部权限。注册时填写邀请码可直接获得对应等级；已有账号可兑换同级或更高等级的邀请码，低级邀请码不能延长高级账号有效期。
- 图床“隐秘空间”位于“动漫次元”之后，与公开图库独立筛选。仅 VIP 和管理员可获授权查看、下载；低等级显示锁定与邀请码兑换入口。图片通过受会话保护的接口读取，响应不允许公共缓存。
- 权限变更在服务端立即生效，刷新页面可同步按钮状态。已在外部公开分发的存储源链接不受页面权限控制；需要保密的源文件应保存在非公开存储中。

本地权限与邀请码回归验证（使用支持 node:sqlite 的 Node.js 环境）：

```sh
node --test test/permissions.test.mjs
```


### 博客独立隐秘文章

“技术手记”后的“隐秘空间”使用独立的 D1 `private_posts`、`private_post_categories` 表，不进入公开 GitHub 文章快照。后端会自动创建表，也可使用更新后的 `schema.sql` 初始化。统一后台“博客管理 → 隐秘空间 · 私密文章”支持新建、编辑、Markdown 预览、删除和独立分类管理；删除分类会将文章移至“未分类”，不会删除文章。阅读与 Markdown 下载分别通过 VIP 权限控制。
