---
id: "post-mwobaesl"
title: "openwrt安装配置"
category: "科学网络"
date: "2026-11-20"
readTime: "5 分钟"
featured: true
excerpt: "openwrt安装配置"
---

# **openwrt**

## 一、配置：

#### 1.登录：浏览器输入：“192.168.1.1”，打开网页。

- 用户：root
- 密码：空

#### 2.界面：系统-软件包-更新列表

- 搜索zh-cn，选择简体中文
- 刷新网页

#### 3.时间：系统-通用设置

- 时区：Asia/Shanghai

#### 4.wan接口：网络-接口

- wan接口：删除
- wan6接口：删除
- 保存并应用

#### 5.br-lan：网络-接口-设备

- 配置网桥端口：选择etho、eth1
- 保存并应用

#### 6.lan接口：网络-接口

- 通用设置：
  - ipv4地址：192.168.110.2/24
  - ipv4网关：主路由网关地址    如：192.168.110.1
- 高级设置：
  - 使用自定义的 DNS 服务器：主路由网关地址    如：192.168.110.1、235.5.5.5
- DHCP服务器：
  - 常规设置：
    - 忽略此接口  √
  - ipv6设置：
    - RA 服务：已禁用
    - DHCPv6 服务：已禁用
    - NDP 代理：已禁用
- 保存并应用

#### 7.DNS：网络-DNS-筛选

- 过滤 IPv6 AAAA 记录
- 保存并应用

## 二、替换软件源

#### 1. 备份原源配置文件

```
cp /etc/apk/repositories.d/distfeeds.list /etc/apk/repositories.d/distfeeds.list.bak
```

#### 2. 替换为国内镜像源（二选一）

- **中国科学技术大学源（USTC，推荐）：**

  ```
  sed -i 's/downloads.openwrt.org/mirrors.ustc.edu.cn\/openwrt/g' /etc/apk/repositories.d/distfeeds.list
  ```

- **清华大学开源镜像站（TUNA）：**

  ```
  sed -i 's/downloads.openwrt.org/mirrors.tuna.tsinghua.edu.cn\/openwrt/g' /etc/apk/repositories.d/distfeeds.list
  ```

- **阿里云镜像源（Aliyun）：**

  ```
  sed -i 's/downloads.openwrt.org/mirrors.aliyun.com\/openwrt/g' /etc/apk/repositories.d/distfeeds.list
  ```

#### 3. 更新软件包索引

```
apk update
```

- **验证标准**：终端输出显示从 `mirrors.ustc.edu.cn`（或对应镜像站）拉取 `packages.adb` 索引且无报错（返回 `OK:` 状态），即说明软件源替换成功。

### 方法二：通过 LuCI 网页后台修改

1. 打开浏览器登录 OpenWrt 网页管理后台。
2. 导航至 **系统 (System)** -> **软件包 (Software)**。
3. 点击 **配置 (Configuration)** 标签页。
4. 在软件源列表框（对应 `distfeeds.list`）中，将其中的所有 `downloads.openwrt.org` 手动替换为 `mirrors.ustc.edu.cn/openwrt`。
5. 点击页面右下角的 **保存 (Save)**。
6. 返回“动作”或概览标签页，点击 **更新列表 (Update lists...)** 测试是否能正常拉取。

### 补充：若您的固件仍沿用传统 opkg

如果使用的固件为第三方定制构建版且尚未迁移至 `apk`，仍保留了 `opkg`，请执行传统的替换指令：

```
sed -i 's/downloads.openwrt.org/mirrors.ustc.edu.cn\/openwrt/g' /etc/opkg/distfeeds.conf
opkg update
```

# 三、安装软件

#### 1.OpenWrt 25.12 中批量安装

```
命令：
apk add --allow-untrusted /tmp/*.apk
```

#### 2.具体操作与步骤

**进入目录并执行安装**

Bash

```
cd /tmp
apk add --allow-untrusted ./*.apk
```

- **参数作用**：手动上传的第三方或离线编译安装包通常没有官方数字签名，加上 `--allow-untrusted` 可以避免触发 `UNTRUSTED signature` 校验错误而导致安装终止。
- **依赖说明**：如果这些软件包依赖其他基础库，`apk` 会尝试连接已配置的软件源自动下载依赖。

**验证安装状态**

- *验证方法*：运行以下命令查看刚刚安装的包是否已成功注册到系统中：

  ```
  apk list -I
  ```

  或者单独验证某个软件包：

  ```
  apk info -e <软件包名称>
  ```

  如果终端输出了对应的包名和版本号，即表示安装成功。

**清理临时安装文件（可选）** 安装完成后，`/tmp` 目录下的安装包可以安全删除以释放内存空间：

```
rm -f /tmp/*.apk
```

