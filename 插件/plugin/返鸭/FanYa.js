/*
 * ============================================================
 * 返鸭返利比价 (FanYa Rebate & Price Trend) — Loon 脚本
 * ============================================================
 * 功能：
 *   1. 在淘宝 / 京东 / 拼多多商品详情页（首图下方楼层）注入
 *      「返鸭APP 预估返佣金额」
 *   2. 参考慢慢买，展示历史价格趋势并判断是否涨价
 *
 * 参数（由插件 [Argument] 经 argument=[A|B|C|D] 传入）：
 *   A = 返鸭 API 地址（留空则只显示比价）
 *   B = 返鸭 Token
 *   C = 是否显示返佣 (true/false)
 *   D = 是否显示价格趋势 (true/false)
 *
 * 比价数据来源：慢慢买历史价格接口（京东/淘宝/拼多多均按分享链接查询）
 * ============================================================
 */

const $ = new Env("返鸭返利");
const args = parseArguments(typeof $argument !== "undefined" ? $argument : "");

function parseArguments(s) {
    const raw = String(s).trim();
    const out = { api: "", token: "", showCommission: true, showTrend: true };
    if (!raw) return out;
    const kv = (key) => {
        const m = raw.match(new RegExp("(^|[&|\\[])" + key + "=([^&\\]]*)"));
        return m ? m[2].trim() : null;
    };
    out.api = kv("fanya_api") || kv("FANYA_API") || "";
    out.token = kv("fanya_token") || kv("FANYA_TOKEN") || "";
    const sc = kv("show_commission") || kv("SHOW_COMMISSION");
    const st = kv("show_trend") || kv("SHOW_TREND");
    if (sc !== null) out.showCommission = sc !== "false";
    if (st !== null) out.showTrend = st !== "false";
    // 兼容管道分隔格式 [api|token|c|t]
    if (!raw.includes("=")) {
        const parts = raw.replace(/^\[|\]$/g, "").split("|");
        out.api = (parts[0] || "").trim();
        out.token = (parts[1] || "").trim();
        out.showCommission = (parts[2] || "true") !== "false";
        out.showTrend = (parts[3] || "true") !== "false";
    }
    return out;
}

// ---------------- 路由 ----------------
const url = $request.url;
if (typeof $response === "undefined") { $done({}); }

const ROUTES = [
    { re: /api\.m\.jd\.com\/client\.action.*functionId=wareBusiness/,   platform: "jd",     type: "jd-app" },
    { re: /in\.m\.jd\.com\/product\/graphext\/\d+\.html/,               platform: "jd",     type: "h5" },
    { re: /trade-acs\.m\.taobao\.com\/gw\/mtop\.taobao\.detail\.getdetail/, platform: "taobao", type: "tb-app" },
    { re: /(item|detail\.m)\.(taobao|tmall)\.com\/(item|item_detail)\.htm/, platform: "taobao", type: "h5" },
    { re: /mobile\.yangkeduo\.com\/proxy\/api\/api\/oak\/integration\/render/, platform: "pdd", type: "pdd-app" },
    { re: /mobile\.yangkeduo\.com\/goods\.html/,                        platform: "pdd",    type: "h5" }
];

const route = ROUTES.find(r => r.re.test(url));
if (!route) { $done({}); }

const body = $response.body;

// ---------------- 主流程 ----------------
(async () => {
    try {
        const ctx = extractItem(route, url, body);
        if (!ctx || !ctx.id) { $done({}); return; }

        const [commission, trend] = await Promise.all([
            queryCommission(route.platform, ctx),
            queryTrend(ctx.shareUrl)
        ]);

        const panel = buildPanel(commission, trend);
        if (!panel) { $done({}); return; }

        const newBody = inject(route, body, ctx, panel);
        $done({ body: newBody || body });
    } catch (e) {
        console.log("[返鸭返利] 处理异常: " + (e && e.message || e));
        $done({});
    }
})();

