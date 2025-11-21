/**
 * Surge Panel - Network Probe (Option 2: 5MB download)
 * - Download speed (Mbps)
 * - Ping (ms)
 * - Jitter (ms)
 * - NAT info (public IPv4, is CGNAT)
 * - DNS resolution time (ms) via Cloudflare DoH
 * - IPv6 enabled?
 *
 * Best-effort NAT Type: Surge cannot fully run STUN/UDP, so we will not claim full NAT type here.
 */

const PERSIST_KEY = "netprobe:last";    // module will write here; panel reads first
const TEST_FILE_URL = "https://speed.hetzner.de/5MB.bin"; // 5MB test file
const DNS_DOH_URL = "https://cloudflare-dns.com/dns-query?name=www.google.com&type=A";
const IP_API_URL = "https://ifconfig.co/json"; // public IP service (returns JSON)
const HEAD_TIMEOUT = 15000;
const GET_TIMEOUT = 30000; // allow enough time for 5MB download
const PING_COUNT = 5;
const RETRY = 2;

(async () => {
  try {
    // 1) Try read cached result from module
    const cached = safeReadPersist();
    if (cached) {
      // if cached and recent (<30min), show it and concurrently refresh in background
      const ageMin = Math.floor((Date.now() - cached._ts) / 60000);
      if (ageMin <= 30) {
        renderPanel(cached, true);
        // background refresh (do not block panel)
        probeAll().then(res => safeWritePersist(res));
        return;
      }
    }

    // 2) No fresh cache => do live probe
    const res = await probeAll();
    safeWritePersist(res);
    renderPanel(res, false);
  } catch (e) {
    console.log("NetProbe panel error:", e);
    $done({
      title: "网络探测失败",
      content: "检测过程中发生错误，请稍后重试",
      icon: "wifi.exclamationmark",
      "icon-color": "#CB1B45",
    });
  }
})();

/* -------------------- 主流程 -------------------- */
async function probeAll() {
  const out = { _ts: Date.now() };
  // 1. public IP + ASN via ifconfig.co
  const ipInfo = await safeHttpJson(IP_API_URL, 8000).catch(e => null);
  out.public = ipInfo || null;

  // 2. DNS DOH time (Cloudflare)
  out.dns_ms = await timeDnsDoH(DNS_DOH_URL, 5000).catch(() => null);

  // 3. IPv6 enabled?
  out.ipv6_local = Boolean($network && $network.v6 && $network.v6.primaryAddress);
  // IPv6 NAT status: Surge cannot detect NAT66 reliably -> set unknown
  out.ipv6_nat = "Unknown";

  // 4. Ping (HTTP HEAD to small URL)
  const pingHost = "https://www.google.com/generate_204";
  const pingStats = await doPingHttp(pingHost, PING_COUNT, 3000).catch(() => null);
  out.ping = pingStats;

  // 5. Download test: download TEST_FILE_URL and measure throughput
  const speed = await downloadSpeedTest(TEST_FILE_URL, GET_TIMEOUT).catch(() => null);
  out.speed_mbps = speed; // number or null

  // 6. Jitter: from ping stats (stdev)
  out.jitter_ms = pingStats ? jitterFromSamples(pingStats.samples) : null;

  // 7. NAT/CGNAT check: if public IP exists and is in 100.64.0.0/10 -> CGNAT
  out.is_cgnat = out.public && out.public.ip ? isIpInRange(out.public.ip, "100.64.0.0/10") : null;

  // 8. NAT Type note (best-effort explanation)
  out.nat_type_note = "NAT Type: Not determinable inside Surge scripting. For accurate NAT type run STUN client (UDP) on PC or phone.";

  return out;
}

/* -------------------- 工具函数：HTTP/JSON with timeout -------------------- */
function safeHttpJson(url, timeout = 8000) {
  return new Promise((resolve, reject) => {
    let timer = setTimeout(() => reject("Timeout"), timeout);
    $httpClient.get({ url, timeout, headers: { "User-Agent": "NetProbe/1.0" } }, (err, resp, data) => {
      clearTimeout(timer);
      if (err) return reject(err);
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(e);
      }
    });
  });
}

/* -------------------- DNS (DoH) timing -------------------- */
function timeDnsDoH(url, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    let timer = setTimeout(() => reject("Timeout"), timeout);
    $httpClient.get({ url, headers: { Accept: "application/dns-json", "User-Agent": "NetProbe/1.0" }, timeout }, (err, resp, data) => {
      clearTimeout(timer);
      if (err) return reject(err);
      resolve(Date.now() - t0);
    });
  });
}

