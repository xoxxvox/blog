---
id: "serverless-cron"
title: "用 Serverless Worker 替代传统常驻脚本"
category: "科学网络"
date: "2026-10-22"
readTime: "8 分钟"
featured: false
excerpt: "把域名证书监测、RSS 汇总与状态巡检迁移到无服务器定时任务，零机器维护成本。"
---

以前为了跑几个每天只执行一次的 Python 巡检脚本，总要维护一台最低配的 VPS。迁到无服务器定时触发器后，几乎不再需要关心系统更新。

## 单文件无状态设计

将密钥放入环境变量，把巡检结果通过 Webhook 推送到常用通讯工具，整个函数不超过 80 行。

```javascript
export default {
  async scheduled(event, env) {
    await checkCertificates(env.DOMAINS);
  }
};
```
