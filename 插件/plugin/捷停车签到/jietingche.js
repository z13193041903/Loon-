/**********************************************************
 * 捷停车 · 自动签到领停车币 (Loon)
 * 作者: KEMO
 * 版本: v1.0 (2026-11-12, 基于 App 6.5.8 / 60508 的真实抓包)
 *
 * 工作方式:
 * 1) 抓取模式: 打开捷停车 App 时,自动保存登录信息(token 等)
 * 2) 定时模式: 每天自动刷新 token -> 签到(T00) -> 浏览任务 -> 查余额 -> 通知
 *
 * 说明:
 * - 看视频任务(T02,60币) 经分析有广告平台的服务端校验,
 *   不能靠接口直接跳过。插件里有实验开关,默认关闭;
 *   打开后会试着领取一次,并把服务器的真实回复通知你。
 * - 本文件不保存你的账号信息,登录信息只存在 Loon 本地。
 **********************************************************/

const STORE_KEY = "jtc_account_v1";
const SECRET = "Uvn76f3KgH9jlO9pCxZA12Swr5TeYQ8d"; // 网关签名密钥(公开脚本中使用的同一把)
const MBR = "https://mbr.jparking.cn";
const SYT = "https://sytgate.jslife.com.cn";
const DEFAULT_UA = "JTC/6.5.8 (iPhone; iOS 26.6; Scale/3.00)";
const DEFAULT_VER = "60508";

// ---------- 小工具 ----------
function log(s) { console.log("[捷停车] " + s); }
function notify(sub, body) { try { $notification.post("捷停车 · 停车币", sub, body); } catch (e) {} }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = Math.random() * 16 | 0, v = c === "x" ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  }).toUpperCase();
}
function nowTs() { return String(Date.now()); }

// ---------- MD5 (RFC1321) ----------
function utf8Bytes(str) {
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) { bytes.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F)); }
    else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
      const cp = 0x10000 + ((c - 0xD800) << 10) + (str.charCodeAt(++i) - 0xDC00);
      bytes.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
    } else { bytes.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F)); }
  }
  return bytes;
}
function md5hex(input) {
  const S = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,
             5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
             4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,
             6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  const K = [];
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
  const bytes = utf8Bytes(input);
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 0; i < 8; i++) bytes.push((bitLen / Math.pow(2, 8 * i)) & 0xFF);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  function add() { let s = 0; for (let i = 0; i < arguments.length; i++) s += arguments[i]; return s | 0; }
  function rotl(x, n) { return (x << n) | (x >>> (32 - n)); }
  for (let off = 0; off < bytes.length; off += 64) {
    const M = [];
    for (let j = 0; j < 16; j++) {
      M[j] = bytes[off + j * 4] | (bytes[off + j * 4 + 1] << 8) | (bytes[off + j * 4 + 2] << 16) | (bytes[off + j * 4 + 3] << 24);
    }
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16)      { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D;          g = (3 * i + 5) % 16; }
      else             { F = C ^ (B | ~D);       g = (7 * i) % 16; }
      const tmp = D;
      D = C; C = B;
      B = add(B, rotl(add(A, F, K[i], M[g]), S[i]));
      A = tmp;
    }
    a0 = add(a0, A); b0 = add(b0, B); c0 = add(c0, C); d0 = add(d0, D);
  }
  function wordHex(n) {
    let s = "";
    for (let i = 0; i < 4; i++) s += ((n >> (8 * i)) & 0xFF).toString(16).padStart(2, "0");
    return s;
  }
  return wordHex(a0) + wordHex(b0) + wordHex(c0) + wordHex(d0);
}

// ---------- 签名: 参数按 key 排序 k=v 用 & 连接,末尾 &+密钥,MD5 大写 ----------
function signParams(obj) {
  const keys = Object.keys(obj).filter(k => k !== "sign").sort();
  const str = keys.map(k => k + "=" + obj[k]).join("&") + "&" + SECRET;
  return md5hex(str).toUpperCase();
}
function signedBody(obj) {
  const o = {};
  Object.keys(obj).forEach(k => o[k] = obj[k]);
  o.sign = signParams(o);
  return o;
}

// ---------- 存储 ----------
function loadAcc() {
  try { return JSON.parse($persistentStore.read(STORE_KEY) || "{}"); } catch (e) { return {}; }
}
function saveAcc(acc) { $persistentStore.write(JSON.stringify(acc), STORE_KEY); }
function userIdFromToken(token) {
  try {
    const p = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = p + "=".repeat((4 - p.length % 4) % 4);
    const json = JSON.parse(decodeURIComponent(escape(atob(pad))));
    return json.jti || "";
  } catch (e) { return ""; }
}

