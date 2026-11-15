---
id: "nanopi-r5c"
title: "NanoPi R5C 旁路分流与固件编译手记"
category: "技术手记"
date: "2026-11-01"
readTime: "10 分钟"
featured: true
excerpt: "基于 Rockchip armv8 架构的固件编译、apk 软件源配置及旁路分流经验总结。"
---

NanoPi R5C 配备双 2.5G 网口与 RK3568B2 处理器，功耗控制极佳，非常适合作为家庭网络的旁路网关。

## 精简固件包选择

只保留核心网络转发、DNS 缓存与基础监控组件，避免在有限的 eMMC 空间里堆积不必要的后台服务。

```bash
opkg update && opkg install luci-app-sqm nftables
```

> 把复杂度隔离在旁路设备里，主路由永远保持最小可用配置。

## 分流规则维护

通过定时任务每周自动拉取并校验规则集，配合 `nftables` 实现低延迟的本地直连与分流。