// ---------------- 商品信息提取 ----------------
function extractItem(route, url, body) {
    try {
        switch (route.type) {
            case "jd-app": {
                const obj = JSON.parse(body);
                if (Number(obj && obj.code) > 0 && Number(obj && obj.wait) > 0) return null; // 风控
                const floors = obj.floors || [];
                const shareUrl = (floors[floors.length - 1] || {}).data?.property?.shareUrl
                    || `https://item.jd.com/${(url.match(/skuId=(\d+)/) || [])[1]}.html`;
                const id = (shareUrl.match(/(\d+)\.html/) || [])[1];
                return { id, shareUrl, obj };
            }
            case "tb-app": {
                const obj = JSON.parse(body);
                const item = obj.data && obj.data.item;
                if (!item || !item.itemId) return null;
                const id = String(item.itemId);
                return {
                    id,
                    shareUrl: `https://item.taobao.com/item.htm?id=${id}`,
                    title: item.title || "",
                    obj
                };
            }
            case "pdd-app": {
                const id = (body.match(/"goods_id"\s*:\s*(\d+)/) || [])[1];
                if (!id) return null;
                return {
                    id,
                    shareUrl: `https://mobile.yangkeduo.com/goods.html?goods_id=${id}`,
                    obj: JSON.parse(body)
                };
            }
            case "h5": {
                // 网页版：从 URL 提取商品 ID
                let id = null;
                if (route.platform === "jd") id = (url.match(/product\/graphext\/(\d+)\.html/) || [])[1];
                if (route.platform === "taobao") id = (url.match(/[?&]id=(\d+)/) || [])[1];
                if (route.platform === "pdd") id = (url.match(/[?&]goods_id=(\d+)/) || [])[1];
                if (!id) return null;
                const shareMap = {
                    jd: `https://item.jd.com/${id}.html`,
                    taobao: `https://item.taobao.com/item.htm?id=${id}`,
                    pdd: `https://mobile.yangkeduo.com/goods.html?goods_id=${id}`
                };
                return { id, shareUrl: shareMap[route.platform] };
            }
        }
    } catch (e) {
        return null;
    }
    return null;
}

// ---------------- 返鸭佣金查询 ----------------
// 约定接口：POST {API}/api/commission
//   Header: X-FanYa-Token
//   Body:   {"platform":"jd|taobao|pdd","item_id":"...","title":"...","share_url":"..."}
//   返回:   {"code":0,"data":{"commission":"12.50","rate":"8.5%","url":"fanya://convert?..."}}
function queryCommission(platform, ctx) {
    return new Promise(resolve => {
        if (!args.showCommission || !args.api) return resolve(null);
        const req = {
            url: args.api.replace(/\/+$/, "") + "/api/commission",
            headers: {
                "Content-Type": "application/json",
                "X-FanYa-Token": args.token,
                "User-Agent": "FanYa-Loon/1.0"
            },
            timeout: 10,
            body: JSON.stringify({
                platform: platform,
                item_id: String(ctx.id),
                title: ctx.title || "",
                share_url: ctx.shareUrl
            })
        };
        $.post(req, (err, resp, data) => {
            if (err) { console.log("[返鸭返利] 佣金接口请求失败: " + err); return resolve(null); }
            try {
                const j = JSON.parse(data);
                resolve(j && Number(j.code) === 0 ? j.data : null);
            } catch (_) { resolve(null); }
        });
    });
}

// ---------------- 慢慢买历史价格 ----------------
function queryTrend(shareUrl) {
    return new Promise(resolve => {
        if (!args.showTrend) return resolve(null);
        const req = {
            url: "https://apapia-history.manmanbuy.com/ChromeWidgetServices/WidgetServices.ashx",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
                "User-Agent": "iPhone/CFNetwork/Darwin"
            },
            timeout: 10,
            body: "methodName=getHistoryTrend&p_url=" + encodeURIComponent(shareUrl)
        };
        $.post(req, (err, resp, data) => {
            if (err) { console.log("[返鸭返利] 比价接口请求失败: " + err); return resolve(null); }
            try { resolve(JSON.parse(data)); } catch (_) { resolve(null); }
        });
    });
}

