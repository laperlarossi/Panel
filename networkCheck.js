/*
 * Surge 网络详情面板 - 高稳定版 + 自动刷新 & 手动刷新
 * @Nebulosa-Cat + La Perla
 */

/* ==========================
   HTTP 请求封装
========================== */
class httpMethod {
    static _httpRequestCallback(resolve, reject, error, response, data) {
        if (error) reject(error);
        else resolve(Object.assign(response, { data }));
    }
    static get(option = {}) {
        return new Promise((resolve, reject) => {
            $httpClient.get(option, (error, response, data) => {
                this._httpRequestCallback(resolve, reject, error, response, data);
            });
        });
    }
    static post(option = {}) {
        return new Promise((resolve, reject) => {
            $httpClient.post(option, (error, response, data) => {
                this._httpRequestCallback(resolve, reject, error, response, data);
            });
        });
    }
}

/* ==========================
   日志工具
========================== */
class loggerUtil {
    constructor() { this.id = randomString(); }
    log(msg) { console.log(`[${this.id}] [LOG] ${msg}`); }
    error(msg) { console.log(`[${this.id}] [ERROR] ${msg}`); }
}
const logger = new loggerUtil();

function randomString(len = 6) {
    const chars = "ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678";
    let str = "";
    for (let i = 0; i < len; i++) str += chars.charAt(Math.floor(Math.random() * chars.length));
    return str;
}

function getFlagEmoji(code) {
    return String.fromCodePoint(...code.toUpperCase().split('').map(c => 127397 + c.charCodeAt()));
}

/* ==========================
   运营商映射
========================== */
function loadCarrierNames() {
    return {
        '460-00': '中国移动', '460-01': '中国联通', '460-03': '中国电信', '460-05': '中国电信',
        '466-11': '中華電信', '466-01': '遠傳電信', '466-97': '台灣大哥大',
        '454-00': 'CSL', '454-03': '3', '440-10': 'docomo', '450-03': 'SKT',
        '310-030': 'AT&T', '310-160': 'T-Mobile', '310-004': 'Verizon',
        '234-10': 'O2-UK', '515-02': 'Globe', '452-01': 'Mobifone'
        // ...可按需补充完整
    };
}

/* ==========================
   网络信息获取
========================== */
function getCellularInfo() {
    const radioMap = { 'GPRS':'2.5G','LTE':'4G','NR':'5G' };
    const carrierNames = loadCarrierNames();
    const cell = $network['cellular-data'];
    if (cell && !$network.wifi?.ssid) {
        const carrier = carrierNames[cell.carrier] || '蜂窝数据';
        return `${carrier} | ${radioMap[cell.radio] || cell.radio}`;
    }
    return '';
}

function getSSID() { return $network.wifi?.ssid; }

function getIP() {
    const { v4, v6 } = $network;
    let arr = [];
    if (!v4 && !v6) arr = ['网络可能切换','请手动刷新'];
    else {
        if (v4?.primaryAddress) arr.push(`v4：${v4.primaryAddress}`);
        if (v6?.primaryAddress) arr.push(`v6：${v6.primaryAddress}`);
        if (v4?.primaryRouter && getSSID()) arr.push(`Router v4：${v4.primaryRouter}`);
        if (v6?.primaryRouter && getSSID()) arr.push(`Router v6：${v6.primaryRouter}`);
    }
    return arr.join('\n') + '\n';
}

/* ==========================
   公网 IP 检测
========================== */
function getNetworkInfo(retryTimes = 5, retryInterval = 1000) {
    httpMethod.get('http://ip-api.com/json').then(res => {
        if (Number(res.status) > 300) throw new Error(`Request error: ${res.status}`);
        const info = JSON.parse(res.data);
        $done({
            title: getSSID() || getCellularInfo(),
            content: `[IP 地址]\n${getIP()}节点 IP：${info.query}\n节点 ISP：${info.isp}\n节点位置：${getFlagEmoji(info.countryCode)}${info.country} - ${info.city}`,
            icon: getSSID() ? 'wifi' : 'simcard',
            'icon-color': getSSID() ? '#005CAF' : '#F9BF45',
            'refreshable': true // 允许手动刷新
        });
    }).catch(err => {
        if (String(err).startsWith('Network changed')) {
            $network.wifi = undefined; $network.v4 = undefined; $network.v6 = undefined;
        }
        if (retryTimes > 0) {
            logger.error(err); logger.log(`Retry after ${retryInterval}ms`);
            setTimeout(() => getNetworkInfo(--retryTimes, retryInterval), retryInterval);
        } else {
            logger.error(err);
            $done({
                title: '发生错误',
                content: '无法获取网络信息\n请检查网络或手动刷新',
                icon: 'wifi.exclamationmark',
                'icon-color': '#CB1B45',
                'refreshable': true
            });
        }
    });
}

/* ==========================
   程序入口 + 自动刷新
========================== */
(() => {
    const retryTimes = 5, retryInterval = 1000;
    const surgeMaxTimeout = 29500;
    const scriptTimeout = retryTimes * 5000 + retryTimes * retryInterval;

    // 最大超时保护
    setTimeout(() => {
        logger.log("Script timeout");
        $done({
            title: "请求超时",
            content: "连接请求超时\n请手动刷新",
            icon: 'wifi.exclamationmark',
            'icon-color': '#CB1B45',
            'refreshable': true
        });
    }, Math.min(scriptTimeout, surgeMaxTimeout));

    // 初次执行
    logger.log("Script start");
    getNetworkInfo(retryTimes, retryInterval);

    // 自动刷新：每 30 秒更新一次
    setInterval(() => {
        logger.log("Auto refresh network info");
        getNetworkInfo(1, 1000);
    }, 30000);
})();
