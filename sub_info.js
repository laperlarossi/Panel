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

/**
 * Safe & Stable Subscription Stats
 * * 特性：
 * 1. [安全] 日志自动脱敏：隐藏 URL 中的 Token 参数，防止截图泄露。
 * 2. [稳定] 增强错误捕获：网络超时或解析失败时平滑退出，不弹窗报错。
 * 3. [规范] 严格检查 HTTP 响应头，防止因数据格式变动导致的崩溃。
 */

const args = getArgs();

(async () => {
  try {
    // 1. 获取流量信息
    let info = await getDataInfo(args.url);
    if (!info) {
      safeLog("⚠️ 未获取到有效的流量信息，停止运行");
      $done();
      return;
    }

    // 2. 计算重置剩余天数 (增加容错)
    let resetDay = parseInt(args["reset_day"]);
    let resetDayLeft = (!isNaN(resetDay) && resetDay > 0 && resetDay <= 31) 
      ? getRemainingDays(resetDay) 
      : null;

    // 3. 组装显示内容
    let used = info.download + info.upload;
    let total = info.total;
    // 处理 expire 为 undefined 或 string 的情况
    let expire = args.expire || info.expire; 
    
    let content = [`用量：${bytesToSize(used)} | ${bytesToSize(total)}`];

    if (resetDayLeft !== null) {
      content.push(`重置：剩余 ${resetDayLeft} 天`);
    }

    if (expire && expire !== "false" && expire !== 0) {
      // 尝试自动转换时间戳（如果是纯数字字符串）
      if (/^[\d.]+$/.test(expire)) {
        expire = parseInt(expire);
        // 修正：有些机场返回的是秒(10位)，有些是毫秒(13位)
        if (expire.toString().length === 10) expire *= 1000;
      }
      content.push(`到期：${formatTime(expire)}`);
    }

    // 4. 获取当前时间
    let now = new Date();
    let hour = now.getHours().toString().padStart(2, '0');
    let minutes = now.getMinutes().toString().padStart(2, '0');

    // 5. 输出结果
    $done({
      title: `${args.title} | ${hour}:${minutes}`,
      content: content.join("\n"),
      icon: args.icon || "airplane.circle",
      "icon-color": args.color || "#007aff",
    });

  } catch (e) {
    safeLog(`❌ 脚本执行异常: ${e.message}`);
    $done();
  }
})();

// --- 核心工具函数 ---

function getArgs() {
  // 安全获取参数，防止 split 报错
  if (typeof $argument === 'undefined' || !$argument) return {};
  return Object.fromEntries(
    $argument
      .split("&")
      .map((item) => item.split("="))
      .map(([k, v]) => [k, decodeURIComponent(v || "")])
  );
}

function getUserInfo(url) {
  let method = args.method || "head"; // 默认使用 HEAD 请求节省流量
  // 注意：这里保留真实 URL 用于请求，但不打印
  let request = { 
    headers: { "User-Agent": "Quantumult%20X" }, 
    url: url 
  };

  return new Promise((resolve, reject) => {
    $httpClient[method](request, (err, resp) => {
      if (err) {
        // [安全] 不打印 err 对象的全部内容，因为它可能包含 URL
        reject("网络请求失败 (Network Error)");
        return;
      }
      if (resp.status !== 200) {
        reject(`服务器响应错误 (Status: ${resp.status})`);
        return;
      }
      
      // 查找 Header (忽略大小写)
      const headerKey = Object.keys(resp.headers).find(
        (key) => key.toLowerCase() === "subscription-userinfo"
      );
      
      if (headerKey && resp.headers[headerKey]) {
        resolve(resp.headers[headerKey]);
      } else {
        reject("响应头缺少 subscription-userinfo 字段");
      }
    });
  });
}

async function getDataInfo(url) {
  if (!url) {
    safeLog("⚠️ URL 参数缺失");
    return null;
  }

  try {
    const data = await getUserInfo(url);
    
    // [稳定] 增加数据格式校验
    if (typeof data !== 'string') return null;

    // 解析数据 upload=xxx; download=xxx; total=xxx; expire=xxx
    // 兼容分号或空格分隔
    const result = {};
    const regex = /(\w+)=([\d.eE+]+)/g;
    let match;
    while ((match = regex.exec(data)) !== null) {
      result[match[1]] = Number(match[2]);
    }
    
    // 必须包含 total 才算有效信息
    if (!result.hasOwnProperty('total')) {
        safeLog("⚠️ 数据解析失败，未找到 total 字段");
        return null;
    }

    return result;

  } catch (err) {
    // [安全] 捕获并打印脱敏后的 URL 错误信息
    safeLog(`❌ 获取流量失败: ${err} | URL: ${maskUrl(url)}`);
    return null;
  }
}

// --- 辅助计算与格式化 ---

function getRemainingDays(resetDay) {
  let now = new Date();
  let today = now.getDate();
  let year = now.getFullYear();
  let month = now.getMonth(); // 0-11

  let daysInMonth;

  // 如果重置日大于今天，说明还在本月重置周期内 (例如：今天是5号，10号重置，还剩5天)
  // 如果重置日小于等于今天，说明要等下个月 (例如：今天是20号，10号重置，要等下个月10号)
  
  if (resetDay > today) {
     // 这种算法比较简单：简单的倒计时
     return resetDay - today;
  } else {
    // 获取本月总天数
    // new Date(year, month + 1, 0) 获取下个月第0天，即本月最后一天
    let daysInCurrentMonth = new Date(year, month + 1, 0).getDate();
    return (daysInCurrentMonth - today) + resetDay;
  }
}

function bytesToSize(bytes) {
  if (bytes === 0 || isNaN(bytes)) return "0B";
  let k = 1024;
  let sizes = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
  let i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(2) + " " + sizes[i];
}

function formatTime(time) {
  if (!time) return "";
  try {
    let dateObj = new Date(time);
    // 检查时间是否有效
    if (isNaN(dateObj.getTime())) return "时间错误";
    
    let year = dateObj.getFullYear();
    let month = dateObj.getMonth() + 1;
    let day = dateObj.getDate();
    return `${year}年${month}月${day}日`;
  } catch (e) {
    return "格式错误";
  }
}

// [核心安全功能] URL 脱敏函数
function maskUrl(url) {
  if (!url) return "";
  try {
    // 简单的脱敏：保留域名，隐藏 query 参数
    if (url.includes('?')) {
        return url.split('?')[0] + "?***(HIDDEN)***";
    }
    return url;
  } catch (e) {
    return "Invalid URL";
  }
}

// 安全日志打印
function safeLog(msg) {
    console.log(`[TrafficChecker] ${msg}`);
}
