# dsh-activity-wall · 大肥鱼的活动墙

[English](README.en.md) | 简体中文

把一个 B 站账号的**评论**和**观看记录**生成一个**本地网页**：

- 一页看全：发过的评论 / 特意看的视频 / 刷到的视频
- **点卡片直接跳 B 站**，评论会定位到那条具体评论（`#reply<rpid>`）
- **点一下就开**，不依赖浏览器 JS、不需要联网就能打开（数据在生成时抓取）
- 数据来源全可配置，缺哪个都能跑

> 这是给 [Aurabot](https://github.com/) QQ 机器人插件写的**扩展模块**。它会读取 Aurabot 的 B 站数据（评论记录、观看留档、官方历史），生成一个静态网页。

---

## 效果

```
大肥鱼的活动墙
评论 13 条（已定位 8）｜观看 44 个（特意看的 4）｜生成于 2026-11-01 05:06

[评论 13 条] [特意看的 4 个] [刷到的 40 个]

她发过的评论
  ┌─────────────────────────────────────┐
  │ 这流程复杂得像在修钟 能出声就行      │
  │ 《怎么让你的大肥鱼有可爱的声音2》    │
  │ ✓ 已定位到这条评论 点卡片跳评论区 ↗ │
  └─────────────────────────────────────┘

她特意看的
  《六个插件：给你的大肥鱼DSH装上灵魂》 [她看的] [B站历史]
   看到 803s   BV1jhn16GEcv   点卡片打开视频 ↗

刷到的
  《快干活！快干活！快干活！》 [补记] [刷到]  看到 10s
```

---

## 安装

1. 把整个文件夹拷到 Aurabot 的模块目录：

```
<DSH 数据目录>/plugins-data/aurabot/modules/activity-wall/
├── index.mjs
└── templates/
    └── activity-template.html
```

Windows 一般是：

```
C:\Users\<你>\.dsh\plugins-data\aurabot\modules\activity-wall\
```

2. 重启 DSH（或在面板里点「重载模块」）

3. 加载成功后，她（或你）会多一个工具：

```
activity_wall    生成活动墙
```

首次加载 8 秒后会自动生成一次。

---

## 配置

在 Aurabot 面板「模块 → 活动墙」里改，或直接改 `config.json` 的 `ext["activity-wall"]`：

| 配置项 | 说明 | 默认值 |
|---|---|---|
| `enabled` | 启用 | `true` |
| `title` | 页面标题 | `大肥鱼的活动墙` |
| `outputDir` | 页面输出目录 | `D:\大肥鱼\活动墙` |
| `commentLogDir` | 评论留档目录（`*.jsonl`） | `D:\大肥鱼\大肥鱼发的评论` |
| `watchLogDir` | 观看留档目录（`*.jsonl`） | `D:\大肥鱼\大肥鱼的观看记录` |
| `coreBiliJson` | Aurabot 核心 `bili.json` 路径 | 留空 = 自动找 |
| `useBiliApi` | 是否调 B 站官方观看历史 | `true` |
| `locateComments` | 是否翻评论区找 `rpid` 定位 | `true` |
| `maxComments` / `maxWatches` | 最多展示多少条 | `200` / `120` |

### 留档文件格式

评论留档 `commentLogDir/*.jsonl`，每行一条：

```json
{"t":"2026-11-01T04:11:45Z","bvid":"BV1jhn16GEcv","title":"六个插件…","text":"评论内容","mention":true,"rpid":318815896641}
```

观看留档 `watchLogDir/*.jsonl`，每行一条：

```json
{"t":"2026-11-01T03:24:23Z","bvid":"BV15X3n6mEWy","title":"大肥鱼 炸盆子","progress":13,"frames":3,"source":"owner-link"}
```

> `frames > 0` 表示她抽帧真看过画面；`source = owner-link` 表示是主人发的链接（会归到「特意看的」）。

---

## 它怎么工作

1. **收集评论**：Aurabot 核心 `bili.json` 的 `history`（自动刷时发的）+ 本地评论留档
2. **收集观看**：本地观看留档 + B 站官方观看历史（需要 cookie）
3. **定位评论**：用 wbi 签名接口 `/x/v2/reply/wbi/main` 翻评论区，按 `mid + 文本前缀` 找出 `rpid`，生成 `https://www.bilibili.com/video/BVxxx/#reply<rpid>` 深链
   - 找不到（审核中 / 折叠 / 沉底）会标红「未定位」，卡片仍能跳视频
   - `rpid` 会缓存到 `modules-data/activity-wall/rpid-map.json`，不重复查
4. **合并去重**：按标题归一化合并，同一视频只留一张卡（时间取最新、进度取最大、标签取并集）
5. **渲染**：Node 端直接拼 HTML（服务端渲染，无前端 JS 依赖），写到 `outputDir/index.html`

---

## 限制 / 注意

- **需要 Aurabot**：这是扩展模块，不是独立 App
- **评论定位会慢**：每条没定位过的评论要翻最多 12 页评论区（约 2-3 秒），有缓存后秒开
- **B 站风控**：不带 wbi 签名的评论接口会返回 HTML 而不是 JSON，本项目已用签名接口
- **cookie 归属**：`@` 昵称、官方观看历史都来自 Aurabot 配置里的 B 站 cookie（机器人账号）
- **隐私**：生成的是纯本地静态文件，不会上传任何数据；但页面里会有你账号的评论和观看记录，**别直接公开 index.html**

---

## 目录结构

```
dsh-activity-wall/
├── index.mjs                     # 模块本体（工具 + 生成逻辑）
├── templates/
│   └── activity-template.html    # 页面模板（服务端替换占位符）
├── package.json
├── README.md
└── LICENSE
```

---

## License

MIT
