/**
 * 上汽荣威 App · 看视频签到（插件版主脚本）
 * 每日自动完成 3 次「看视频签到」，每次 +5 积分
 *
 * Token 来源优先级：
 *   1. 插件参数 argument（手动填写）
 *   2. 自动捕获（打开捕获开关后，在荣威 App 里进一次签到页面即可）
 *
 * 【自动捕获 Token 使用方法】
 *   1. Loon → 插件 → 上汽荣威签到 → 设置 → 打开「捕获 Token」
 *   2. 打开上汽荣威 App →「我的」→ 进入签到页面（看到签到日历即可）
 *   3. 收到「Token 捕获成功」通知
 *   4. 回到插件设置，关闭「捕获 Token」
 *   完成！之后每天定时自动签到
 */

const args = typeof $argument !== "undefined" ? $argument : {};

// 优先用插件参数里手填的，否则用自动捕获的
let TOKEN = args.token || "";
let USERID = args.userid || "";

if (!TOKEN) {
  try {
    const saved = JSON.parse($persistentStore.read("roewe_token_info") || "{}");
    TOKEN = saved.token || "";
    USERID = saved.userid || USERID;
  } catch (e) {}
}

const API = "https://social.roewe.com.cn/api/energy/task";
const MAX_VIDEO = 3;
const $ = new Env("荣威签到");

function headers() {
  return {
    "token": TOKEN,
    "userid": USERID,
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

function get(path) {
  return new Promise((resolve) => {
    $.get({ url: API + path, headers: headers() }, (err, resp, body) => {
      try { resolve(JSON.parse(body)); } catch (e) { resolve(null); }
    });
  });
}

function post(path) {
  return new Promise((resolve) => {
    $.post({ url: API + path, headers: headers(), body: "" }, (err, resp, body) => {
      try { resolve(JSON.parse(body)); } catch (e) { resolve(null); }
    });
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async () => {
  // ① 没有 token，引导用户开启捕获
  if (!TOKEN) {
    $.notify(
      "荣威签到 · 还没有 Token",
      "请先开启「捕获 Token」",
      "插件设置 → 打开捕获开关 → 打开荣威 App 进入签到页面 → 收到捕获成功通知后关闭开关。"
    );
    $.done();
    return;
  }

  // ② 查询签到状态
  const status = await get("/getVideoSignIn?token=" + TOKEN);

  if (!status) {
    $.notify("荣威签到", "网络请求失败", "请确认 Loon 已启动、网络正常后重试");
    $.done();
    return;
  }

  if (status.resultCode !== 200) {
    $.notify(
      "荣威签到",
      "Token 已失效",
      "请打开插件里的「捕获 Token」开关，到荣威 App 重新进入签到页面即可自动更新"
    );
    $.done();
    return;
  }

  const done = status.data.signInCount || 0;

  // ③ 今日已签满
  if (done >= MAX_VIDEO) {
    $.notify("荣威签到", "今日已签到 ✅", "明天再来哦～");
    $.done();
    return;
  }

  // ④ 逐次签到
  const msgs = [];
  let gained = 0;
  for (let i = done; i < MAX_VIDEO; i++) {
    const r = await post("/videoSignIn");
    await sleep(2000);
    if (r && r.resultCode === 200 && r.success) {
      gained += Number(r.data) || 0;
      msgs.push(`第 ${i + 1}/3 次：+${r.data} 积分`);
    } else {
      break;
    }
  }

  if (gained > 0) {
    $.notify("荣威签到", `签到成功 +${gained} 积分 🎬`, msgs.join("\n"));
  } else {
    $.notify("荣威签到", "今日已签到 ✅", "明天再来哦～");
  }

  $.done();
})();

function Env(name) {
  this.name = name;
  this.notify = (t, s, c) => {
    if (typeof $notification !== "undefined") $notification.post(t, s, c);
  };
  this.get = (o, cb) => { if (typeof $httpClient !== "undefined") $httpClient.get(o, cb); };
  this.post = (o, cb) => { if (typeof $httpClient !== "undefined") $httpClient.post(o, cb); };
  this.done = () => { if (typeof $done !== "undefined") $done({}); };
}
