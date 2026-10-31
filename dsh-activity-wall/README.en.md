# dsh-activity-wall · Activity Wall

English | [简体中文](README.md)


Turns a Bilibili (B站) account's **comments** and **watch history** into a **local web page**:

- Everything on one page: comments posted / videos watched on purpose / videos scrolled past
- **Click a card to open Bilibili**; comments deep-link to that exact comment (`#reply<rpid>`)
- **Just double-click to open** — no front-end JS, no network needed to view (data is fetched at build time)
- Every data source is configurable; missing sources are skipped gracefully

> This is an **extension module** for the [Aurabot](https://github.com/) QQ-bot plugin.
> It reads Aurabot's Bilibili data (comment records, local watch logs, official history) and renders a static page.

---

## Preview

```
大肥鱼的活动墙
Comments 13 (located 8) | Watched 44 (on purpose 4) | generated 2026-11-01 05:06

[Comments 13] [On purpose 4] [Scrolled past 40]

Comments
  ┌─────────────────────────────────────┐
  │ This flow is as complicated as...    │
  │ 《How to give your fish a cute voice》│
  │ ✓ Located exactly this comment ↗     │
  └─────────────────────────────────────┘

Watched on purpose
  《Six plugins: give your fish a soul》 [watched] [B站 history]
   at 803s   BV1jhn16GEcv   open video ↗

Scrolled past
  《Hurry up! Hurry up!》 [backfilled] [scrolled]  at 10s
```

---

## Install

1. Copy the whole folder into Aurabot's module directory:

```
<DSH data dir>/plugins-data/aurabot/modules/activity-wall/
├── index.mjs
└── templates/
    └── activity-template.html
```

On Windows that is usually:

```
C:\Users\<you>\.dsh\plugins-data\aurabot\modules\activity-wall\
```

2. Restart DSH (or click "reload modules" in the panel).

3. Once loaded, you (or the bot) get one new tool:

```
activity_wall    build the activity wall
```

A first build runs automatically ~8 seconds after loading.

---

## Configuration

Edit in the Aurabot panel (Modules → Activity Wall), or directly in `config.json` under `ext["activity-wall"]`:

| Key | Meaning | Default |
|---|---|---|
| `enabled` | Enable the module | `true` |
| `title` | Page title | `大肥鱼的活动墙` |
| `outputDir` | Where `index.html` is written | `D:\大肥鱼\活动墙` |
| `commentLogDir` | Comment log folder (`*.jsonl`) | `D:\大肥鱼\大肥鱼发的评论` |
| `watchLogDir` | Watch log folder (`*.jsonl`) | `D:\大肥鱼\大肥鱼的观看记录` |
| `coreBiliJson` | Path to Aurabot core `bili.json` | empty = auto-detect |
| `useBiliApi` | Fetch Bilibili official watch history | `true` |
| `locateComments` | Scan comment sections for `rpid` | `true` |
| `maxComments` / `maxWatches` | Max items rendered | `200` / `120` |

### Log formats

Comment log `commentLogDir/*.jsonl`, one JSON per line:

```json
{"t":"2026-11-01T04:11:45Z","bvid":"BV1jhn16GEcv","title":"Six plugins...","text":"the comment","mention":true,"rpid":318815896641}
```

Watch log `watchLogDir/*.jsonl`, one JSON per line:

```json
{"t":"2026-11-01T03:24:23Z","bvid":"BV15X3n6mEWy","title":"Fish in a basin","progress":13,"frames":3,"source":"owner-link"}
```

> `frames > 0` means frames were actually extracted and looked at; `source = owner-link` means the owner sent the link (counts as "watched on purpose").

---

## How it works

1. **Collect comments**: Aurabot core `bili.json` `history` (auto-browsing comments) + local comment logs
2. **Collect watches**: local watch logs + Bilibili official watch history (needs cookie)
3. **Locate comments**: use the wbi-signed endpoint `/x/v2/reply/wbi/main` to page through comment sections, match on `mid + text prefix`, obtain `rpid`, and build `https://www.bilibili.com/video/BVxxx/#reply<rpid>` deep links
   - If not found (under review / collapsed / buried), it is marked in red as "not located"; the card still opens the video
   - `rpid` results are cached in `modules-data/activity-wall/rpid-map.json`
4. **Merge & dedupe**: normalize titles, keep one card per video (latest time, max progress, union of tags)
5. **Render**: build HTML on the Node side (server-side rendering, zero front-end JS) and write to `outputDir/index.html`

---

## Limitations & notes

- **Requires Aurabot**: this is an extension module, not a standalone app
- **Locating is slow**: each uncached comment may page through up to 12 comment pages (~2-3s); afterwards it is instant
- **Bilibili anti-crawl**: comment endpoints without wbi signing return HTML instead of JSON — this project uses the signed endpoint
- **Cookie ownership**: `@` mentions and official watch history depend on the Bilibili cookie in Aurabot's config (the bot account)
- **Privacy**: the output is a purely local static file; nothing is uploaded — but the page contains your account's comments and watch history, **do not publish `index.html`**

---

## Layout

```
dsh-activity-wall/
├── index.mjs                     # module body (tools + build logic)
├── templates/
│   └── activity-template.html    # page template (placeholders replaced server-side)
├── package.json
├── README.md                     # Chinese
├── README.en.md                  # English (this file)
└── LICENSE
```

---

## License

MIT
