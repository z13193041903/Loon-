/**
 * 上汽荣威 · Token 自动捕获脚本
 * 由插件的 Rewrite 规则触发，自动抓取 token 和 userid 存入本地
 * 用户无需手动翻请求记录！
 */

const $ = new Env("荣威Token捕获");

const token = $request.headers?.token || $request.headers?.Token || "";
const userid = $request.headers?.userid || $request.headers?.UserID || "";

if (token && userid) {
  const old = JSON.parse($persistentStore.read("roewe_token_info") || "{}");
  if (old.token === token) {
    // token 没变，不打扰用户
    console.log("Token 未变化，跳过通知");
  } else {
    $persistentStore.write(
      JSON.stringify({ token: token, userid: userid }),
      "roewe_token_info"
    );
    $.notify(
      "荣威签到 · Token 捕获成功 ✅",
      "已自动保存，无需其他操作",
      "如果捕获开关还开着，请到插件设置里关闭「捕获 Token」，避免持续运行。"
    );
  }
} else {
  $.notify(
    "荣威签到 · Token 捕获失败 ❌",
    "没有在请求中找到 token",
    "请确认是在荣威 App 内操作（进入签到页面），而不是浏览器。"
  );
}

$.done({});

function Env(name) {
  this.name = name;
  this.notify = (t, s, c) => {
    if (typeof $notification !== "undefined") $notification.post(t, s, c);
  };
  this.done = (v) => { if (typeof $done !== "undefined") $done(v); };
}
