// DSH活动墙 —— 把一个 B 站账号的「发过的评论 + 看过的视频」生成一个本地网页。
//
// 用法：作为 Aurabot 扩展模块放进 plugins-data/aurabot/modules/activity-wall/，
// 重启后她会多出 activity_wall 工具；主人也可以直接调它重建页面。
//
// 数据来源（都可配置，缺了不报错）：
//   · Aurabot 核心的 bili.json          —— 自动刷 B 站时发的评论 / 看过的视频
//   · 本地 JSONL 留档（观看记录 / 评论） —— 模块自己记的
//   · B 站接口（可选，需要 cookie）      —— 官方观看历史 + 评论 rpid 定位
//
// 输出：一个自包含的 index.html（无 JS 依赖，双击就能看，点卡片跳 B 站）

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const d2 = (n) => String(n).padStart(2, '0');
const stamp = (ms) => {
  const d = new Date(ms || Date.now());
  return `${d.getFullYear()}-${d2(d.getMonth() + 1)}-${d2(d.getDate())} ${d2(d.getHours())}:${d2(d.getMinutes())}`;
};
const escHtml = (v) =>
  String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** 模块根目录（兼容 ESM：用 dataDir 反推 aurabot 数据根） */
function pluginDataRoot(api) {
  // dataDir('x') → <aurabot>/modules-data/<id>/x
  try {
    return resolve(api.dataDir('x'), '../../..');
  } catch {
    return '';
  }
}

