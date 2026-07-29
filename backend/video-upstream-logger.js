const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_CHARS = 65536;
const DEFAULT_LOG_DIR = path.join(__dirname, 'logs', 'video-upstream');
const MIN_MAX_CHARS = 1024;
const MAX_MAX_CHARS = 1024 * 1024;
const SENSITIVE_KEY_PATTERN = /^(authorization|proxyauthorization|apikey|xapikey|token|xtoken|accesstoken|refreshtoken|secret|clientsecret|signature|sig|password|cookie|setcookie)$/;
const SENSITIVE_QUERY_KEY_PATTERN = /^(key|apikey|token|accesstoken|refreshtoken|secret|signature|sig)$/;
const initializedLogDirectories = new Map();
const warnedLogErrors = new Set();

/**
 * 判断视频上游日志是否启用。
 * @param {unknown} value 环境变量中的日志开关值。
 * @returns {boolean} 未配置时返回 true，仅 false、0、no、off 会关闭日志。
 */
function isVideoUpstreamLogEnabled(value) {
  if (value === undefined || value === null || String(value).trim() === '') return true;
  return !['false', '0', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

/**
 * 解析视频上游响应正文的最大日志字符数。
 * @param {unknown} value 环境变量中的字符数。
 * @param {unknown} legacyValue 旧错误日志环境变量中的兼容字符数。
 * @returns {number} 限制在 1024 至 1048576 之间的字符数。
 */
function getVideoUpstreamLogMaxChars(value, legacyValue) {
  const parsed = Number.parseInt(String(value ?? legacyValue ?? DEFAULT_MAX_CHARS), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_CHARS;
  return Math.min(MAX_MAX_CHARS, Math.max(MIN_MAX_CHARS, parsed));
}

/**
 * 解析视频上游日志落盘目录。
 * @param {unknown} value 环境变量中的日志目录。
 * @returns {string} 绝对日志目录；未配置时返回后端默认目录。
 */
function getVideoUpstreamLogDir(value) {
  const configured = String(value ?? '').trim();
  return path.resolve(configured || DEFAULT_LOG_DIR);
}

/**
 * 按进程本地时区生成日志日期，保证每天写入独立文件。
 * @param {Date} [date] 用于计算日期的时间，默认使用当前时间。
 * @returns {string} YYYY-MM-DD 格式的本地日期。
 */
function getVideoUpstreamLogDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 获取指定日期的视频上游日志文件路径。
 * @param {string} logDir 日志根目录。
 * @param {Date} [date] 用于确定文件日期的时间。
 * @returns {string} 当天 JSONL 日志文件的绝对路径。
 */
function getVideoUpstreamLogFilePath(logDir, date = new Date()) {
  return path.join(getVideoUpstreamLogDir(logDir), `video-upstream-${getVideoUpstreamLogDate(date)}.log`);
}

/**
 * 确保日志目录存在，并复用同一目录的初始化任务。
 * @param {string} logDir 日志根目录。
 * @returns {Promise<void>} 目录创建完成后兑现的 Promise。
 */
function ensureVideoUpstreamLogDir(logDir) {
  const resolved = getVideoUpstreamLogDir(logDir);
  if (!initializedLogDirectories.has(resolved)) {
    initializedLogDirectories.set(resolved, fs.promises.mkdir(resolved, { recursive: true }));
  }
  return initializedLogDirectories.get(resolved);
}

/**
 * 将单条已脱敏的视频上游诊断记录追加到当天文件。
 * @param {'request'|'response'} event 请求或响应事件。
 * @param {'info'|'error'} level 日志级别。
 * @param {Record<string, unknown>} diagnostics 已脱敏的诊断内容。
 * @param {{ logDir?: string }} [options] 日志目录选项。
 * @returns {Promise<void>} 文件追加完成后兑现的 Promise；失败时告警但不向业务抛错。
 */
function appendVideoUpstreamLog(event, level, diagnostics, options = {}) {
  const logDir = getVideoUpstreamLogDir(options.logDir);
  const timestamp = new Date();
  const filePath = getVideoUpstreamLogFilePath(logDir, timestamp);
  const line = JSON.stringify({ timestamp: timestamp.toISOString(), level, event, ...diagnostics }) + '\n';
  return ensureVideoUpstreamLogDir(logDir)
    .then(() => fs.promises.appendFile(filePath, line, 'utf8'))
    .catch((error) => {
      // 日志落盘失败不能中断视频任务；同一目录仅告警一次，避免持续刷屏。
      if (warnedLogErrors.has(logDir)) return;
      warnedLogErrors.add(logDir);
      console.warn(`[video-upstream] 日志文件写入失败 dir=${logDir}`, error?.message || error);
    });
}

/**
 * 将字段名规范化后判断其是否承载认证或密钥信息。
 * @param {unknown} key 待判断的字段名。
 * @returns {boolean} 字段需要脱敏时返回 true。
 */
function isSensitiveVideoLogKey(key) {
  const normalized = String(key || '').toLowerCase().replace(/[-_.\s]/g, '');
  return SENSITIVE_KEY_PATTERN.test(normalized);
}

/**
 * 对 API Key、令牌或签名进行部分脱敏，并保留少量首尾字符用于区分不同上游。
 * @param {unknown} value 待脱敏的认证值。
 * @returns {string} 不可直接用于认证的脱敏文本。
 */
function maskVideoApiKey(value) {
  const raw = String(value ?? '');
  const bearerMatch = raw.match(/^(Bearer\s+)(.+)$/i);
  if (bearerMatch) return `${bearerMatch[1]}${maskVideoApiKey(bearerMatch[2])}`;
  if (!raw) return '[REDACTED]';
  if (raw.length <= 7) return '****';
  return `${raw.slice(0, 3)}****${raw.slice(-4)}`;
}

/**
 * 估算 Base64 内容的原始字节数。
 * @param {string} base64 Base64 编码文本。
 * @returns {number} 去除填充后的近似原始字节数。
 */
function estimateBase64Bytes(base64) {
  const compact = String(base64 || '').replace(/\s/g, '');
  const padding = compact.endsWith('==') ? 2 : compact.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor(compact.length * 3 / 4) - padding);
}

/**
 * 将 data URL 替换为不包含媒体内容的摘要。
 * @param {string} value 可能包含 data URL 的文本。
 * @returns {string} 媒体正文被 MIME 类型与字节数摘要替代后的文本。
 */
function summarizeDataUrls(value) {
  return String(value).replace(/data:([^;,\s]+)(?:;[^,\s]*)?;base64,([a-z0-9+/=\r\n]+)/gi, (_match, mimeType, base64) => (
    `<data:${mimeType};base64, ${estimateBase64Bytes(base64)} bytes>`
  ));
}

/**
 * 安全解码 URL 查询参数，遇到畸形百分号编码时保留原值，避免日志处理影响业务请求。
 * @param {string} value 待解码的查询参数值。
 * @returns {string} 解码后的文本；无法解码时返回原始文本。
 */
function decodeVideoLogQueryValue(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * 对无法解析为 JSON 的响应文本执行保守脱敏。
 * @param {string} value 上游返回的原始文本。
 * @returns {string} Bearer 令牌、敏感键值、认证查询参数和 data URL 已脱敏的文本。
 */
function sanitizeVideoLogText(value) {
  let sanitized = summarizeDataUrls(value);
  // 先处理标准 Authorization 文本，再处理常见 JSON、日志键值和 URL 查询参数。
  sanitized = sanitized.replace(/Bearer\s+[^\s,;\]}"']+/gi, match => maskVideoApiKey(match));
  sanitized = sanitized.replace(/(["']?(?:api[-_.]?key|access[-_.]?token|refresh[-_.]?token|authorization|secret|client[-_.]?secret|signature|password)["']?\s*[:=]\s*["']?)([^"'\s,;}&]+)/gi, (_match, prefix, secret) => `${prefix}${maskVideoApiKey(secret)}`);
  sanitized = sanitized.replace(/([?&](?:key|api_key|apikey|token|access_token|refresh_token|secret|signature|sig)=)([^&#\s]+)/gi, (_match, prefix, secret) => `${prefix}${encodeURIComponent(maskVideoApiKey(decodeVideoLogQueryValue(secret)))}`);
  return sanitized;
}

/**
 * 清理上游 URL 中的认证查询参数，同时保留路径及非敏感参数用于排查。
 * @param {string|URL} value 上游请求地址。
 * @returns {string} 认证参数已脱敏的 URL；无法解析时返回经过文本脱敏的原值。
 */
function sanitizeVideoLogUrl(value) {
  try {
    const url = new URL(String(value));
    for (const [key, secret] of url.searchParams.entries()) {
      const normalized = key.toLowerCase().replace(/[-_.\s]/g, '');
      if (SENSITIVE_QUERY_KEY_PATTERN.test(normalized)) url.searchParams.set(key, maskVideoApiKey(secret));
    }
    return url.toString();
  } catch {
    return sanitizeVideoLogText(String(value || ''));
  }
}

/**
 * 递归清理请求或响应中的敏感值与媒体正文。
 * @param {unknown} value 待清理的任意值。
 * @param {string} [key] 当前值所属字段名。
 * @param {WeakSet<object>} [seen] 用于避免循环引用的对象集合。
 * @returns {unknown} 可安全序列化到日志的值。
 */
function sanitizeVideoLogValue(value, key = '', seen = new WeakSet()) {
  if (isSensitiveVideoLogKey(key)) return maskVideoApiKey(value);
  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return sanitizeVideoLogText(value);
  if (Buffer.isBuffer(value)) return `<Buffer ${value.length} bytes>`;
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return { name: typeof value.name === 'string' ? value.name : '', mimeType: value.type || '', size: value.size };
  }
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '<循环引用>';
  seen.add(value);
  if (Array.isArray(value)) return value.map(item => sanitizeVideoLogValue(item, '', seen));
  return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
    childKey,
    sanitizeVideoLogValue(childValue, childKey, seen),
  ]));
}

/**
 * 汇总 fetch 请求头并对认证头及 Cookie 进行脱敏。
 * @param {Headers|Record<string, unknown>|Array<[string, unknown]>|undefined} headers fetch 请求头。
 * @returns {Record<string, unknown>} 可安全写入日志的请求头对象。
 */
function summarizeVideoRequestHeaders(headers) {
  if (!headers) return {};
  const entries = typeof headers.entries === 'function' ? [...headers.entries()] : Array.isArray(headers) ? headers : Object.entries(headers);
  return Object.fromEntries(entries.map(([key, value]) => [key, sanitizeVideoLogValue(value, key)]));
}

/**
 * 汇总 JSON、文本或 multipart 请求体，文件仅保留名称、类型和字节数。
 * @param {unknown} body fetch 请求体。
 * @returns {unknown} 不包含二进制媒体或可用认证信息的请求体摘要。
 */
function summarizeVideoRequestBody(body) {
  if (body === undefined || body === null) return '<empty>';
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    const fields = {};
    for (const [key, value] of body.entries()) {
      const summarized = sanitizeVideoLogValue(value, key);
      if (Object.prototype.hasOwnProperty.call(fields, key)) {
        fields[key] = Array.isArray(fields[key]) ? [...fields[key], summarized] : [fields[key], summarized];
      } else {
        fields[key] = summarized;
      }
    }
    return { type: 'multipart/form-data', fields };
  }
  if (typeof body === 'string') {
    try {
      return sanitizeVideoLogValue(JSON.parse(body));
    } catch {
      return sanitizeVideoLogText(body);
    }
  }
  return sanitizeVideoLogValue(body);
}

/**
 * 截断过长的响应正文并在尾部记录原始字符数。
 * @param {string} value 已脱敏的响应正文。
 * @param {number} maxChars 最大日志字符数。
 * @returns {string} 未超限的原文或带截断说明的文本。
 */
function truncateVideoLogText(value, maxChars) {
  const raw = String(value || '');
  return raw.length > maxChars ? `${raw.slice(0, maxChars)}\n...[响应已截断，脱敏后字符数=${raw.length}]` : raw;
}

/**
 * 将响应正文解析并脱敏后限制日志长度。
 * @param {string|undefined|null} responseText 已读取的上游响应正文。
 * @param {number} maxChars 最大日志字符数。
 * @returns {unknown} 安全的结构化响应，或安全且已截断的文本。
 */
function summarizeVideoResponseBody(responseText, maxChars) {
  if (responseText === undefined || responseText === null) return '<流式响应正文未读取>';
  const raw = String(responseText);
  try {
    const serialized = JSON.stringify(sanitizeVideoLogValue(JSON.parse(raw)), null, 2);
    const truncated = truncateVideoLogText(serialized, maxChars);
    return truncated === serialized ? JSON.parse(serialized) : truncated;
  } catch {
    return truncateVideoLogText(sanitizeVideoLogText(raw), maxChars) || '<empty>';
  }
}

/**
 * 记录一次视频上游请求。
 * @param {string} stage 创建、轮询或下载阶段。
 * @param {string|URL} url 上游请求地址。
 * @param {RequestInit} init fetch 请求参数。
 * @param {Record<string, unknown>} context 不敏感的任务诊断上下文。
 * @param {{ enabled?: boolean, logDir?: string }} [options] 日志开关与落盘目录。
 * @returns {void} 无返回值；启用时写入服务端标准日志和按日期分割的文件。
 */
function logVideoUpstreamRequest(stage, url, init = {}, context = {}, options = {}) {
  if (options.enabled === false) return;
  const diagnostics = sanitizeVideoLogValue({
    stage,
    method: init.method || 'GET',
    url: sanitizeVideoLogUrl(url),
    headers: summarizeVideoRequestHeaders(init.headers),
    context,
    body: summarizeVideoRequestBody(init.body),
  });
  console.info('[video-upstream] 上游请求\n' + JSON.stringify(diagnostics, null, 2));
  appendVideoUpstreamLog('request', 'info', diagnostics, options);
}

/**
 * 记录一次视频上游响应，错误响应使用错误日志级别。
 * @param {string} stage 创建、轮询或下载阶段。
 * @param {string|URL} url 上游请求地址。
 * @param {Response} response 上游 HTTP 响应。
 * @param {string|undefined|null} responseText 已读取的响应正文；流式下载成功时不读取。
 * @param {Record<string, unknown>} context 不敏感的任务诊断上下文。
 * @param {{ enabled?: boolean, maxChars?: number, isError?: boolean, logDir?: string }} [options] 日志开关、长度、级别和落盘目录选项。
 * @returns {void} 无返回值；启用时写入服务端标准日志和按日期分割的文件。
 */
function logVideoUpstreamResponse(stage, url, response, responseText, context = {}, options = {}) {
  if (options.enabled === false) return;
  const maxChars = getVideoUpstreamLogMaxChars(options.maxChars);
  const diagnostics = sanitizeVideoLogValue({
    stage,
    url: sanitizeVideoLogUrl(url),
    status: response.status,
    statusText: response.statusText,
    headers: summarizeVideoRequestHeaders(response.headers),
    context,
    body: summarizeVideoResponseBody(responseText, maxChars),
  });
  const isError = Boolean(options.isError || !response.ok);
  const logger = isError ? console.error : console.info;
  logger('[video-upstream] 上游响应\n' + JSON.stringify(diagnostics, null, 2));
  appendVideoUpstreamLog('response', isError ? 'error' : 'info', diagnostics, options);
}

module.exports = {
  appendVideoUpstreamLog,
  getVideoUpstreamLogDate,
  getVideoUpstreamLogDir,
  getVideoUpstreamLogFilePath,
  getVideoUpstreamLogMaxChars,
  isSensitiveVideoLogKey,
  isVideoUpstreamLogEnabled,
  logVideoUpstreamRequest,
  logVideoUpstreamResponse,
  maskVideoApiKey,
  sanitizeVideoLogText,
  sanitizeVideoLogUrl,
  sanitizeVideoLogValue,
  summarizeVideoRequestBody,
  summarizeVideoRequestHeaders,
  summarizeVideoResponseBody,
};