// ---------------- 面板文案组装 ----------------
function buildPanel(commission, trend) {
    const lines = [];
    let tip = "";

    if (args.showCommission) {
        if (commission && commission.commission) {
            let line = `🦆 返鸭预估返佣：¥${commission.commission}`;
            if (commission.rate) line += `（约 ${commission.rate}）`;
            lines.push(line);
        } else if (args.api) {
            lines.push("🦆 返鸭预估返佣：暂无佣金数据");
        }
    }

    if (args.showTrend) {
        if (trend && trend.ok === 1 && trend.single) {
            const s = trend.single;
            const lowerDate = $.time("yyyy-MM-dd", parseInt(String(s.lowerDateyh).match(/\d+/), 10));
            lines.push(`〽️ 历史最低：¥${s.lowerPriceyh}（${lowerDate}）`);
            const stats = trendStats(s.jiagequshiyh);
            if (stats) {
                const diff = (stats.current - stats.lowest.price);
                const verdict = diff > 0
                    ? `当前 ¥${stats.current}，比近期最低高 ¥${diff.toFixed(2)}，不建议现在入手 🔺涨价`
                    : diff < 0
                        ? `当前 ¥${stats.current}，低于历史记录 🔻降价`
                        : `当前 ¥${stats.current}，与近期最低持平 ✅可入手`;
                lines.push(verdict);
                lines.push(`30天最低 ¥${stats.lowest30.price}（${stats.lowest30.date}） / 90天最低 ¥${stats.lowest90.price}（${stats.lowest90.date}）`);
            }
            tip = (trend.PriceRemark && trend.PriceRemark.Tip || "") + "（仅供参考）";
        } else if (trend && trend.ok === 0) {
            lines.push("慢慢买：" + (trend.msg || "暂无历史价格"));
        } else {
            lines.push("慢慢买：比价服务暂不可用");
        }
    }

    if (!lines.length) return null;
    if (tip) lines.push(tip);
    return { text: lines.join("\n"), lines: lines };
}

function trendStats(jiagequshiyh) {
    try {
        const arr = JSON.parse(`[${jiagequshiyh}]`);
        const list = arr.map(i => ({ ts: i[0], price: parseFloat(i[1]) })).reverse().slice(0, 360);
        if (!list.length) return null;
        const current = list[0].price;
        const mk = () => ({ price: current, date: $.time("yyyy-MM-dd", list[0].ts) });
        const lowest = mk(), lowest30 = mk(), lowest90 = mk();
        list.forEach((item, idx) => {
            const date = $.time("yyyy-MM-dd", item.ts);
            if (item.price < lowest.price) { lowest.price = item.price; lowest.date = date; }
            if (idx < 30 && item.price < lowest30.price) { lowest30.price = item.price; lowest30.date = date; }
            if (idx < 90 && item.price < lowest90.price) { lowest90.price = item.price; lowest90.date = date; }
        });
        return { current, lowest, lowest30, lowest90 };
    } catch (e) { return null; }
}

// ---------------- 页面注入 ----------------
function inject(route, body, ctx, panel) {
    switch (route.type) {
        case "jd-app":  return injectJD(ctx.obj, panel);
        case "tb-app":  return injectTB(ctx.obj, panel);
        case "pdd-app": return injectPDD(ctx.obj, panel);
        case "h5":      return injectHTML(body, panel, ctx);
    }
    return null;
}

// 京东 App：在 wareBusiness 楼层中插入自定义文案楼层（首图/价格下方）
function injectJD(obj, panel) {
    if (!obj || !Array.isArray(obj.floors)) return null;
    const floor = {
        bId: "eCustom_flo_fanya",
        cf: { bgc: "#FFF7E6", spl: "empty" },
        data: {
            ad: {
                adword: panel.text,
                textColor: "#8C8C8C",
                color: "#F5A623",
                newALContent: true,
                hasFold: true,
                adLinkContent: "",
                adLink: ""
            }
        },
        mId: "bpAdword",
        refId: "eAdword_fanya_0001",
        sortId: 13,
        overHeight: 0,
        overlayToViewHeight: 0
    };
    const floors = obj.floors;
    let idx = floors.findIndex(f => f.mId === floor.mId || (f.sortId && f.sortId > floor.sortId));
    if (idx === -1) idx = floors.length;
    floors.splice(idx, 0, floor);
    return JSON.stringify(obj);
}