// ---------- HTTP ----------
function post(url, headers, bodyObj) {
  return new Promise((resolve, reject) => {
    $httpClient.post({ url: url, headers: headers, body: JSON.stringify(bodyObj) }, function (err, resp, data) {
      if (err) return reject(err);
      try { resolve(JSON.parse(data)); }
      catch (e) { reject("返回解析失败: " + String(data).slice(0, 120)); }
    });
  });
}
function mbrHeaders(acc) {
  return {
    "content-type": "application/json;charset=utf-8",
    "accept": "*/*",
    "accept-language": "zh-Hans-CN;q=1",
    "uc_id": acc.deviceId || "",
    "applicationversion": acc.appVer || DEFAULT_VER,
    "user-agent": acc.ua || DEFAULT_UA
  };
}
function mbrPost(acc, path, extra) {
  const base = {
    userId: acc.userId, signType: "MD5", applictionType: "APP",
    applictionVersion: acc.appVer || DEFAULT_VER, token: acc.token,
    timestamp: nowTs(), nonce: uuid()
  };
  const body = signedBody(Object.assign(base, extra || {}));
  return post(MBR + path, mbrHeaders(acc), body);
}

// ---------- 模式一:抓取登录信息 ----------
function capture() {
  const url = $request.url || "";
  let acc = loadAcc();
  const oldToken = acc.token;
  try {
    const body = JSON.parse($request.body || "{}");
    const headers = $request.headers || {};
    const ucId = headers["uc_id"] || headers["Uc_id"] || headers["UC_ID"];
    if (ucId) acc.deviceId = ucId;
    if (headers["user-agent"] || headers["User-Agent"]) acc.ua = headers["user-agent"] || headers["User-Agent"];
    if (body.deviceId) acc.deviceId = body.deviceId;
    if (body.token) acc.token = body.token;
    if (body.userId) acc.userId = body.userId;
    if (body.applictionVersion) acc.appVer = body.applictionVersion;
    if (!acc.userId && acc.token) acc.userId = userIdFromToken(acc.token);
    saveAcc(acc);
    if (acc.token && acc.token !== oldToken) {
      log("登录信息已更新并保存");
      notify("登录信息已保存 ✅", "以后每天会自动签到领停车币,不用管它了。");
    }
  } catch (e) { log("抓取解析失败: " + e); }
  $done({});
}

// ---------- 模式二:定时任务 ----------
function getArgs() {
  let browse = true, video = false, notifyOn = true;
  function applyObj(o) {
    const g = k => (typeof o[k] !== "undefined") ? o[k] : o[k.toUpperCase()];
    if (typeof g("browse") !== "undefined") browse = (g("browse") === true || g("browse") === "true");
    if (typeof g("video") !== "undefined") video = (g("video") === true || g("video") === "true");
    if (typeof g("notify") !== "undefined") notifyOn = (g("notify") === true || g("notify") === "true");
  }
  try {
    let a = (typeof $argument !== "undefined") ? $argument : null;
    if (typeof a === "string") {
      const s = a.trim();
      if (s.indexOf("=") > -1 && s.indexOf("{") !== 0) {
        const o = {};
        s.split("&").forEach(p => { const i = p.indexOf("="); if (i > 0) o[p.slice(0, i)] = p.slice(i + 1); });
        applyObj(o);
      } else { try { applyObj(JSON.parse(s)); } catch (e) {} }
    } else if (a && !Array.isArray(a)) applyObj(a);
    else if (Array.isArray(a)) {
      if (typeof a[0] !== "undefined") browse = !!a[0];
      if (typeof a[1] !== "undefined") video = !!a[1];
    }
  } catch (e) {}
  return { browse: browse, video: video, notify: notifyOn };
}

