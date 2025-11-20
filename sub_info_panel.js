/*
Surge配置参考注释，感谢@asukanana,感谢@congcong.

示例↓↓↓ 
----------------------------------------

[Script]
Sub_info = type=generic,timeout=10,script-path= https://raw.githubusercontent.com/laperlarossi/Panel/main/sub_info_panel.js,script-update-interval=0,argument=url=[URL encode 后的机场节点链接]&reset_day=1&title=AmyInfo&icon=bonjour&color=#007aff

[Panel]
Sub_info = script-name=Sub_info,update-interval=600

----------------------------------------

先将带有流量信息的节点订阅链接encode，用encode后的链接替换"url="后面的[机场节点链接]

（实在不会可以用这个捷径生成panel和脚本，https://www.icloud.com/shortcuts/3f24df391d594a73abd04ebdccd92584）

可选参数 &reset_day，后面的数字替换成流量每月重置的日期，如1号就写1，8号就写8。如"&reset_day=8",不加该参数不显示流量重置信息。

可选参数 &expire，机场链接不带expire信息的，可以手动传入expire参数，如"&expire=2022-02-01",注意一定要按照yyyy-MM-dd的格式。不希望显示到期信息也可以添加&expire=false取消显示。

可选参数"title=xxx" 可以自定义标题。

可选参数"icon=xxx" 可以自定义图标，内容为任意有效的 SF Symbol Name，如 bolt.horizontal.circle.fill，详细可以下载app https://apps.apple.com/cn/app/sf-symbols-browser/id1491161336

可选参数"color=xxx" 当使用 icon 字段时，可传入 color 字段控制图标颜色，字段内容为颜色的 HEX 编码。如：color=#007aff
----------------------------------------
*/

/*****************************************
 * Safe & Stable Subscription Stats
 * 版本：最终增强版（含 URL 脱敏 + 完善日计算）
 *****************************************/

const args = getArgsSafe();

(async () => {
  try {
    // URL 合法性校验
    if (!args.url || !isSafeUrl(args.url)) {
      safeLog(`❌ URL 无效或不安全：${maskUrl(args.url)}`);
      return $done();
    }

    // 获取订阅数据（带脱敏日志）
    let info = await getDataInfoSafe(args.url);
    if (!info) return $done();

    // resetDay 精准计算
    let resetDay = parseInt(args["reset_day"]);
    let resetDayLeft =
      !isNaN(resetDay) && resetDay > 0 && resetDay <= 31
        ? getRemainingDaysAccurate(resetDay)
        : null;

    // 使用量/总量
    let used = info.download + info.upload;
    let total = info.total;

    // 到期时间
    let expire = args.expire || info.expire;
    if (expire && expire !== "false") {
      if (/^\d+$/.test(expire)) {
        expire = Number(expire);
        if (expire.toString().length === 10) expire *= 1000;
      }
    }

    let content = [`用量：${bytesToSizeSafe(used)} | ${bytesToSizeSafe(total)}`];

    if (resetDayLeft !== null) content.push(`重置：剩余 ${resetDayLeft} 天`);
    if (expire) content.push(`到期：${formatTimeSafe(expire)}`);

    // 当前时间
    let now = new Date();
    let hour = String(now.getHours()).padStart(2, "0");
    let min = String(now.getMinutes()).padStart(2, "0");

    $done({
      title: `${args.title || "订阅信息"} | ${hour}:${min}`,
      content: content.join("\n"),
      icon: args.icon || "airplane.circle",
      "icon-color": args.color || "#007aff",
    });
  } catch (e) {
    safeLog(`❌ 脚本运行时异常：${e.message}`);
    $done();
  }
})();

/* -------------------------
 * 参数解析（安全版）
 * ------------------------- */
function getArgsSafe() {
  if (!$argument) return {};
  try {
    return Object.fromEntries(
      $argument.split("&").map((pair) => {
        let [key, val] = pair.split("=");
        return [key, decodeURIComponent(val || "")];
      })
    );
  } catch (e) {
    return {};
  }
}

/* -------------------------
 * URL 安全检查
 * ------------------------- */
function isSafeUrl(url) {
  try {
    let u = new URL(url);

    // 只允许 HTTPS
    if (u.protocol !== "https:") return false;

    // 禁止 IP，避免被引导访问恶意服务器
    if (/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)) return false;

    return true;
  } catch {
    return false;
  }
}

/* -------------------------
 * 订阅信息获取（含脱敏日志）
 * ------------------------- */
async function getDataInfoSafe(url) {
  const method = "head";
  const req = { url, headers: { "User-Agent": "Quantumult X" } };

  const [err, header] = await new Promise((resolve) => {
    $httpClient[method](req, (e, resp) => {
      if (e) return resolve([`网络错误`, null]);
      if (!resp || resp.status !== 200)
        return resolve([`状态码 ${resp?.status}`, null]);

      let key = Object.keys(resp.headers).find(
        (k) => k.toLowerCase() === "subscription-userinfo"
      );

      if (!key) return resolve(["响应头缺少 subscription-userinfo", null]);

      resolve([null, resp.headers[key]]);
    });
  });

  if (err) {
    safeLog(`❌ 获取流量失败：${err} | URL: ${maskUrl(url)}`);
    return null;
  }

  // 解析
  const result = {};
  const regex = /(upload|download|total|expire)=([\d.eE+-]+)/gi;
  let m;

  while ((m = regex.exec(header)) !== null) {
    result[m[1]] = Number(m[2]);
  }

  if (!result.total) {
    safeLog("⚠️ 流量解析失败，未包含 total 字段");
    return null;
  }

  return result;
}

/* -------------------------
 * resetDay 精准计算（完善版）
 * ------------------------- */
function getRemainingDaysAccurate(resetDay) {
  let now = new Date();
  let today = now.getDate();
  let year = now.getFullYear();
  let month = now.getMonth(); // 0-11

  if (resetDay > today) {
    return resetDay - today;
  } else {
    let daysInMonth = new Date(year, month + 1, 0).getDate();
    return daysInMonth - today + resetDay;
  }
}

/* -------------------------
 * 容错版 bytesToSize
 * ------------------------- */
function bytesToSizeSafe(bytes) {
  if (typeof bytes !== "number" || bytes <= 0) return "0B";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  let i = Math.floor(Math.log(bytes) / Math.log(k));

  i = Math.min(i, sizes.length - 1);

  return (bytes / Math.pow(k, i)).toFixed(2) + " " + sizes[i];
}

/* -------------------------
 * 时间格式化防错
 * ------------------------- */
function formatTimeSafe(ts) {
  if (!ts) return "";

  let d = new Date(ts);
  if (isNaN(d.getTime())) return "时间格式错误";

  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/* -------------------------
 * 日志脱敏
 * ------------------------- */
function maskUrl(url) {
  if (!url) return "";
  try {
    let u = new URL(url);
    return `${u.protocol}//${u.hostname}${u.pathname}?***`;
  } catch {
    return "Invalid URL";
  }
}

function safeLog(msg) {
  console.log(`[SafeSub][LOG] ${msg}`);
}