/** @type {import('../aurabot').AurabotModule} */
export default {
  id: 'activity-wall',
  name: '活动墙',
  version: '0.1.0',
  api: 1,
  description: '把 B 站账号的评论和观看记录生成一个本地网页，点卡片直接跳视频/评论。',

  defaults: {
    enabled: true,
    title: '大肥鱼的活动墙',
    outputDir: 'D:\\大肥鱼\\活动墙',
    commentLogDir: 'D:\\大肥鱼\\大肥鱼发的评论',
    watchLogDir: 'D:\\大肥鱼\\大肥鱼的观看记录',
    coreBiliJson: '',
    useBiliApi: true,
    locateComments: true,
    maxComments: 200,
    maxWatches: 120,
  },
  settings: [
    { key: 'enabled', label: '启用', type: 'switch' },
    { key: 'title', label: '页面标题', type: 'text' },
    { key: 'outputDir', label: '页面输出目录', type: 'text', hint: '留空 = 数据根下的 activity-wall' },
    { key: 'commentLogDir', label: '评论留档目录', type: 'text', hint: '放 *.jsonl，每行 {t,bvid,title,text,mention}' },
    { key: 'watchLogDir', label: '观看留档目录', type: 'text', hint: '放 *.jsonl，每行 {t,bvid,title,progress,frames,source}' },
    { key: 'coreBiliJson', label: '核心 bili.json 路径', type: 'text', hint: 'Aurabot 核心的自动刷记录，留空 = 自动找' },
    { key: 'useBiliApi', label: '调用 B 站接口', type: 'switch', hint: '用来补官方观看历史' },
    { key: 'locateComments', label: '定位评论（rpid）', type: 'switch', hint: '会翻视频评论区，慢一些' },
  ],

  setup(api) {
    const log = api.log;
    const root = pluginDataRoot(api);
    const stateFile = () => api.dataDir('rpid-map.json');

    const dirOf = (key, fallback) => {
      const v = String(api.settings()[key] || '').trim();
      return v ? v : join(root, fallback);
    };
    const outputDir = () => {
      const v = String(api.settings().outputDir || '').trim();
      return v ? v : join(root, 'activity-wall');
    };
    const templatePath = () => join(root, 'modules', 'activity-wall', 'templates', 'activity-template.html');

    const cookie = () => String(api.config()?.bili?.cookie || '');
    const myMid = () => {
      const m = cookie().match(/DedeUserID=(\d+)/);
      return m ? Number(m[1]) : 0;
    };

    async function req(url, opts = {}) {
      const r = await fetch(url, {
        ...opts,
        headers: {
          'user-agent': UA,
          referer: 'https://www.bilibili.com/',
          origin: 'https://www.bilibili.com',
          cookie: cookie(),
          ...(opts.headers || {}),
        },
        signal: AbortSignal.timeout(20000),
      });
      return r.json().catch(() => ({ code: r.status }));
    }

    // ---------- 数据收集 ----------

    function readJsonlDir(dir) {
      const out = [];
      try {
        if (!dir || !existsSync(dir)) return out;
        for (const name of readdirSync(dir)) {
          if (!name.endsWith('.jsonl')) continue;
          const lines = readFileSync(join(dir, name), 'utf8').split('\n').filter(Boolean);
          for (const line of lines) {
            try {
              out.push(JSON.parse(line));
            } catch {}
          }
        }
      } catch {}
      return out;
    }

    function coreBiliPath() {
      const v = String(api.settings().coreBiliJson || '').trim();
      if (v) return v;
      return join(root, 'bili.json');
    }

    function coreHistory() {
      try {
        const j = JSON.parse(readFileSync(coreBiliPath(), 'utf8'));
        return Array.isArray(j.history) ? j.history : [];
      } catch {
        return [];
      }
    }

    function collectComments() {
      const all = [];
      // 核心自动刷：kind === 'comment'
      for (const h of coreHistory()) {
        if (!h || h.kind !== 'comment') continue;
        all.push({ at: Number(h.at) || 0, bvid: h.bvid || '', title: h.title || '', text: h.text || '', src: '自动刷', mention: false, rpid: null });
      }
      // 本地留档
      for (const c of readJsonlDir(dirOf('commentLogDir', 'comment-logs'))) {
        all.push({
          at: Date.parse(c.t) || 0,
          bvid: c.bvid || '',
          title: c.title || '',
          text: c.text || '',
          src: c.source === 'bili_comment_video' ? '主动发' : c.source || '模块',
          mention: !!c.mention,
          rpid: c.rpid || null,
        });
      }
      const seen = new Set();
      const uniq = [];
      for (const c of all) {
        const k = (c.bvid || '') + '|' + String(c.text).slice(0, 30);
        if (seen.has(k)) continue;
        seen.add(k);
        uniq.push(c);
      }
      uniq.sort((a, b) => b.at - a.at);
      return uniq.slice(0, Number(api.settings().maxComments) || 200);
    }

    function collectLocalWatches() {
      return readJsonlDir(dirOf('watchLogDir', 'watch-logs'));
    }

    async function biliHistory(limit) {
      if (api.settings().useBiliApi === false || !cookie()) return [];
      try {
        const j = await req(`https://api.bilibili.com/x/web-interface/history/cursor?ps=${Math.max(1, Math.min(50, limit || 30))}`);
        if (j.code !== 0) return [];
        return (j.data.list || []).map((x) => ({
          at: (x.view_at || 0) * 1000,
          bvid: x.bvid || (x.history && x.history.bvid) || '',
          title: x.title || '',
          progress: x.progress || 0,
          from: 'B站历史',
        }));
      } catch {
        return [];
      }
    }

    function mergeWatches(locals, hist, cap) {
      const items = [];
      for (const x of locals) {
        const frames = Number(x.frames) > 0;
        items.push({
          at: Date.parse(x.t) || 0,
          bvid: x.bvid || '',
          title: x.title || '',
          progress: Number(x.progress) || 0,
          tag: x.kind === 'trace' ? '补记' : frames ? '抽帧看' : '看过',
          owner: x.source === 'owner-link',
        });
      }
      for (const h of hist) items.push({ at: h.at, bvid: h.bvid, title: h.title, progress: h.progress, tag: '刷到', owner: false });

      const byKey = new Map();
      for (const it of items) {
        const norm = String(it.title || '').replace(/[\s\u3000\p{P}]/gu, '').slice(0, 24);
        const key = norm || 'b:' + it.bvid;
        const prev = byKey.get(key);
        if (!prev) {
          byKey.set(key, { ...it, tags: [it.tag], owner: it.owner });
          continue;
        }
        prev.at = Math.max(prev.at, it.at);
        prev.progress = Math.max(prev.progress, it.progress);
        if (String(it.title).length > String(prev.title).length) prev.title = it.title;
        if (!prev.tags.includes(it.tag)) prev.tags.push(it.tag);
        prev.owner = prev.owner || it.owner;
        if (!prev.bvid && it.bvid) prev.bvid = it.bvid;
      }
      const merged = [...byKey.values()].sort((a, b) => b.at - a.at).slice(0, cap);
      const special = merged.filter((x) => x.owner || x.tags.includes('抽帧看') || x.tags.includes('看过'));
      const rest = merged.filter((x) => !special.includes(x));
      return { merged, special, rest };
    }

    // ---------- 评论定位（rpid） ----------

    function loadMap() {
      try {
        return JSON.parse(readFileSync(stateFile(), 'utf8'));
      } catch {
        return {};
      }
    }
    function saveMap(m) {
      try {
        writeFileSync(stateFile(), JSON.stringify(m), 'utf8');
      } catch {}
    }
    const normText = (t) => String(t || '').replace(/[\s\u3000\p{P}]/gu, '').slice(0, 12);

    let wbi = { img: '', sub: '', at: 0 };
    async function wbiKeys() {
      if (wbi.img && Date.now() - wbi.at < 3600000) return wbi;
      const j = await req('https://api.bilibili.com/x/web-interface/nav');
      const img = (j.data?.wbi_img?.img_url || '').split('/').pop().split('.')[0];
      const sub = (j.data?.wbi_img?.sub_url || '').split('/').pop().split('.')[0];
      wbi = { img, sub, at: Date.now() };
      return wbi;
    }

    /** 调 /x/v2/reply/wbi/main 拿一页评论 */
    async function replyPage(aid, mode, pn) {
      try {
        const k = await wbiKeys();
        if (!k.img || !k.sub) return [];
        const params = { oid: String(aid), type: '1', mode: String(mode), pn: String(pn), ps: '20', plat: '1', web_location: '1315875' };
        const blib = api.lib('bili/api.js');
        const signed = blib.wbiSign(params, k.img, k.sub);
        const qs = typeof signed === 'string' ? signed : new URLSearchParams(signed).toString();
        const j = await req('https://api.bilibili.com/x/v2/reply/wbi/main?' + qs);
        return j.data?.replies || [];
      } catch {
        return [];
      }
    }

    async function aidOf(bvid) {
      if (!bvid) return 0;
      const j = await req('https://api.bilibili.com/x/web-interface/view?bvid=' + encodeURIComponent(bvid));
      return j.code === 0 ? j.data.aid : 0;
    }

    async function findRpid(bvid, text) {
      const aid = await aidOf(bvid);
      if (!aid) return null;
      const want = normText(text);
      const me = myMid();
      for (const mode of [3, 2]) {
        const maxPage = mode === 3 ? 12 : 5;
        for (let pn = 1; pn <= maxPage; pn++) {
          const list = await replyPage(aid, mode, pn);
          if (!list.length) break;
          for (const r of list) {
            if (me && Number(r.mid) !== me) continue;
            const got = normText(r.content?.message);
            if (!want || got.startsWith(want.slice(0, 8)) || want.includes(got.slice(0, 8))) return r.rpid;
          }
        }
      }
      return null;
    }

    async function locate(comments) {
      if (api.settings().locateComments === false || !cookie()) return 0;
      const map = loadMap();
      let hit = 0;
      for (const c of comments) {
        if (c.rpid) {
          hit++;
          continue;
        }
        const key = (c.bvid || '') + '|' + normText(c.text);
        if (map[key]) {
          c.rpid = map[key];
          hit++;
          continue;
        }
        if (!c.bvid) continue;
        const rpid = await findRpid(c.bvid, c.text);
        if (rpid) {
          c.rpid = rpid;
          map[key] = rpid;
          saveMap(map);
          hit++;
        }
      }
      return hit;
    }

    // ---------- 生成页面 ----------

    function cardComment(c) {
      const base = c.bvid ? 'https://www.bilibili.com/video/' + c.bvid : 'https://www.bilibili.com';
      const url = c.rpid ? base + '/#reply' + c.rpid : base;
      const tag = c.mention ? '<div class="tag mention">@TA</div>' : '<div class="tag">' + escHtml(c.src) + '</div>';
      const loc = c.rpid
        ? '<span class="loc ok">✓ 已定位到这条评论</span>'
        : '<span class="loc no">○ 未定位（可能审核中/被折叠）</span>';
      return (
        '<a class="card" href="' + escHtml(url) + '" target="_blank" rel="noopener">' + tag +
        '<div class="txt">' + escHtml(c.text) + '</div>' +
        '<div class="meta"><span class="t" style="margin:0">《' + escHtml(c.title || '（无标题）') + '》</span></div>' +
        '<div class="meta">' + escHtml(stamp(c.at)) + '</div>' +
        '<div class="meta">' + loc + '<span class="hint">点卡片跳评论区 ↗</span></div>' +
        '</a>'
      );
    }

    function cardWatch(c, special) {
      const url = c.bvid ? 'https://www.bilibili.com/video/' + c.bvid : 'https://www.bilibili.com';
      const tags = c.tags
        .map((t) => {
          const cls = t === '抽帧看' ? 'tag frame' : t === '补记' ? 'tag trace' : c.owner ? 'tag owner' : 'tag';
          return '<span class="' + cls + '">' + escHtml(t) + '</span>';
        })
        .join('');
      return (
        '<a class="card watch' + (special ? ' special' : '') + '" href="' + escHtml(url) + '" target="_blank" rel="noopener">' +
        '<div class="t">《' + escHtml(c.title || '（无标题）') + '》</div>' +
        '<div class="tags">' + tags + '</div>' +
        '<div class="meta"><span>' + escHtml(stamp(c.at)) + '</span>' +
        (c.progress ? '<span class="prog">看到 ' + escHtml(c.progress) + 's</span>' : '') +
        '<span>' + escHtml(c.bvid || '') + '</span>' +
        '<span class="hint">点卡片打开视频 ↗</span></div>' +
        '</a>'
      );
    }

    async function build() {
      try {
        const comments = collectComments();
        const located = await locate(comments);
        const locals = collectLocalWatches();
        const hist = await biliHistory(30);
        const { merged, special, rest } = mergeWatches(locals, hist, Number(api.settings().maxWatches) || 120);

        const tplPath = templatePath();
        if (!existsSync(tplPath)) throw new Error('找不到模板：' + tplPath);
        let tpl = readFileSync(tplPath, 'utf8');

        const title = String(api.settings().title || '活动墙');
        const count = `评论 ${comments.length} 条（已定位 ${located}）｜观看 ${merged.length} 个（特意看的 ${special.length}）｜生成于 ${stamp()}`;
        tpl = tpl
          .replace(/__TITLE__/g, escHtml(title))
          .replace(/__COUNT__/g, escHtml(count))
          .replace(/__C_N__/g, comments.length + ' 条')
          .replace(/__S_N__/g, special.length + ' 个')
          .replace(/__R_N__/g, rest.length + ' 个')
          .replace('__COMMENTS__', comments.map(cardComment).join('') || '<div class="empty">还没有评论</div>')
          .replace('__SPECIAL__', special.map((c) => cardWatch(c, true)).join('') || '<div class="empty">还没有特意看过的视频</div>')
          .replace('__REST__', rest.map((c) => cardWatch(c, false)).join('') || '<div class="empty">还没有</div>');

        const outDir = outputDir();
        mkdirSync(outDir, { recursive: true });
        const outFile = join(outDir, 'index.html');
        writeFileSync(outFile, tpl, 'utf8');
        writeFileSync(join(outDir, 'data.json'), JSON.stringify({ comments: comments.length, located, watches: merged.length, special: special.length, generatedAt: new Date().toISOString() }, null, 2), 'utf8');

        log.info(`[activity-wall] 已生成 ${outFile}（评论 ${comments.length}，观看 ${merged.length}）`);
        return { ok: true, path: outFile, comments: comments.length, located, watches: merged.length, special: special.length };
      } catch (e) {
        return { ok: false, message: '生成失败：' + e.message };
      }
    }

    api.tool(() => {
      if (!api.settings().enabled) return [];
      return [
        api.defineTool({
          name: 'activity_wall',
          description: '把评论和观看记录生成一个本地网页（双击就能看，点卡片跳 B 站）。',
          properties: {},
          required: [],
          execute: async () => {
            const r = await build();
            if (!r.ok) return r;
            return {
              ok: true,
              message: `活动墙生成好了：${r.path}\n评论 ${r.comments} 条（已定位 ${r.located}）｜观看 ${r.watches} 个（特意看的 ${r.special}）`,
            };
          },
        }),
      ];
    });

    api.rule(() =>
      api.settings().enabled
        ? ['【你有活动墙】', 'activity_wall 能把她/B 站账号的评论和观看记录生成一个网页，主人想看时调一下就行。'].join('\n')
        : '',
    );

    api.route('/state', async () => ({
      ok: true,
      outputDir: outputDir(),
      template: templatePath(),
      hasCookie: !!cookie(),
    }));

    api.later(8000, () => {
      build().catch(() => {});
    });

    log.info('[activity-wall] 已加载');
    return {};
  },
};
