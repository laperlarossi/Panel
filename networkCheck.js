/*
 * Surge 网络详情面板 — 强化版
 * 高质量 / 高安全 / 高稳定
 * 说明：兼容 Surge/Loon/Quantumult X 的常见 JS 运行环境
 */

/* ================== 配置区 ================== */
// 调试开关（true 会打印更多日志：仅在调试时开启）
const DEBUG = false;
// 每次 http 请求超时（ms）
const HTTP_TIMEOUT = 8000;
// ip-api 请求重试次数与间隔（可按需调整）
const DEFAULT_RETRY_TIMES = 3;
const DEFAULT_RETRY_INTERVAL = 1000;
/* ============================================ */

(function () {
  // 安全日志函数（会对 url 做脱敏）
  function safeLog(msg, url) {
    if (!DEBUG) return;
    if (url) msg = `${msg} | URL=${maskUrl(url)}`;
    console.log(`[NetPanel] ${msg}`);
  }

  // 简单脱敏：隐藏 query 与 token
  function maskUrl(url) {
    try {
      if (!url || typeof url !== "string") return "";
      const u = url.split("?")[0];
      return `${u}?***`;
    } catch (e) {
      return "URL_HIDDEN";
    }
  }

  /* ---------------- http 封装 ---------------- */
  class httpMethod {
    static _httpRequestCallback(resolve, reject, error, response, data) {
      if (error) {
        reject(error);
      } else {
        // 规范 response 返回结构，避免引用底层对象直接泄露
        const safeResp = {
          status: response?.status ?? response?.statusCode ?? 0,
          headers: response?.headers ?? {},
          data: data,
          responseURL: response?.responseURL ?? null,
        };
        resolve(safeResp);
      }
    }

    // 支持传入 string (url) 或 option 对象
    static get(option = {}) {
      return new Promise((resolve, reject) => {
        const opt = typeof option === "string" ? { url: option } : option;
        // 给 option 加超时（部分环境支持）
        opt.timeout = opt.timeout || HTTP_TIMEOUT;
        $httpClient.get(opt, (error, response, data) => {
          this._httpRequestCallback(resolve, reject, error, response, data);
        });
      });
    }

    static post(option = {}) {
      return new Promise((resolve, reject) => {
        const opt = typeof option === "string" ? { url: option } : option;
        opt.timeout = opt.timeout || HTTP_TIMEOUT;
        $httpClient.post(opt, (error, response, data) => {
          this._httpRequestCallback(resolve, reject, error, response, data);
        });
      });
    }
  }
  /* ------------------------------------------- */

  /* ------------ 工具与小函数 --------------- */
  function randomString(len = 6) {
    const chars = "ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678";
    let out = "";
    for (let i = 0; i < len; i++) {
      out += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return out;
  }

  function getFlagEmoji(countryCode = "") {
    try {
      return String.fromCodePoint(
        ...countryCode
          .toUpperCase()
          .split("")
          .map((c) => 127397 + c.charCodeAt())
      );
    } catch {
      return "";
    }
  }

  // carrier map（保留你的 mapping 但在函数内创建以避免全局污染）
  function loadCarrierNames() {
    return {
      '466-11': '中華電信', '466-92': '中華電信',
      '466-01': '遠傳電信', '466-03': '遠傳電信',
      '466-97': '台灣大哥大', '466-89': '台灣之星', '466-05': 'GT',
      '460-03': '中国电信', '460-05': '中国电信', '460-11': '中国电信',
      '460-01': '中国联通', '460-06': '中国联通', '460-09': '中国联通',
      '460-00': '中国移动', '460-02': '中国移动', '460-04': '中国移动', '460-07': '中国移动', '460-08': '中国移动',
      '460-15': '中国广电', '460-20': '中移铁通',
      '454-00': 'CSL', '454-02': 'CSL', '454-10': 'CSL', '454-18': 'CSL',
      '454-03': '3', '454-04': '3', '454-05': '3',
      '454-06': 'SMC HK', '454-15': 'SMC HK', '454-17': 'SMC HK',
      '454-09': 'CMHK', '454-12': 'CMHK', '454-13': 'CMHK',
      '440-00': 'Y!mobile', '440-10': 'docomo', '440-11': 'Rakuten', '440-20': 'SoftBank',
      '440-50': ' au', '440-51': ' au', '440-52': ' au', '440-53': ' au', '440-54': ' au',
      '441-00': 'WCP', '441-10': 'UQ WiMAX',
      '450-03': 'SKT', '450-05': 'SKT', '450-02': 'KT', '450-04': 'KT', '450-08': 'KT',
      '450-06': 'LG U+', '450-10': 'LG U+',
      // ...（其余 mapping 可按需补充） 
    };
  }

  function getCellularInfo() {
    const radioGeneration = {
      GPRS: "2.5G",
      CDMA1x: "2.5G",
      EDGE: "2.75G",
      WCDMA: "3G",
      HSDPA: "3.5G",
      CDMAEVDORev0: "3.5G",
      CDMAEVDORevA: "3.5G",
      CDMAEVDORevB: "3.75G",
      HSUPA: "3.75G",
      eHRPD: "3.9G",
      LTE: "4G",
      NRNSA: "5G",
      NR: "5G",
    };

    try {
      let cellularInfo = "";
      const carrierNames = loadCarrierNames();
      const cdata = $network && $network["cellular-data"] ? $network["cellular-data"] : null;
      if (cdata) {
        const carrierId = cdata.carrier;
        const radio = cdata.radio;
        if ((!$network || !$network.wifi || !$network.wifi.ssid) && radio) {
          cellularInfo = carrierNames[carrierId]
            ? `${carrierNames[carrierId]} | ${radioGeneration[radio] || radio} - ${radio}`
            : `蜂窝数据 | ${radioGeneration[radio] || radio} - ${radio}`;
        }
      }
      return cellularInfo;
    } catch (e) {
      return "";
    }
  }

  function getSSID() {
    try {
      return $network?.wifi?.ssid ?? null;
    } catch {
      return null;
    }
  }

  function getIP() {
    try {
      const { v4, v6 } = $network || {};
      let info = [];
      if (!v4 && !v6) {
        info = ["网络可能切换", "请手动刷新以重新获取 IP"];
      } else {
        if (v4?.primaryAddress) info.push(`v4：${v4.primaryAddress}`);
        if (v6?.primaryAddress) info.push(`v6：${v6.primaryAddress}`);
        if (v4?.primaryRouter && getSSID()) info.push(`Router v4：${v4.primaryRouter}`);
        if (v6?.primaryRouter && getSSID()) info.push(`Router v6：${v6.primaryRouter}`);
      }
      return info.join("\n") + "\n";
    } catch {
      return "无法获取本地 IP 信息\n";
    }
  }
  /* ------------------------------------------- */

  /* ------------- 获取远端 IP 信息 ------------- */
  // 支持重试的网络请求封装（用于 ip-api）
  async function fetchIpApiWithRetry(retryTimes = DEFAULT_RETRY_TIMES, retryInterval = DEFAULT_RETRY_INTERVAL) {
    const url = "http://ip-api.com/json";
    for (let attempt = 0; attempt <= retryTimes; attempt++) {
      try {
        safeLog(`请求 ip-api 尝试 #${attempt + 1}`, url);
        const resp = await httpMethod.get({ url: url, timeout: HTTP_TIMEOUT, headers: { "User-Agent": "NetPanel/1.0" } });
        const status = Number(resp.status || 0);
        if (status >= 200 && status < 300 && resp.data) {
          // 有些环境返回 Buffer 或对象，强制字符串
          const text = typeof resp.data === "string" ? resp.data : String(resp.data);
          // 解析 JSON（安全）
          try {
            const json = JSON.parse(text);
            return { ok: true, data: json, url: resp.responseURL || url };
          } catch (e) {
            // 若返回的是 HTML 页面或其他，继续重试或失败
            safeLog("ip-api 返回内容无法解析为 JSON", url);
            throw new Error("ip-api: invalid json");
          }
        } else {
          throw new Error(`http status ${status}`);
        }
      } catch (err) {
        safeLog(`ip-api 请求失败：${err}`, url);
        if (attempt < retryTimes) {
          await new Promise((res) => setTimeout(res, retryInterval));
          continue;
        }
        return { ok: false, error: err };
      }
    }
    return { ok: false, error: new Error("未知错误") };
  }
  /* ------------------------------------------- */

  /* --------------- 入口逻辑 ------------------ */
  (async function main() {
    const scriptId = randomString(6);
    safeLog(`Script start [${scriptId}]`);

    // 计算脚本总超时（保护机制）
    const retryTimes = DEFAULT_RETRY_TIMES;
    const retryInterval = DEFAULT_RETRY_INTERVAL;
    const surgeMaxTimeout = 29500;
    const scriptTimeout = Math.min(surgeMaxTimeout, retryTimes * HTTP_TIMEOUT + retryTimes * retryInterval + 2000);

    // 设置全局超时，避免脚本挂起
    let timeouted = false;
    const to = setTimeout(() => {
      timeouted = true;
      safeLog("Script timeout triggered");
      $done({
        title: "请求超时",
        content: "连接请求超时\n请检查网络状态后重试",
        icon: "wifi.exclamationmark",
        "icon-color": "#CB1B45",
      });
    }, scriptTimeout);

    try {
      const res = await fetchIpApiWithRetry(retryTimes, retryInterval);
      if (timeouted) return;
      clearTimeout(to);

      if (!res.ok) {
        throw res.error || new Error("获取 IP 信息失败");
      }

      const info = res.data;
      // 防护：至少必须有 query 字段
      if (!info || !info.query) {
        throw new Error("ip-api 返回无效数据");
      }

      const ssid = getSSID();
      const title = ssid || getCellularInfo() || "网络详情";
      const content =
        "[IP 地址]\n" +
        getIP() +
        `节点 IP：${info.query}\n` +
        `节点ISP：${info.isp || "未知"}\n` +
        `节点位置：${getFlagEmoji(info.countryCode || "")}${info.country || "未知"} - ${info.city || "未知"}`;

      $done({
        title: title,
        content: content,
        icon: ssid ? "wifi" : "simcard",
        "icon-color": ssid ? "#005CAF" : "#F9BF45",
      });
    } catch (err) {
      clearTimeout(to);
      safeLog(`Main error: ${err}`, "http://ip-api.com/json");
      $done({
        title: "发生错误",
        content: "无法获取当前网络信息\n请检查网络状态后重试",
        icon: "wifi.exclamationmark",
        "icon-color": "#CB1B45",
      });
    }
  })();
  /* ------------------------------------------- */
})();
