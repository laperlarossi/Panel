/*
 * 流媒体解锁检测面板
 * 高质量、高安全、高稳定
 * @Author ChatGPT
 */

const REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.61 Safari/537.36',
  'Accept-Language': 'en',
}

// 状态枚举
const STATUS_COMING = 2        // 即将登陆
const STATUS_AVAILABLE = 1     // 已解锁
const STATUS_NOT_AVAILABLE = 0 // 不支持解锁
const STATUS_TIMEOUT = -1      // 检测超时
const STATUS_ERROR = -2        // 异常

const UA = REQUEST_HEADERS['User-Agent']

// ------------------------- 日志封装 -------------------------
class Logger {
  static log(msg) { console.log(`[LOG] ${msg}`) }
  static error(msg) { console.log(`[ERROR] ${msg}`) }
}

// ------------------------- 通用函数 -------------------------
function timeoutPromise(ms, rejectMsg='Timeout') {
  return new Promise((_, reject) => setTimeout(() => reject(rejectMsg), ms))
}

// 封装网络请求，支持超时
async function safeGet(url, headers = {}, timeoutMs = 5000) {
  return Promise.race([
    new Promise((resolve, reject) => {
      $httpClient.get({ url, headers }, (err, resp, data) => {
        if (err) return reject(err)
        if (resp.status !== 200) return reject('Not Available')
        resolve(data)
      })
    }),
    timeoutPromise(timeoutMs)
  ])
}

async function safePost(url, headers = {}, body = {}, timeoutMs = 5000) {
  return Promise.race([
    new Promise((resolve, reject) => {
      $httpClient.post({ url, headers, body: JSON.stringify(body) }, (err, resp, data) => {
        if (err) return reject(err)
        if (resp.status !== 200) return reject('Not Available')
        resolve(data)
      })
    }),
    timeoutPromise(timeoutMs)
  ])
}

// 重试机制
async function retry(func, times = 3, interval = 1000) {
  let lastError
  for (let i=0;i<times;i++){
    try { return await func() }
    catch(e){ lastError = e; await new Promise(r=>setTimeout(r, interval)) }
  }
  throw lastError
}

// 获取 Disney+ 区域信息
async function testDisneyPlus() {
  try {
    // 测试首页
    let homepage = await retry(async () => {
      let data = await safeGet('https://www.disneyplus.com/', REQUEST_HEADERS, 5000)
      if (data.indexOf('Sorry, Disney+ is not available in your region.') !== -1)
        throw 'Not Available'
      let match = data.match(/Region: ([A-Za-z]{2})[\s\S]*?CNBL: ([12])/)
      return { region: match?.[1] ?? '', cnbl: match?.[2] ?? '' }
    }, 2, 1000)

    // 获取位置和解锁状态
    let locationInfo = await retry(async () => {
      const body = {
        query: 'mutation registerDevice($input: RegisterDeviceInput!) { registerDevice(registerDevice: $input) { grant { grantType assertion } } }',
        variables: {
          input: {
            applicationRuntime: 'chrome',
            attributes: {
              browserName: 'chrome',
              browserVersion: '94.0.4606.61',
              manufacturer: 'apple',
              model: null,
              operatingSystem: 'macintosh',
              operatingSystemVersion: '10.15.7',
              osDeviceIds: [],
            },
            deviceFamily: 'browser',
            deviceLanguage: 'en',
            deviceProfile: 'macosx',
          }
        }
      }
      let data = await safePost('https://disney.api.edge.bamgrid.com/graph/v1/device/graphql', {
        'User-Agent': UA,
        'Accept-Language': 'en',
        Authorization: 'ZGlzbmV5JmJyb3dzZXImMS4wLjA.Cu56AgSfBTDag5NiRA81oLHkDZfu5L3CKadnefEAY84',
        'Content-Type': 'application/json'
      }, body, 5000)

      let json = JSON.parse(data)
      if (json?.errors) throw 'Not Available'
      let { session: { inSupportedLocation, location: { countryCode } } } = json.extensions.sdk
      return { region: countryCode, inSupportedLocation }
    }, 2, 1000)

    let status = locationInfo.inSupportedLocation ? STATUS_AVAILABLE : STATUS_COMING
    return { name: 'Disney+', status, region: locationInfo.region ?? homepage.region, message: status===STATUS_AVAILABLE?`Disney+: 已解锁 ➟ ${locationInfo.region}`:`Disney+: 即将登陆 ➟ ${locationInfo.region}` }

  } catch (err) {
    if (err==='Not Available') return { name:'Disney+', status:STATUS_NOT_AVAILABLE, region:'', message:'Disney+: 未支持解锁 🚫' }
    if (err==='Timeout') return { name:'Disney+', status:STATUS_TIMEOUT, region:'', message:'Disney+: 检测超时 🚦' }
    Logger.error(err)
    return { name:'Disney+', status:STATUS_ERROR, region:'', message:'Disney+: 检测异常 ❌' }
  }
}