async function runDaily() {
  const args = getArgs();
  let acc = loadAcc();
  if (!acc.token) {
    notify("还没抓到登录信息 ⚠️", "请先打开捷停车 App,进一次「停车币/积分」页面,再等明天的自动运行。");
    return $done();
  }
  if (!acc.userId) acc.userId = userIdFromToken(acc.token);
  const lines = [];

  // 1) 刷新 token(能保活,避免 30 天过期)
  if (acc.deviceId) {
    try {
      const b = signedBody({
        deviceId: acc.deviceId, osType: "iOS", signType: "MD5", applictionType: "APP",
        applictionVersion: acc.appVer || DEFAULT_VER, token: acc.token,
        timestamp: nowTs(), nonce: uuid()
      });
      const r = await post(SYT + "/core-gateway/user/login/verify/token", mbrHeaders(acc), b);
      if (r && r.success && r.obj && r.obj.token) {
        acc.token = r.obj.token;
        if (r.obj.userId) acc.userId = r.obj.userId;
        saveAcc(acc);
        log("token 刷新成功");
      } else { log("token 刷新未成功: " + JSON.stringify(r).slice(0, 150)); }
    } catch (e) { log("token 刷新出错: " + e); }
  }

  try {
    // 2) 签到
    const sq = await mbrPost(acc, "/member-core-gateway/integral/v2/sign-in-task/query", {});
    if (sq && sq.success && sq.data) {
      if (!sq.data.todaySingInTag) {
        const rc = await mbrPost(acc, "/member-core-gateway/integral/v2/task/receive-new",
          { taskNo: sq.data.taskNo || "T00", reqSource: "APP_JTC", osType: "IOS", platformType: "APP" });
        if (rc && rc.success && rc.data) lines.push("✅ 签到成功 + " + rc.data.integralValue + " 停车币(连签 " + ((sq.data.continueDays || 0) + 1) + " 天)");
        else lines.push("❌ 签到领取失败: " + ((rc && rc.message) || "未知错误"));
      } else {
        lines.push("✅ 今天已经签到过了(连签 " + (sq.data.continueDays || 0) + " 天)");
      }
    } else { lines.push("❌ 签到查询失败,可能登录过期,请打开 App 一次"); }

    // 3) 任务列表
    const tq = await mbrPost(acc, "/member-core-gateway/integral/v2/task/query-new",
      { osType: "IOS", reqVersion: "V2.0", platformType: "APP" });
    const tasks = (tq && tq.success && Array.isArray(tq.data)) ? tq.data : [];
    for (const t of tasks) {
      const name = t.showTitle || t.taskNo;
      if (t.taskStatus === "RECEIVE" && t.taskNo !== "T00") {
        const rc = await mbrPost(acc, "/member-core-gateway/integral/v2/task/receive-new",
          { taskNo: t.taskNo, reqSource: "APP_JTC", osType: "IOS", platformType: "APP" });
        if (rc && rc.success && rc.data) lines.push("✅ 领取「" + name + "」 + " + rc.data.integralValue + " 停车币");
        continue;
      }
      if (t.taskStatus !== "GOTO") continue;
      if (t.operateType === "SKIP_BROWSE" && args.browse) {
        const wait = Math.min((t.browseSeconds || 5) + 3, 30);
        log("浏览任务「" + name + "」等待 " + wait + " 秒模拟浏览");
        await sleep(wait * 1000);
        const cp = await mbrPost(acc, "/member-core-gateway/integral/v2/task/complete",
          { taskNo: t.taskNo, reqSource: "APP_JTC", receiveTag: "false", osType: "IOS", platformType: "APP" });
        if (cp && cp.success) {
          const rc = await mbrPost(acc, "/member-core-gateway/integral/v2/task/receive-new",
            { taskNo: t.taskNo, reqSource: "APP_JTC", osType: "IOS", platformType: "APP" });
          if (rc && rc.success && rc.data) lines.push("✅ 「" + name + "」 + " + rc.data.integralValue + " 停车币");
          else lines.push("⚠️ 「" + name + "」已完成但领取失败: " + ((rc && rc.message) || ""));
        } else { lines.push("⚠️ 「" + name + "」完成失败: " + ((cp && cp.message) || "")); }
      } else if (t.operateType === "WATCH_VIDEO") {
        if (args.video) {
          const cp = await mbrPost(acc, "/member-core-gateway/integral/v2/task/complete",
            { taskNo: t.taskNo, reqSource: "APP_JTC", receiveTag: "false", osType: "IOS", platformType: "APP" });
          if (cp && cp.success) {
            const rc = await mbrPost(acc, "/member-core-gateway/integral/v2/task/receive-new",
              { taskNo: t.taskNo, reqSource: "APP_JTC", osType: "IOS", platformType: "APP" });
            if (rc && rc.success && rc.data) lines.push("🎉 「看视频」实验成功 + " + rc.data.integralValue + " 停车币");
            else lines.push("🎬 「看视频」实验:完成通过了但领取失败: " + ((rc && rc.message) || ""));
          } else {
            lines.push("🎬 「看视频」实验失败(在意料之中): " + ((cp && cp.message) || "被广告校验拦截"));
          }
        } else {
          lines.push("🎬 「看视频」 " + t.integralValue + " 币需看广告,已跳过(实验开关在插件设置里)");
        }
      }
    }

    // 4) 余额
    const bal = await mbrPost(acc, "/member-core-gateway/integral/v2/balance/query", { reqSource: "APP_JTC" });
    if (bal && bal.success && bal.data) {
      lines.push("💰 当前停车币 " + bal.data.accountAmt + " 个,可抵扣 " + bal.data.deductAmount + " 元");
    }
  } catch (e) {
    lines.push("❌ 运行出错: " + e);
  }

  log(lines.join("\n"));
  if (args.notify) notify("今日结果", lines.join("\n"));
  $done();
}

// ---------- 入口 ----------
if (typeof $request !== "undefined") {
  capture();
} else {
  runDaily();
}
