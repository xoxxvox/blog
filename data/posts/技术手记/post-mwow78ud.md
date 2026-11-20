---
id: "post-mwow78ud"
title: "penClash 安装配置"
category: "技术手记"
date: "2026-11-20"
readTime: "5 分钟"
featured: false
excerpt: "penClash 从零安装、配置与调试完全指南"
---

# OpenClash 从零安装、配置与调试完全指南（OpenWrt + Mihomo）

[OpenClash](https://github.com/vernesong/OpenClash) 是运行在 OpenWrt 路由器上的 LuCI 代理管理插件，目前底层已全面转向 [Mihomo（原 Clash Meta）](https://github.com/MetaCubeX/mihomo/releases) 及 Smart 智能内核，支持 Shadowsocks、VMess、VLESS、Trojan、Snell、TUIC、Hysteria 等主流协议，并兼容 `nftables`（fw4）与 `iptables`（fw3）。

本指南按**环境确认 → 安全备份 → 依赖与插件安装 → 内核部署 → 核心模式配置 → 启动与排错**的顺序，提供一套可直接落地的从零部署与排错方案。

---

## 一、安装前准备：环境确认与安全备份

在执行任何安装或网络配置修改前，请先通过 SSH 登录 OpenWrt 路由器，确认系统环境并做好配置备份，避免因 `dnsmasq` 替换或防火墙变更导致路由器失联。

### 1. 确认系统架构、包管理器与防火墙类型

执行以下命令查看设备架构、OpenWrt 版本及防火墙后端：

```sh
# 查看系统发行版与目标架构
cat /etc/openwrt_release
uname -m

# 检查包管理器类型（返回 opkg 或 apk）
which opkg apk

# 检查防火墙后端（存在 fw4 即为 nftables，否则通常为 iptables）
which fw4 fw3
```

* **OpenWrt 22.03 / 23.05 / 24.10**：默认使用 `fw4`（`nftables`）与 `opkg`（`.ipk` 包）。
* **OpenWrt 新版快照 / 25.12+**：部分固件已切换至 `apk`（`.apk` 包）。请根据实际查询结果选择下文对应的安装命令。

### 2. 备份基础网络与防火墙配置

在替换 `dnsmasq` 或启用透明代理前，先备份核心配置文件，并确保至少有一条稳定的 LAN 口直连管理路径（如固定 IP 的网线直连）：

```sh
mkdir -p /root/backup_pre_openclash
cp /etc/config/network /root/backup_pre_openclash/network.bak
cp /etc/config/dhcp /root/backup_pre_openclash/dhcp.bak
cp /etc/config/firewall /root/backup_pre_openclash/firewall.bak
```

---

## 二、安装依赖与 OpenClash 插件

OpenClash 依赖完整版 `dnsmasq-full`（OpenWrt 默认自带的精简版 `dnsmasq` 缺少 `ipset`/`nftset` 支持）以及对应的防火墙内核模块。

### 1. 安装运行依赖

请根据路由器使用的**防火墙后端**与**包管理器**选择对应命令（依赖清单源自 [OpenClash 官方文档](https://github.com/vernesong/OpenClash)）。

> **重要提示**：卸载 `dnsmasq` 并安装 `dnsmasq-full` 期间，路由器本地 DNS 解析会短暂中断。建议先确认路由器具备可用外网连接，或先使用 `opkg download dnsmasq-full` 缓存安装包后再执行替换。

#### 方案 A：nftables 防火墙（Firewall4 / OpenWrt 22.03+ 默认）

* **opkg 系统（`.ipk`）**：

```sh
opkg update
opkg remove dnsmasq
opkg install bash dnsmasq-full curl ca-bundle ip-full ruby ruby-yaml kmod-tun kmod-inet-diag unzip kmod-nft-tproxy luci-compat luci luci-base
```

* **apk 系统（`.apk`）**：

```sh
apk update
apk del dnsmasq
apk add bash dnsmasq-full curl ca-bundle ip-full ruby ruby-yaml kmod-tun kmod-inet-diag unzip kmod-nft-tproxy luci-compat luci luci-base
```

#### 方案 B：iptables 防火墙（Firewall3 / 老版本 OpenWrt）

* **opkg 系统（`.ipk`）**：

```sh
opkg update
opkg remove dnsmasq
opkg install bash iptables dnsmasq-full curl ca-bundle ipset ip-full iptables-mod-tproxy iptables-mod-extra ruby ruby-yaml kmod-tun kmod-inet-diag unzip luci-compat luci luci-base
```

* **apk 系统（`.apk`）**：

```sh
apk update
apk del dnsmasq
apk add bash iptables dnsmasq-full curl ca-bundle ipset ip-full iptables-mod-tproxy iptables-mod-extra ruby ruby-yaml kmod-tun kmod-inet-diag unzip luci-compat luci luci-base
```

> 若需要 IPv6 代理支持，可额外安装 `ip6tables-mod-nat`（仅 iptables 环境需要）。

### 2. 下载并安装 OpenClash 插件

您可以从 [OpenClash Releases](https://www.google.com/search?q=https%3A%2F%2Fgithub.com%2Fvernesong%2FOpenClash%2Freleases) 页面下载最新版的 `luci-app-openclash_*.ipk` 或 `luci-app-openclash-*.apk`，通过以下任一方式安装：

* **方式一：命令行在线获取并安装（推荐）**

```sh
# opkg 系统示例
curl -L --retry 2 https://api.github.com/repos/vernesong/OpenClash/releases/latest -o /tmp/openclash_version
download_url=$(cat /tmp/openclash_version | jsonfilter -e '@.assets[*].browser_download_url' | grep '\.ipk$')
curl -L --retry 2 "$download_url" -o /tmp/openclash.ipk
opkg install /tmp/openclash.ipk
```

*(若使用 `apk` 系统，将上述正则替换为 `grep '\.apk$'`，并使用 `apk add -q --force-overwrite --clean-protected --allow-untrusted /tmp/openclash.apk` 安装。)*

* **方式二：LuCI 网页端上传安装**
  1. 在电脑浏览器下载对应的 `.ipk` 或 `.apk` 安装包。
  2. 登录 OpenWrt 后台，进入 **系统 → 软件包**，点击 **上传软件包** 并完成安装。
  3. 刷新页面或重新登录 LuCI，在顶部菜单 **服务 → OpenClash** 中即可看到插件入口。

---

## 三、部署与验证 Mihomo 内核

OpenClash 安装包默认不包含代理内核，首次启动前必须部署 [Mihomo（Clash Meta）](https://github.com/MetaCubeX/mihomo/releases) 内核。

### 1. 在线下载（网络可直连 GitHub 时）

进入 **服务 → OpenClash → 插件设置 → 版本更新**：
1. 确认 **内核编译版本** 与当前设备 CPU 架构一致（如 `linux-amd64`、`linux-arm64`、`linux-mipsle-softfloat` 等）。
2. 点击 **检查并更新** 按钮自动拉取 Meta 内核。

### 2. 手动上传与替换（推荐，解决国内拉取失败）

当路由器无法直接连接 GitHub 时，可手动下载并部署内核：

1. 前往 [MetaCubeX/mihomo Releases](https://github.com/MetaCubeX/mihomo/releases) 下载对应架构的 `.gz` 压缩包（x86-64 通用兼容性推荐选择 `mihomo-linux-amd64-compatible-*.gz`，ARM64 设备选择 `mihomo-linux-arm64-*.gz`）。
2. 解压后上传至路由器 `/etc/openclash/core/` 目录，并将二进制文件重命名为 `clash_meta`：

```sh
mkdir -p /etc/openclash/core
# 假设已将解压后的二进制文件上传为 /tmp/mihomo
mv /tmp/mihomo /etc/openclash/core/clash_meta
chmod +x /etc/openclash/core/clash_meta
```

3. 验证内核是否可执行且架构匹配：

```sh
/etc/openclash/core/clash_meta -v
```

若正常输出 Mihomo 版本号及编译平台信息（如 `Mihomo Meta ... linux amd64`），说明内核部署成功。

---

## 四、核心模式与网络参数配置

在启动 OpenClash 前，需先理清运行模式、TUN 协议栈及 DNS 协同机制，避免常见的断网或 DNS 泄露问题。

### 1. 运行模式对比：Fake-IP vs Redir-Host

| 对比维度 | Fake-IP 模式（推荐默认） | Redir-Host 模式 |
| :--- | :--- | :--- |
| **解析机制** | 劫持域名请求并立即返回 `198.18.0.0/16` 保留段虚假 IP，由内核按域名分流 | 先向真实 DNS 解析出目标真实 IP，再由内核决定直连或代理 |
| **连接延迟** | 极低（省去本地等待真实 DNS 解析的时间） | 略高（需先完成 DNS 查询） |
| **DNS 泄露风险** | 极低，天然免疫本地 ISP DNS 污染 | 需配合精细的国内外 DNS 分流规则 |
| **适用场景** | 日常家庭/办公代理、游戏加速、流媒体解锁 | 内网服务穿透、部分对真实 IP 有强校验的特定客户端 |

> **切换模式注意**：在 `Fake-IP` 与 `Redir-Host` 之间切换时，务必清空 `/etc/openclash/cache.db` 并刷新终端设备（电脑/手机）的 DNS 缓存，否则客户端残留的 `198.18.0.0/16` 假 IP 会导致直连网站无法打开。

### 2. TUN 模式协议栈（Stack）选择

如果开启了 TUN 模式（在 **插件设置 → 模式设置** 中选择 *TUN 模式* 或 *混合模式*），内核协议栈建议按硬件与需求选择：

* **`mixed`（默认推荐）**：TCP 流量走 `system` 栈、UDP 流量走 `gvisor` 栈，兼顾转发性能与 UDP/游戏兼容性。
* **`system`**：完全使用 Linux 内核网络栈，CPU 占用最低，要求内核 `kmod-tun` 与 `nftables` 环境干净。
* **`gvisor`**：纯用户态 TCP/IP 协议栈，可有效规避部分固件内核 `conntrack` 冲突，但高吞吐下 CPU 占用较高。
* **`mips`**：轻量级混合栈，适合内存或算力受限的嵌入式设备（启用前需确认当前 `clash_meta` 内核版本支持该参数）。

### 3. DNS 与 Dnsmasq 协同设置

DNS 配置错误是导致“能 ping 通 IP 但打不开网页”的首要原因：

1. **避免 DNS 端口死循环**：OpenClash 启动后默认接管本机 DNS，并将 Dnsmasq 上游转发指向 OpenClash 的 DNS 监听端口（默认 `7874`）。切勿将 OpenClash 的国内/默认上游 DNS（`nameserver` / `default-nameserver`）再指回本地 `127.0.0.1:53`，否则会形成 `Dnsmasq -> OpenClash -> Dnsmasq` 的死循环直至超时。
2. **推荐上游 DNS 架构**：
   * `default-nameserver`：填写纯 IP 地址的国内公共 DNS（如 `223.5.5.5`、`119.29.29.29`），用于解析 DoH/DoT 域名及代理服务器域名。
   * `nameserver`：国内直连 DNS（如 `https://dns.alidns.com/dns-query`）。
   * `fallback` / `proxy-server-nameserver`：海外可信 DNS（如 `https://dns.google/dns-query` 或 `https://1.1.1.1/dns-query`），确保代理节点解析与境外域名解析不泄露。

---

## 五、导入配置、规则排序与覆写注意事项

### 1. 导入订阅或配置文件

进入 **服务 → OpenClash → 配置管理 / 配置文件订阅**：
* **订阅导入**：添加机场提供的 Clash/Mihomo 订阅链接。若订阅原格式非 Clash YAML，可在订阅设置中开启在线转换（Subconverter）并选择合适的规则模板（如 ACL4SSR 或 Custom_OpenClash_Rules）。
* **手动上传**：将本地校验好的 YAML 上传至 `/etc/openclash/config/`。

在手动修改任何现网配置前，养成先备份的习惯：

```sh
cp /etc/openclash/config.yaml /etc/openclash/config.yaml.bak
```

> **安全提醒**：分享日志或配置文件排查问题时，请务必对订阅 URL、节点服务器地址、密码及 `secret` 密钥进行脱敏替换。

### 2. Mihomo 配置与规则排序规范

确保配置文件遵循当前 Mihomo Schema（删除已废弃的 Clash Premium 专属字段，如旧版 `cfw-*` 键或不兼容的 `find-process-mode` 值），并保持严格的 **2 空格缩进**（禁止使用 Tab 字符，含冒号或 `!`、`@`、`*` 的字符串需加引号）。

推荐的 `rules` 顺序自上而下为：

1. **局域网与私有地址直连**（放在最前，且加 `no-resolve` 避免触发多余 DNS 查询）：
   ```yaml
   - GEOIP,private,DIRECT,no-resolve
   ```
2. **拦截代理域名的 QUIC（UDP 443）流量**（防止浏览器或 App 走 HTTP/3 绕过代理或导致连接卡顿）：
   ```yaml
   - AND,((NETWORK,UDP),(DST-PORT,443),(GEOSITE,geolocation-!cn)),REJECT
   ```
3. **细分业务策略组**（如 AI 服务、流媒体 Netflix/Disney+、Apple、PayPal 等精准规则）。
4. **国内常规流量直连**：
   ```yaml
   - GEOSITE,cn,DIRECT
   - GEOIP,CN,DIRECT
   ```
5. **最终兜底规则**：
   ```yaml
   - MATCH,Proxy
   ```

### 3. 覆写设置（Overwrite）优先级陷阱

OpenClash 在启动时，会**先读取基础 YAML，再依次应用 LuCI 界面勾选的覆写选项以及 `/etc/openclash/custom/` 下的自定义覆写脚本**。
如果您发现手动修改 `config.yaml` 中的 DNS、端口或规则后在启动时被还原，请检查：
* **OpenClash → 覆写设置** 中是否勾选了覆盖 DNS、覆盖运行模式或自定义规则。
* `/etc/openclash/custom/` 目录下的自定义脚本，以及 `uci show openclash` 输出的 UCI 配置项。

---

## 六、启动与系统化调试排错

完成配置后，在 **OpenClash 总览** 页面点击 **启动 OpenClash**。控制面板默认内置了 `metacubexd`、`zashboard`、`Yacd-meta` 与 `Razord-meta`（默认控制端口通常为 `9090`），点击 **打开控制面板** 即可查看节点延迟、实时连接与分流命中情况。

若启动失败、面板无法打开或网络异常，请按以下 **4 步标准排查流程** 在 SSH 终端逐一验证：

### 第 1 步：检查服务状态与内核进程

```sh
/etc/init.d/openclash status
ps w | grep -E "clash|mihomo"
```

* 若无 `clash_meta` 进程运行，说明内核未成功拉起，继续执行第 2 步。

### 第 2 步：YAML 语法校验与内核离线试运行

使用内核自带的 `-t` 参数直接测试配置文件是否合法，能精准定位语法缩进错误或已废弃字段：

```sh
/etc/openclash/core/clash_meta -t -d /etc/openclash -f /etc/openclash/config.yaml
```

* 正常应返回 `test is successful`；若有报错，终端会直接打印出具体的行号与字段名。

### 第 3 步：查看运行日志与系统日志

```sh
tail -n 100 /tmp/openclash.log
logread -e openclash
```

* `/tmp/openclash.log` 记录了 OpenClash 启动脚本、GeoIP/GeoSite 数据库下载及规则加载的详细过程；`logread` 可捕捉内核崩溃或权限/内存不足报错。

### 第 4 步：验证防火墙规则（fw4）与端口监听

```sh
# 检查 nftables 中是否已成功注入 openclash 转发链
nft list table inet fw4 | grep -i openclash

# 检查关键端口监听情况（53=Dnsmasq, 7874=Clash DNS, 7890-7892=混合/透明代理端口, 9090=控制面板）
netstat -tulnp | grep -E "53|7874|7890|7891|7892|9090"
```

---

## 七、常见高频故障速查表

| 故障现象 | 常见原因 | 排查与解决动作 |
| :--- | :--- | :--- |
| **点击启动后状态仍为未运行** | 缺少核心依赖（如 `ruby-yaml`、`kmod-nft-tproxy`）、内核未赋权或架构选错 | 执行 `clash_meta -v` 与 `clash_meta -t` 验证内核与配置；核对本文第二节依赖是否装齐 |
| **控制面板打不开 / 提示连接失败** | 外部控制端口 `9090` 未监听，或 `secret` 密钥与面板输入不一致 | 检查 `netstat` 中 `9090` 端口状态；在面板设置中核对后端地址与 `secret` |
| **国外可访问，国内网站打不开或变慢** | 切换过 Fake-IP/Redir-Host 未清缓存，或国内规则未命中 | 停止插件后删除 `/etc/openclash/cache.db` 并重启；清理电脑/手机本地 DNS 缓存 |
| **DNS 解析超时或出现死循环** | `dnsmasq-full` 未正确替换 `dnsmasq`，或 OpenClash 上游指回 `127.0.0.1:53` | 确认 `dnsmasq-full` 已安装；检查配置文件 `default-nameserver` 与 `nameserver` 为外部 IP/DoH |
| **部分 App/网页走直连或泄露真实 IP** | 浏览器/App 启用了 QUIC（UDP 443）或本地 IPv6 流量未接管 | 添加针对境外域名的 `UDP 443 REJECT` 规则；按需在 OpenClash 中开启或关闭 IPv6 代理 |
| **修改 `config.yaml` 后重启失效** | 被 OpenClash 的 LuCI 覆写设置或自定义脚本覆盖 | 检查 **插件设置 → 覆写设置** 与 `/etc/openclash/custom/` 脚本，或直接在覆写模块中修改 |

