/**********************************************************
 * 捷停车 · 自动签到领停车币 (Loon)
 * 作者: KEMO
 * 版本: v1.1 (2026-11-12, 基于 App 6.5.8 / 60508 的真实抓包)
 *
 * v1.1 更新:
 * - 抓取登录信息的弹窗一辈子只弹第一次,之后静默保存
 * - 每天多次自动检查:已签到就不再打扰;没签到自动重试(默认3次)
 * - 掉线检测:登录失效时每天只提醒一次,请打开 App 即可恢复
 * - 结果通知更详细:每项领了多少、今日合计、余额、任务进度
 * - 新增「点我测试」手动入口,可立即运行一次
 *
 * 说明: 看视频任务(T02,60币)有广告平台的服务端校验,不能
 * 靠接口直接跳过。插件有实验开关(默认关),打开后每天试一次
 * 并把服务器的真实回复写进通知。
 **********************************************************/

const STORE_KEY = "jtc_account_v1";
const STATE_KEY = "jtc_day_state_v1";
const SECRET = "Uvn76f3KgH9jlO9pCxZA12Swr5TeYQ8d"; // 网关签名密钥(公开脚本中使用的同一把)
const MBR = "https://mbr.jparking.cn";
const SYT = "https://sytgate.jslife.com.cn";
const DEFAULT_UA = "JTC/6.5.8 (iPhone; iOS 26.6; Scale/3.00)";
const DEFAULT_VER = "60508";

// ---------- 小工具 ----------
function log(s) { console.log("[捷停车] " + s); }
function notify(sub, body) { try { $notification.post("捷停车签到", sub, body); } catch (e) {} }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = Math.random() * 16 | 0, v = c === "x" ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  }).toUpperCase();
}
function nowTs() { return String(Date.now()); }
function todayStr() {
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

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
function readJSON(key) { try { return JSON.parse($persistentStore.read(key) || "{}"); } catch (e) { return {}; } }
function loadAcc() { return readJSON(STORE_KEY); }
function saveAcc(acc) { $persistentStore.write(JSON.stringify(acc), STORE_KEY); }
function loadState() {
  const s = readJSON(STATE_KEY);
  if (s.date !== todayStr()) return { date: todayStr(), successNotified: false, failNotified: false, offlineNotified: false };
  return s;
}
function saveState(s) { $persistentStore.write(JSON.stringify(s), STATE_KEY); }
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

// ---------- 模式一:抓取登录信息(只弹第一次) ----------
function capture() {
  let acc = loadAcc();
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
    const firstTime = !acc.welcomed;
    const recapture = !!acc.needRecapture;
    if (acc.token) {
      acc.needRecapture = false;
      acc.welcomed = true;
      saveAcc(acc);
      if (firstTime) {
        log("登录信息首次保存成功");
        notify("登录信息已保存 ✅", "只提醒这一次，以后保存都静悄悄的。每天会自动签到领停车币。");
      } else if (recapture) {
        log("掉线后重新保存成功");
        notify("登录已恢复 ✅", "掉线后重新抓到了登录信息，自动签到继续。");
      } else {
        log("登录信息已静默更新");
      }
    }
  } catch (e) { log("抓取解析失败: " + e); }
  $done({});
}

// ---------- 参数 ----------
function getArgs() {
  let a = { browse: true, video: false, notify: true, retry: 3, manual: false };
  function applyObj(o) {
    const g = k => (typeof o[k] !== "undefined") ? o[k] : o[k.toUpperCase()];
    const asBool = v => (v === true || v === "true");
    if (typeof g("browse") !== "undefined") a.browse = asBool(g("browse"));
    if (typeof g("video") !== "undefined") a.video = asBool(g("video"));
    if (typeof g("notify") !== "undefined") a.notify = asBool(g("notify"));
    if (typeof g("manual") !== "undefined") a.manual = asBool(g("manual"));
    if (typeof g("retry") !== "undefined") { const n = parseInt(g("retry"), 10); if (!isNaN(n)) a.retry = Math.min(Math.max(n, 1), 5); }
  }
  try {
    let raw = (typeof $argument !== "undefined") ? $argument : null;
    if (typeof raw === "string") {
      const s = raw.trim();
      if (s.indexOf("=") > -1 && s.indexOf("{") !== 0) {
        const o = {};
        s.split("&").forEach(p => { const i = p.indexOf("="); if (i > 0) o[p.slice(0, i)] = p.slice(i + 1); });
        applyObj(o);
      } else { try { applyObj(JSON.parse(s)); } catch (e) {} }
    } else if (raw && !Array.isArray(raw)) applyObj(raw);
    else if (Array.isArray(raw)) {
      if (typeof raw[0] !== "undefined") a.browse = !!raw[0];
      if (typeof raw[1] !== "undefined") a.video = !!raw[1];
    }
  } catch (e) {}
  return a;
}

