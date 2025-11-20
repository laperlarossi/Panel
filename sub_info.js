/*
Surge配置参考注释，感谢@asukanana,感谢@congcong.

示例↓↓↓ 
----------------------------------------

[Proxy Group]
AmyInfo = select, policy-path=http://sub.info?url=机场节点链接&reset_day=1&alert=1, update-interval=3600

[Script]
Sub_info = type=http-request,pattern=http://sub\.info,script-path=https://raw.githubusercontent.com/laperlarossi/Panel/main/sub_info.js,timeout=10
----------------------------------------

脚本不用修改，直接配置就好。

先将带有流量信息的节点订阅链接encode，用encode后的链接替换"url="后面的[机场节点链接]

可选参数 &reset_day，后面的数字替换成流量每月重置的日期，如1号就写1，8号就写8。如"&reset_day=8",不加该参数不显示流量重置信息。

可选参数 &expire，机场链接不带expire信息的，可以手动传入expire参数，如"&expire=2022-02-01",注意一定要按照yyyy-MM-dd的格式。

可选参数 &alert，流量用量超过80%、流量重置2天前、流量重置、套餐快到期，这四种情况会发送通知，参数"title=xxx" 可以自定义通知的标题。如"&alert=1&title=AmyInfo",多个机场信息，且需要通知的情况，一定要加 title 参数，不然通知判断会出现问题
----------------------------------------
*/

let args = getArgsSafe();

(async () => {
  // 参数验证失败就退出
  if (!args.url || !isSafeUrl(args.url)) {
    console.log("Invalid or unsafe URL");
    return $done();
  }

  let info = await getDataInfoSafe(args.url);
  if (!info) return $done();

  let resetDayLeft = getRemainingDaysSafe(parseInt(args["reset_day"]));

  let used = info.download + info.upload;
  let total = info.total;
  let expire = args.expire || info.expire;

  let content = [`用量：${bytesToSizeSafe(used)} | ${bytesToSizeSafe(total)}`];

  if (resetDayLeft !== null) {
    content.push(`重置：剩余${resetDayLeft}天`);
  }

  if (expire && expire !== "false") {
    // 仅允许纯数字时间戳
    if (/^\d+$/.test(String(expire))) expire *= 1000;
    content.push(`到期：${formatTimeSafe(expire)}`);
  }

  let now = new Date();
  let hour = String(now.getHours()).padStart(2, "0");
  let minutes = String(now.getMinutes()).padStart(2, "0");

  $done({
    title: `${args.title || "订阅信息"} | ${hour}:${minutes}`,
    content: content.join("\n"),
    icon: args.icon || "airplane.circle",
    "icon-color": args.color || "#007aff",
  });
})();

/* --------------------
    安全增强功能区
-------------------- */

/** 安全的参数解析（不会因非法字符导致崩溃）*/
function getArgsSafe() {
  if (typeof $argument !== "string") return {};
  try {
    return Object.fromEntries(
      $argument
        .split("&")
        .map((i) => i.split("="))
        .map(([k, v]) => [k, decodeURIComponent(v || "")])
    );
  } catch (e) {
    console.log("Argument parse error", e);
    return {};
  }
}

/** URL校验：禁止外部注入恶意URL */
function isSafeUrl(url) {
  try {
    let u = new URL(url);

    // 必须是 HTTPS（防止中间人攻击）
    if (u.protocol !== "https:") return false;

    // 禁止 IP 地址（安全考虑，可按需放开）
    if (/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)) return false;

    // 禁止 file://、ftp:// 等协议
    return true;
  } catch {
    return false;
  }
}

/** method 白名单（防止恶意注入 POST） */
function safeHttpMethod(method) {
  const ALLOWED = ["head", "get"];
  return ALLOWED.includes(method?.toLowerCase()) ? method : "head";
}

/** 安全获取订阅流量信息 */
async function getDataInfoSafe(url) {
  const method = safeHttpMethod(args.method);
  const request = { url, headers: { "User-Agent": "Quantumult X" } };

  // 封装 promise 处理错误
  const [err, header] = await new Promise((resolve) => {
    $httpClient[method](request, (e, resp) => {
      if (e) return resolve([e, null]);
      if (!resp || resp.status !== 200) return resolve([resp?.status, null]);

      let key = Object.keys(resp.headers).find(
        (k) => k.toLowerCase() === "subscription-userinfo"
      );
      if (!key) return resolve(["无 subscription-userinfo 信息", null]);

      return resolve([null, resp.headers[key]]);
    });
  });

  if (err) {
    console.log("订阅获取失败:", err);
    return null;
  }

  // 仅允许 key=value 数字结构
  const items = header.match(/\b(upload|download|total|expire)=\d+(?:\.\d+)?\b/gi);
  if (!items) return null;

  return Object.fromEntries(
    items.map((i) => {
      let [k, v] = i.split("=");
      return [k.toLowerCase(), Number(v)];
    })
  );
}

/** 安全计算重置日期 */
function getRemainingDaysSafe(resetDay) {
  if (!resetDay || isNaN(resetDay)) return null;

  let now = new Date();
  let today = now.getDate();
  let month = now.getMonth();
  let year = now.getFullYear();
  let daysInMonth =
    resetDay > today ? 0 : new Date(year, month + 1, 0).getDate();

  return daysInMonth - today + resetDay;
}

/** 安全格式化大小 */
function bytesToSizeSafe(bytes) {
  if (typeof bytes !== "number" || bytes < 0) return "0B";
  if (bytes === 0) return "0B";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB"];
  let i = Math.floor(Math.log(bytes) / Math.log(k));

  i = Math.min(i, sizes.length - 1);

  return (bytes / Math.pow(k, i)).toFixed(2) + " " + sizes[i];
}

/** 安全输出日期 */
function formatTimeSafe(time) {
  let t = Number(time);
  if (isNaN(t)) return "未知";

  let d = new Date(t);
  if (isNaN(d.getTime())) return "未知";

  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}
