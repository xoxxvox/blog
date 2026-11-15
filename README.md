# XXOXOVX · Blog

基于 **Cloudflare Pages + Pages Functions + D1 数据库 + GitHub 存储** 构建的极简个人技术博客系统。

## 目录结构树形图

```text
xxoxovx-blog/
├── README.md                  # 项目总览与目录树形说明（本文件）
├── index.html                 # 前端单页应用（首页、阅读器、评论区、登录注册、管理后台 UI）
├── schema.sql                 # Cloudflare D1 数据库建表脚本（用户、邀请码、会话、评论表）
├── data/                      # 博客结构化内容存储目录（由管理后台自动提交更新）
│   ├── README.md              # data 目录说明文档
│   ├── posts.json             # 文章列表与正文数据
│   └── profile.json           # 站点标题、Hero 简介、头像与个人联系方式配置
├── images/                    # 图片资源存储目录（由管理后台上传自动提交到此）
│   ├── README.md              # images 目录说明文档
│   └── .gitkeep               # 空目录占位文件（确保 Git 保留该目录）
└── functions/                 # Cloudflare Pages Functions 后端函数根目录（不可改名）
    ├── README.md              # functions 目录说明文档
    └── api/                   # 映射为 /api/* 的服务端接口目录
        ├── README.md          # api 接口详细说明文档
        ├── _lib.js            # 公共工具库（密码加密、Cookie 会话、GitHub API 读写封装）
        ├── auth.js            # /api/auth：登录、邀请码注册、退出、会话查询
        ├── content.js         # /api/content：读取与保存 posts.json / profile.json 到 GitHub
        ├── upload.js          # /api/upload：管理员上传图片并写入 GitHub images/ 目录
        ├── image.js           # /api/image：从 GitHub 代理读取图片资源（支持私有仓库）
        ├── comments.js        # /api/comments：文章评论的查询、发表与删除
        └── invites.js         # /api/invites：管理员生成、查看与删除注册邀请码
```

## 存储分工说明

- **GitHub 仓库**：存放前端代码、文章数据（`data/posts.json`）、个人资料（`data/profile.json`），以及未启用 R2 时的备用图片目录（`images/`）。
- **Cloudflare R2（推荐用于图片）**：绑定变量名 `IMAGES`，专门存放后台上传的头像与文章配图（支持最大 10MB、零流量费、不撑大 Git 仓库）。
- **Cloudflare D1 数据库**：存放用户账号（`users`）、邀请码（`invites`）、登录会话（`sessions`）与文章评论（`comments`）。
- **Cloudflare Pages**：托管静态页面并运行 `functions/api/` 下的无服务器后端接口。

## 后续管理提示

- **目录命名约定**：`functions/api/` 为 Cloudflare Pages 路由约定目录，请勿重命名，否则 `/api/*` 接口将失效。
- **日常更新**：文章发布、资料修改、头像与配图上传均可在网页登录管理员账号后通过「管理后台」完成，系统会自动提交保存到 GitHub。