// ---------- 模式二:每日签到(带重试与防漏签) ----------
async function runDaily() {
  const args = getArgs();
  const state = loadState();
  let acc = loadAcc();

  function alertOffline(msg) {
    acc.needRecapture = true; saveAcc(acc);
    if (!state.offlineNotified || args.manual) {
      notify("可能掉线了 ⚠️", msg + "\n打开捷停车 App 停留几秒就会自动恢复，今天不会再重复提醒。");
      state.offlineNotified = true; saveState(state);
    } else log("掉线提醒今天已发过，静默");
  }

  if (!acc.token) {
    notify("还没抓到登录信息 ⚠️", "请先打开捷停车 App，进一次停车币页面，插件会自动保存。");
    return $done();
  }
  if (!acc.userId) acc.userId = userIdFromToken(acc.token);

  // 1) 刷新 token
  let tokenDead = false;
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
      } else if (r && (String(r.resultCode) === "10011" || String(r.resultCode) === "3126")) {
        tokenDead = true;
        log("token 已失效: " + JSON.stringify(r).slice(0, 150));
      } else { log("token 刷新未成功(继续用旧token试): " + JSON.stringify(r).slice(0, 120)); }
    } catch (e) { log("token 刷新网络出错(继续试): " + e); }
  }
  if (tokenDead) { alertOffline("登录信息已过期。"); return $done(); }

  const lines = [];
  let totalGain = 0;
  let progressDone = 0, progressTotal = 0;

  // 2) 签到(失败自动重试,每次都复查状态)
  progressTotal += 1;
  let signed = false, signInfo = null, lastErr = "";
  for (let attempt = 1; attempt <= args.retry && !signed; attempt++) {
    try {
      const sq = await mbrPost(acc, "/member-core-gateway/integral/v2/sign-in-task/query", {});
      if (sq && sq.success && sq.data) {
        signInfo = sq.data;
        if (sq.data.todaySingInTag) { signed = true; break; }
        const rc = await mbrPost(acc, "/member-core-gateway/integral/v2/task/receive-new",
          { taskNo: sq.data.taskNo || "T00", reqSource: "APP_JTC", osType: "IOS", platformType: "APP" });
        if (rc && rc.success && rc.data) {
          totalGain += rc.data.integralValue || 0;
          signInfo.gained = rc.data.integralValue;
          await sleep(1500);
          const chk = await mbrPost(acc, "/member-core-gateway/integral/v2/sign-in-task/query", {});
          if (chk && chk.success && chk.data && chk.data.todaySingInTag) { signed = true; signInfo = chk.data; signInfo.gained = rc.data.integralValue; }
          else lastErr = "领取后复查未显示已签到";
        } else { lastErr = (rc && rc.message) || "领取接口失败"; }
      } else { lastErr = (sq && sq.message) || "签到查询失败"; }
    } catch (e) { lastErr = String(e); }
    if (!signed && attempt < args.retry) { log("签到第" + attempt + "次未成功(" + lastErr + ")，5秒后重试"); await sleep(5000); }
  }
  if (signed) {
    progressDone += 1;
    if (signInfo && typeof signInfo.gained !== "undefined") lines.push("✅ 签到成功 +" + signInfo.gained + "币（连签第 " + (signInfo.continueDays || "?") + " 天）");
    else lines.push("✅ 今日已签到（连签第 " + ((signInfo && signInfo.continueDays) || "?") + " 天）");
  } else {
    lines.push("❌ 签到失败（已重试 " + args.retry + " 次）：" + lastErr);
  }

  // 3) 任务列表
  let tasks = [];
  try {
    const tq = await mbrPost(acc, "/member-core-gateway/integral/v2/task/query-new",
      { osType: "IOS", reqVersion: "V2.0", platformType: "APP" });
    if (tq && tq.success && Array.isArray(tq.data)) tasks = tq.data;
  } catch (e) { log("任务查询出错: " + e); }

  const doneStatus = ["DONE", "FINISH", "FINISHED", "RECEIVED", "COMPLETED"];
  for (const t of tasks) {
    const name = t.showTitle || t.taskNo;
    const isBrowse = t.operateType === "SKIP_BROWSE";
    const isVideo = t.operateType === "WATCH_VIDEO";
    if (!isBrowse && !isVideo && t.taskStatus !== "RECEIVE") continue;
    progressTotal += 1;
    if (doneStatus.indexOf(t.taskStatus) > -1) { progressDone += 1; continue; }
    if (t.taskStatus === "RECEIVE") {
      try {
        const rc = await mbrPost(acc, "/member-core-gateway/integral/v2/task/receive-new",
          { taskNo: t.taskNo, reqSource: "APP_JTC", osType: "IOS", platformType: "APP" });
        if (rc && rc.success && rc.data) { totalGain += rc.data.integralValue || 0; progressDone += 1; lines.push("✅ 领取「" + name + "」 +" + rc.data.integralValue + "币"); }
        else lines.push("⚠️ 「" + name + "」领取失败：" + ((rc && rc.message) || ""));
      } catch (e) { lines.push("⚠️ 「" + name + "」领取出错：" + e); }
      continue;
    }
    if (t.taskStatus !== "GOTO") continue;
    if (isBrowse && args.browse) {
      const wait = Math.min((t.browseSeconds || 5) + 3, 30);
      log("浏览任务「" + name + "」等待 " + wait + " 秒");
      await sleep(wait * 1000);
      try {
        const cp = await mbrPost(acc, "/member-core-gateway/integral/v2/task/complete",
          { taskNo: t.taskNo, reqSource: "APP_JTC", receiveTag: "false", osType: "IOS", platformType: "APP" });
        if (cp && cp.success) {
          const rc = await mbrPost(acc, "/member-core-gateway/integral/v2/task/receive-new",
            { taskNo: t.taskNo, reqSource: "APP_JTC", osType: "IOS", platformType: "APP" });
          if (rc && rc.success && rc.data) { totalGain += rc.data.integralValue || 0; progressDone += 1; lines.push("✅ 「" + name + "」 +" + rc.data.integralValue + "币"); }
          else lines.push("⚠️ 「" + name + "」已完成，领取失败：" + ((rc && rc.message) || ""));
        } else lines.push("⚠️ 「" + name + "」完成失败：" + ((cp && cp.message) || ""));
      } catch (e) { lines.push("⚠️ 「" + name + "」出错：" + e); }
    } else if (isVideo) {
      if (args.video) {
        try {
          const cp = await mbrPost(acc, "/member-core-gateway/integral/v2/task/complete",
            { taskNo: t.taskNo, reqSource: "APP_JTC", receiveTag: "false", osType: "IOS", platformType: "APP" });
          if (cp && cp.success) {
            const rc = await mbrPost(acc, "/member-core-gateway/integral/v2/task/receive-new",
              { taskNo: t.taskNo, reqSource: "APP_JTC", osType: "IOS", platformType: "APP" });
            if (rc && rc.success && rc.data) { totalGain += rc.data.integralValue || 0; progressDone += 1; lines.push("🎉 「看视频」实验成功 +" + rc.data.integralValue + "币"); }
            else lines.push("🎬 「看视频」实验：完成通过，领取失败：" + ((rc && rc.message) || ""));
          } else lines.push("🎬 「看视频」实验失败：" + ((cp && cp.message) || "被广告校验拦截"));
        } catch (e) { lines.push("🎬 「看视频」实验出错：" + e); }
      } else {
        lines.push("🎬 「看视频」 +" + t.integralValue + "币（需看广告，未做）");
      }
    }
  }

  // 4) 余额
  let balanceLine = "";
  try {
    const bal = await mbrPost(acc, "/member-core-gateway/integral/v2/balance/query", { reqSource: "APP_JTC" });
    if (bal && bal.success && bal.data) balanceLine = "💰 今日共 +" + totalGain + "币｜余额 " + bal.data.accountAmt + "币（可抵扣 " + bal.data.deductAmount + " 元）";
  } catch (e) { log("余额查询出错: " + e); }
  if (balanceLine) lines.push(balanceLine);
  lines.push("📊 今日任务进度 " + progressDone + "/" + progressTotal);

  const allDone = signed && progressDone >= progressTotal - (tasks.some(t => t.operateType === "WATCH_VIDEO" && !args.video) ? 1 : 0);
  log(lines.join("\n"));

  // 5) 通知策略:成功每天只报一次;失败(未签到)每天只提醒一次;手动测试必报
  if (!signed) {
    if (!state.failNotified || args.manual) {
      notify("签到未成功 ❌", lines.join("\n") + "\n今天后面的检查还会自动重试。");
      state.failNotified = true; saveState(state);
    } else log("失败提醒今天已发过，静默");
  } else if (args.manual || !state.successNotified) {
    if (args.notify || args.manual) notify(allDone ? "今日完成 ✅" : "今日结果", lines.join("\n"));
    state.successNotified = true; saveState(state);
  } else {
    log("今天已汇报过且已签到，本次检查静默");
  }
  $done();
}

// ---------- 入口 ----------
if (typeof $request !== "undefined") {
  capture();
} else {
  runDaily();
}
