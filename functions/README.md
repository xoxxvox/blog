# `functions/` 目录说明

本目录是 **Cloudflare Pages Functions** 的官方约定根目录。Cloudflare 在部署时会自动扫描此目录下的 JavaScript 文件，并将其作为无服务器后端接口运行。

## 子目录结构

- `api/`：存放所有业务后端 API 接口，自动映射为网站根路径下的 `/api/*` 接口地址。

## 注意事项

- **不要重命名 `functions` 目录**：Cloudflare Pages 仅识别项目根目录下的 `functions/` 文件夹。
- 本目录下的代码运行在 Cloudflare 边缘节点（服务端），可安全读取 Cloudflare 后台配置的环境变量（如 `GITHUB_TOKEN`）和 D1 数据库绑定（`DB`），不会暴露给浏览器前端。