// YouTube Premium 检测
async function checkYouTubePremium() {
  try {
    let data = await retry(() => safeGet('https://www.youtube.com/premium', REQUEST_HEADERS, 5000), 2, 1000)
    if (data.indexOf('Premium is not available in your country')!==-1) {
      return { name:'YouTube', status:STATUS_NOT_AVAILABLE, region:'', message:'YouTube: 不支持解锁' }
    }
    let region = (data.match(/"countryCode":"(.*?)"/)?.[1] || (data.indexOf('www.google.cn')!==-1?'CN':'US')).toUpperCase()
    return { name:'YouTube', status:STATUS_AVAILABLE, region, message:`YouTube: 已解锁 ➟ ${region}` }
  } catch(err){
    Logger.error(err)
    return { name:'YouTube', status:STATUS_ERROR, region:'', message:'YouTube: 检测失败 ❌' }
  }
}

// Netflix 检测
async function checkNetflix() {
  const testFilmIds = [80062035, 80018499]
  try {
    for (let filmId of testFilmIds){
      try {
        let url = `https://www.netflix.com/title/${filmId}`
        let data = await retry(() => new Promise((resolve, reject) => {
          $httpClient.get({ url, headers: REQUEST_HEADERS }, (err, resp, body) => {
            if (err) return reject(err)
            if (resp.status===403) return reject('Not Available')
            if (resp.status===404) return resolve('Not Found')
            if (resp.status===200) {
              let region = resp.headers['x-originating-url']?.split('/')[3]?.split('-')[0] || 'US'
              if(region==='title') region='US'
              resolve(region.toUpperCase())
            }
          })
        }),2,1000)
        if(data==='Not Found') continue
        return { name:'Netflix', status:STATUS_AVAILABLE, region:data, message:`Netflix: 已完整解锁 ➟ ${data}` }
      } catch(err){
        if(err==='Not Available') return { name:'Netflix', status:STATUS_NOT_AVAILABLE, region:'', message:'Netflix: 不支持解锁 🚫' }
      }
    }
    return { name:'Netflix', status:STATUS_NOT_AVAILABLE, region:'', message:'Netflix: 仅解锁自制剧/不可用' }
  } catch(err){
    Logger.error(err)
    return { name:'Netflix', status:STATUS_ERROR, region:'', message:'Netflix: 检测异常 ❌' }
  }
}

// ------------------------- 主逻辑 -------------------------
(async () => {
  const panel_result = { title: '流媒体解锁检测', content:'', icon:'play.tv.fill', 'icon-color':'#FF2D55' }

  try {
    const results = await Promise.all([testDisneyPlus(), checkYouTubePremium(), checkNetflix()])
    panel_result.content = results.map(r=>r.message).join('\n')
    panel_result['icon-color'] = results.every(r=>r.status===STATUS_AVAILABLE)?'#34C759':'#FF9500'
  } catch(err){
    Logger.error(err)
    panel_result.content = '检测失败，请刷新面板'
    panel_result['icon-color'] = '#FF3B30'
  }

  $done(panel_result)
})()
