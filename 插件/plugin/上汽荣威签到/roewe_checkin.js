/**
 * 上汽荣威 App · 看视频签到（插件版主脚本 v4）
 *
 * 功能：
 *   ✅ 每日自动看视频签到（+5积分/次）
 *   ✅ 多账号支持（家人一起挂）
 *   ✅ 网络失败自动重试
 *   ✅ 连续签到天数统计
 *   ✅ Token 失效自动提醒
 *   ✅ 通知/日志开关
 *
 * Token 来源优先级：插件参数手填 > 自动捕获（本地存储）
 */

const args = typeof $argument !== "undefined" ? $argument : {};

// ---------- 插件参数 ----------
const NOTIFY_ON = (args.notify ?? "true") === "true";
const DEBUG = (args.debug ?? "false") === "true";
const MAX_RETRY = 3;   // 网络失败重试次数
const DELAY_SEC = Math.max(parseInt(args.delay || "2", 10) || 2, 1);
let MAX_VIDEO = Math.min(parseInt(args.maxtimes || "3", 10) || 3, 3);

// ---------- 账号列表 ----------
// 支持多账号，格式：token1#userid1@token2#userid2（多个账号用 @ 分隔）
// 也兼容只填一个 token（不带 #）
function parseAccounts() {
  const list = [];
  const manual = (args.accounts || "").trim();
  if (manual) {
    manual.split("@").forEach((item) => {
      const [t, u] = item.trim().split("#");
      if (t) list.push({ token: t.trim(), userid: (u || "").trim() });
    });
  }
  // 单独的 token/userid 参数也兼容
  if ((args.token || "").trim()) {
    list.push({ token: args.token.trim(), userid: (args.userid || "").trim() });
  }
  // 自动捕获的
  if (list.length === 0) {
    try {
      const saved = JSON.parse($persistentStore.read("roewe_token_info") || "{}");
      if (saved.token) list.push({ token: saved.token, userid: saved.userid || "" });
    } catch (e) {}
  }
  return list;
}

const ACCOUNTS = parseAccounts();
const API = "https://social.roewe.com.cn/api/energy/task";
const $ = new Env("荣威签到");

function headers(acc) {
  return {
    "token": acc.token,
    "userid": acc.userid,
    "geolocation": "121.24,31.00",
    "x-client-id": "App",
    "app-type": "roewe",
    "os": "iOS",
    "osversion": "26.6",
    "brandcode": "1",
    "versioncode": "3.3.6",
    "model": "ehs",
    "user-agent": "RWApp_PD/3.3.6 (iPhone; iOS 26.6; Scale/3.00)",
    "content-type": "application/x-www-form-urlencoded",
    "origin": "https://vmall.roewe.com.cn",
    "referer": "https://vmall.roewe.com.cn/saic-mall/activity/",
    "accept": "application/json, text/plain, */*",
  };
}

// 带重试的请求
async function tryRequest(fn, label) {
  for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
    const result = await fn();
    if (result) return result;
    log(`⚠️ ${label} 第 ${attempt} 次请求失败${attempt < MAX_RETRY ? "，重试中..." : ""}`);
    if (attempt < MAX_RETRY) await sleep(2);
  }
  return null;
}

function get(acc, path) {
  return tryRequest(
    () =>
      new Promise((resolve) => {
        $.get({ url: API + path, headers: headers(acc) }, (err, resp, body) => {
          try { resolve(JSON.parse(body)); } catch (e) { resolve(null); }
        });
      }),
    path
  );
}

function post(acc, path) {
  return tryRequest(
    () =>
      new Promise((resolve) => {
        $.post({ url: API + path, headers: headers(acc), body: "" }, (err, resp, body) => {
          try { resolve(JSON.parse(body)); } catch (e) { resolve(null); }
        });
      }),
    path
  );
}

function sleep(sec) { return new Promise((r) => setTimeout(r, sec * 1000)); }

function log(msg) {
  if (DEBUG) console.log(msg);
}

function notify(title, sub, body) {
  if (NOTIFY_ON) $.notify(title, sub, body);
  console.log(`[${title}] ${sub}\n${body || ""}`);
}

// 从签到日历统计连续天数
function countStreak(detailList) {
  if (!Array.isArray(detailList)) return 0;
  let streak = 0;
  // 列表按日期返回，从最近往前数连续签到的
  for (let i = detailList.length - 1; i >= 0; i--) {
    if (detailList[i].signInStatus) streak++;
    else break;
  }
  return streak;
}

// ---------- 单账号签到流程 ----------
async function doCheckin(acc, index, total) {
  const who = total > 1 ? `账号${index + 1}` : "";
  const status = await get(acc, "/getVideoSignIn?token=" + acc.token);

  if (!status) {
    return `${who} ❌ 网络请求失败（已重试${MAX_RETRY}次）`;
  }
  if (status.resultCode !== 200) {
    return `${who} ⚠️ Token已失效，请开启捕获开关重新获取`;
  }

  const data = status.data || {};
  const streak = countStreak(data.videoSignInDetailResponseList);
  const done = data.signInCount || 0;
  const streakText = streak > 0 ? `（已连续签到${streak}天）` : "";

  if (done >= MAX_VIDEO) {
    return `${who} ✅ 今日已签到${streakText}，明天再来哦～`;
  }

  let gained = 0;
  const msgs = [];
  for (let i = done; i < MAX_VIDEO; i++) {
    const r = await post(acc, "/videoSignIn");
    await sleep(DELAY_SEC);
    if (r && r.resultCode === 200 && r.success) {
      gained += Number(r.data) || 0;
      msgs.push(`第${i + 1}次+${r.data}`);
    } else {
      break;
    }
  }

  if (gained > 0) {
    return `${who} 🎬 签到成功 +${gained}积分${streakText}\n${msgs.join("，")}`;
  }
  return `${who} ✅ 今日已签到${streakText}，明天再来哦～`;
}

// ---------- 主流程 ----------
(async () => {
  if (ACCOUNTS.length === 0) {
    notify(
      "荣威签到 · 还没有 Token",
      "请开启「捕获Token」后操作一次",
      "插件设置 → 打开捕获Token开关 → 打开荣威App进入签到页面 → 收到捕获成功通知后关闭开关。多账号可在「账号列表」参数中填写。"
    );
    $.done();
    return;
  }

  log(`共 ${ACCOUNTS.length} 个账号待签到`);

  const results = [];
  for (let i = 0; i < ACCOUNTS.length; i++) {
    const r = await doCheckin(ACCO