// 淘宝 App：在 apiStack 的 consumerProtection / tradeConsumerProtection 中插入条目
function injectTB(obj, panel) {
    try {
        const stack = obj.data && obj.data.apiStack && obj.data.apiStack[0];
        if (!stack) { fallbackNotify(panel); return null; }
        const value = JSON.parse(stack.value);
        const g = value.global ? value.global.data : value;
        const item = {
            icon: "https://s2.ax1x.com/2020/02/16/3STeIJ.png",
            title: "返鸭返利 & 价格趋势",
            name: "返鸭返利 & 价格趋势",
            desc: panel.text
        };
        if (g.tradeConsumerProtection) {
            const service = g.tradeConsumerProtection.tradeConsumerService;
            if (service && service.service && Array.isArray(service.service.items)) {
                service.service.items.unshift(item);
            }
        } else if (g.consumerProtection) {
            const cp = g.consumerProtection;
            if (cp.serviceProtection && cp.serviceProtection.basicService) {
                cp.serviceProtection.basicService.services.unshift(item);
            }
            if (Array.isArray(cp.items)) cp.items.unshift(item);
        } else {
            fallbackNotify(panel);
            return null;
        }
        stack.value = JSON.stringify(value);
        return JSON.stringify(obj);
    } catch (e) {
        fallbackNotify(panel);
        return null;
    }
}

// 拼多多 App：页面由 OAK 动态渲染，无稳定文案楼层。
// 策略：在响应 JSON 中附加自定义字段（供返鸭端或调试查看），并用通知兜底展示。
function injectPDD(obj, panel) {
    try {
        obj.fanya_rebate = {
            title: "返鸭返利 & 价格趋势",
            content: panel.lines
        };
        fallbackNotify(panel);
        return JSON.stringify(obj);
    } catch (e) { return null; }
}

// H5 网页：在 </body> 前注入卡片，JS 尝试移动到首图下方
function injectHTML(body, panel, ctx) {
    if (!body || body.indexOf("<") === -1) return null;
    const linesHtml = panel.lines
        .map(l => `<div class="fy-line">${escapeHtml(l)}</div>`).join("");
    const block = `
<div id="fanya-rebate-panel" style="margin:10px 12px;padding:12px;border-radius:10px;background:#FFF7E6;border:1px solid #F5A623;font-size:14px;line-height:1.7;color:#333;z-index:9999;position:relative;">
  <div style="font-weight:bold;color:#F5A623;margin-bottom:4px;">🦆 返鸭返利 · 慢慢买比价</div>
  ${linesHtml}
</div>
<script>(function(){
  var p=document.getElementById('fanya-rebate-panel');
  if(!p)return;
  var sels=['.gallery','#J_SlideShow','.slide-show','.image-gallery','.detail-gallery','.swiper-container'];
  for(var i=0;i<sels.length;i++){var t=document.querySelector(sels[i]);
    if(t&&t.parentNode){t.parentNode.insertBefore(p,t.nextSibling);return;}}
  document.body.insertBefore(p,document.body.firstChild);
})();</script>`;
    if (/<\/body>/i.test(body)) return body.replace(/<\/body>/i, block + "</body>");
    return body + block;
}

function fallbackNotify(panel) {
    $.notify("返鸭返利 · 比价", "", panel.text);
}

function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------------- 精简 Env（仅 Loon） ----------------
function Env(name) {
    this.name = name;
    this.get = (o, cb) => $httpClient.get(typeof o === "string" ? { url: o } : o, (e, r, d) => cb(e, r, d));
    this.post = (o, cb) => $httpClient.post(o, (e, r, d) => cb(e, r, d));
    this.read = k => $persistentStore.read(k);
    this.write = (v, k) => $persistentStore.write(v, k);
    this.notify = (t, s, b, o) => $notification.post(t, s, b, o || {});
    this.time = (fmt, ts) => {
        const d = ts ? new Date(ts) : new Date();
        const map = { "M+": d.getMonth() + 1, "d+": d.getDate(), "H+": d.getHours(), "m+": d.getMinutes(), "s+": d.getSeconds() };
        if (/(y+)/.test(fmt)) fmt = fmt.replace(RegExp.$1, (d.getFullYear() + "").substr(4 - RegExp.$1.length));
        for (const k in map) if (new RegExp("(" + k + ")").test(fmt))
            fmt = fmt.replace(RegExp.$1, RegExp.$1.length === 1 ? map[k] : ("00" + map[k]).substr(("" + map[k]).length));
        return fmt;
    };
}