/* -------------------- HTTP ping (HEAD requests) -------------------- */
async function doPingHttp(url, count = 5, timeout = 3000) {
  const samples = [];
  for (let i = 0; i < count; i++) {
    try {
      const t0 = Date.now();
      await new Promise((resolve, reject) => {
        let timer = setTimeout(() => reject("Timeout"), timeout);
        $httpClient.head({ url, timeout, headers: { "User-Agent": "NetProbe/1.0" } }, (err, resp) => {
          clearTimeout(timer);
          if (err) return reject(err);
          resolve(resp);
        });
      });
      samples.push(Date.now() - t0);
      await sleep(200); // small gap
    } catch (e) {
      // if a single ping fails, push a large value? better to skip
      samples.push(timeout);
    }
  }
  // compute stats
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  return { samples, avg: Math.round(avg), min, max };
}

/* -------------------- Jitter (ms) from samples: compute mean absolute diff -------------------- */
function jitterFromSamples(samples) {
  if (!samples || samples.length < 2) return 0;
  let diffs = [];
  for (let i = 1; i < samples.length; i++) diffs.push(Math.abs(samples[i] - samples[i - 1]));
  const avg = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  return Math.round(avg);
}

/* -------------------- Download speed test (single GET of file) --------------------
 - returns Mbps (number)
 - downloads full body; environment may limit memory. 5MB is reasonable.
-------------------------------------------------- */
function downloadSpeedTest(url, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    let timer = setTimeout(() => reject("Timeout"), timeout);
    $httpClient.get({ url, timeout, headers: { "User-Agent": "NetProbe/1.0" } }, (err, resp, data) => {
      clearTimeout(timer);
      if (err) return reject(err);
      try {
        // data length in bytes
        let bytes = 0;
        if (typeof data === "string") bytes = new TextEncoder().encode(data).length;
        else if (data && data.length) bytes = data.length;
        else bytes = 0;
        const ms = Math.max(1, Date.now() - t0);
        const mbps = (bytes * 8) / (ms / 1000) / (1024 * 1024); // bits per second -> Mbps
        resolve(Number(mbps.toFixed(2)));
      } catch (e) {
        reject(e);
      }
    });
  });
}

/* -------------------- IP in CIDR check (IPv4 only) -------------------- */
function isIpInRange(ip, cidr) {
  try {
    const [range, bits] = cidr.split("/");
    const ipToLong = s => s.split(".").reduce((a,b)=>a*256+Number(b),0);
    const mask = ~((1 << (32 - Number(bits))) - 1) >>> 0;
    return (ipToLong(ip) & mask) === (ipToLong(range) & mask);
  } catch {
    return false;
  }
}

/* -------------------- Persistence helpers -------------------- */
function safeWritePersist(obj) {
  try {
    $persistentStore.write(JSON.stringify(obj), PERSIST_KEY);
  } catch (e) {
    console.log("Persist write failed", e);
  }
}
function safeReadPersist() {
  try {
    const s = $persistentStore.read(PERSIST_KEY);
    if (!s) return null;
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/* -------------------- Render Panel -------------------- */
function renderPanel(res, fromCache = false) {
  // build lines
  const lines = [];
  const tstamp = res._ts ? new Date(res._ts).toLocaleString() : new Date().toLocaleString();
  lines.push(`检测时间：${tstamp} ${fromCache ? "(缓存)" : ""}`);

  // speed
  if (res.speed_mbps != null) lines.push(`下载速度：${res.speed_mbps} Mbps`);
  else lines.push("下载速度：测试失败");

  if (res.ping) {
    lines.push(`延迟：${res.ping.avg} ms (min ${res.ping.min} ms, max ${res.ping.max} ms)`);
    if (res.jitter_ms != null) lines.push(`抖动：${res.jitter_ms} ms`);
  } else {
    lines.push("延迟：测试失败");
  }

  // DNS
  if (res.dns_ms != null) lines.push(`DNS 解析：${res.dns_ms} ms (DoH)`);
  else lines.push("DNS 解析：测试失败");

  // IPv4 / CGNAT
  if (res.public && res.public.ip) {
    lines.push(`公网 IPv4：${res.public.ip}`);
    lines.push(`ISP：${res.public.org || res.public.hostname || res.public.city || ""}`);
    const cg = res.is_cgnat === true ? "是" : res.is_cgnat === false ? "否" : "未知";
    lines.push(`是否 CGNAT：${cg}`);
  } else {
    lines.push("公网 IPv4：获取失败");
  }

  // IPv6
  lines.push(`本地 IPv6：${res.ipv6_local ? "已启用" : "未启用"}`);
  lines.push(`IPv6 NAT 状态：${res.ipv6_nat || "未知（Surge 无法精确判定）"}`);

  // NAT type note
  lines.push("");
  lines.push(res.nat_type_note);

  const iconColor = (res.speed_mbps && res.speed_mbps >= 20) ? "#34C759" : "#FF9500";

  $done({
    title: `网络测速 ${res.speed_mbps != null ? res.speed_mbps + " Mbps" : ""}`,
    content: lines.join("\n"),
    icon: "speedometer", 
    "icon-color": iconColor,
    "refreshable": true
  });
}

/* -------------------- helpers -------------------- */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
