const fs = require('fs');
const path = require('path');
const util = require('util');
const { sanitizeVideoLogText } = require('./video-upstream-logger');

const DEFAULT_LOG_DIR = path.join(__dirname, 'logs', 'application');
const CONSOLE_LEVELS = ['log', 'info', 'warn', 'error'];
const initializedLogDirectories = new Map();
const pendingWrites = new Map();
const warnedLogErrors = new Set();
const rawConsoleWarn = console.warn.bind(console);

/**
 * 判断后端应用日志文件是否启用。
 * @param {unknown} value 环境变量中的日志开关值。
 * @returns {boolean} 未配置时返回 true，仅 false、0、no、off 会关闭日志文件。
 */
function isDailyFileLogEnabled(value) {
  if (value === undefined || value === null || String(value).trim() === '') return true;
  return !['false', '0', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

/**
 * 解析后端应用日志目录。
 * @param {unknown} value 环境变量中的日志目录。
 * @returns {string} 绝对日志目录；未配置时返回后端默认目录。
 */
function getDailyFileLogDir(value) {
  const configured = String(value ?? '').trim();
  return path.resolve(configured || DEFAULT_LOG_DIR);
}

/**
 * 按进程本地时区生成日志日期。
 * @param {Date} [date] 用于计算日期的时间，默认使用当前时间。
 * @returns {string} YYYY-MM-DD 格式的本地日期。
 */
function getDailyFileLogDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 获取指定日期的后端应用日志文件路径。
 * @param {string} logDir 日志根目录。
 * @param {Date} [date] 用于确定文件日期的时间。
 * @returns {string} 当天 JSONL 日志文件的绝对路径。
 */
function getDailyFileLogPath(logDir, date = new Date()) {
  return path.join(getDailyFileLogDir(logDir), `application-${getDailyFileLogDate(date)}.log`);
}

/**
 * 确保应用日志目录存在，并复用同一目录的初始化任务。
 * @param {string} logDir 日志根目录。
 * @returns {Promise<void>} 目录创建完成后兑现的 Promise。
 */
function ensureDailyFileLogDir(logDir) {
  const resolved = getDailyFileLogDir(logDir);
  if (!initializedLogDirectories.has(resolved)) {
    const initialization = fs.promises.mkdir(resolved, { recursive: true }).then(() => undefined).catch((error) => {
      // 目录可能因临时挂载或权限问题失败，清除失败缓存后允许后续日志自动恢复。
      if (initializedLogDirectories.get(resolved) === initialization) initializedLogDirectories.delete(resolved);
      throw error;
    });
    initializedLogDirectories.set(resolved, initialization);
  }
  return initializedLogDirectories.get(resolved);
}

/**
 * 使用 Node.js 控制台语义将任意参数渲染为不带 ANSI 颜色的日志文本。
 * @param {unknown[]} args 传给 console 方法的原始参数。
 * @returns {string} 保留对象、占位符和错误堆栈信息的文本。
 */
function formatDailyFileLogMessage(args) {
  return util.formatWithOptions({ colors: false, depth: 8, maxArrayLength: 100 }, ...args);
}

/**
 * 构建已经脱敏的单条应用日志 JSONL 文本。
 * @param {'log'|'info'|'warn'|'error'} level 日志级别。
 * @param {unknown[]} args 传给 console 方法的原始参数。
 * @param {Date} timestamp 当前日志时间。
 * @returns {string} 可直接追加到文件的单行 JSON 文本。
 */
function createDailyFileLogLine(level, args, timestamp) {
  return JSON.stringify({
    timestamp: timestamp.toISOString(),
    level,
    message: sanitizeVideoLogText(formatDailyFileLogMessage(args)),
  }) + '\n';
}

/**
 * 对同一日志目录仅输出一次落盘失败告警，且绕过 console 包装器避免递归。
 * @param {string} logDir 日志根目录。
 * @param {unknown} error 日志格式化、目录创建或文件追加异常。
 * @returns {void} 无返回值。
 */
function reportDailyFileLogError(logDir, error) {
  if (warnedLogErrors.has(logDir)) return;
  warnedLogErrors.add(logDir);
  rawConsoleWarn(`[${new Date().toISOString()}] [file-log] 日志文件写入失败 dir=${logDir}`, error?.message || error);
}

/**
 * 将一条标准后端日志顺序追加到当天文件。
 * @param {'log'|'info'|'warn'|'error'} level 日志级别。
 * @param {unknown[]} args 传给 console 方法的原始参数。
 * @param {{ enabled?: boolean, logDir?: string, date?: Date }} [options] 日志开关、目录和测试日期选项。
 * @returns {Promise<void>} 文件追加完成后兑现的 Promise；失败时告警但不影响业务流程。
 */
function appendDailyFileLog(level, args, options = {}) {
  if (options.enabled === false) return Promise.resolve();
  const logDir = getDailyFileLogDir(options.logDir);
  const timestamp = options.date || new Date();
  const filePath = getDailyFileLogPath(logDir, timestamp);
  let line;
  try {
    line = createDailyFileLogLine(level, args, timestamp);
  } catch (error) {
    reportDailyFileLogError(logDir, error);
    return Promise.resolve();
  }
  const previousWrite = pendingWrites.get(logDir) || Promise.resolve();
  const currentWrite = previousWrite
    .then(() => ensureDailyFileLogDir(logDir))
    .then(() => fs.promises.appendFile(filePath, line, 'utf8'))
    .catch((error) => {
      // 日志落盘失败不能中断业务，统一走不可递归的降级告警。
      reportDailyFileLogError(logDir, error);
    });
  pendingWrites.set(logDir, currentWrite);
  // 写入完成后释放已结算队列；若期间已有新写入接管目录，则保留新 Promise。
  void currentWrite.then(
    () => { if (pendingWrites.get(logDir) === currentWrite) pendingWrites.delete(logDir); },
    () => { if (pendingWrites.get(logDir) === currentWrite) pendingWrites.delete(logDir); },
  );
  return currentWrite;
}

/**
 * 等待当前已经排队的全部应用日志完成落盘。
 * @returns {Promise<void>} 所有目录的写入队列完成后兑现的 Promise。
 */
function flushDailyFileLogs() {
  return Promise.all([...pendingWrites.values()]).then(() => undefined);
}

/**
 * 将标准 console 日志镜像到按日期划分的应用日志文件。
 * @param {{ enabled?: boolean, logDir?: string }} [options] 日志开关与落盘目录。
 * @returns {() => void} 恢复原始 console 方法的清理函数。
 */
function installDailyFileLogger(options = {}) {
  if (options.enabled === false) return () => undefined;
  const originalMethods = {};
  for (const level of CONSOLE_LEVELS) {
    originalMethods[level] = console[level].bind(console);
    console[level] = (...args) => {
      originalMethods[level](...args);
      try {
        void appendDailyFileLog(level, args, options);
      } catch (error) {
        // 包装器必须保持 console 的非抛错语义，避免日志异常影响任务主流程。
        reportDailyFileLogError(getDailyFileLogDir(options.logDir), error);
      }
    };
  }
  return () => {
    for (const level of CONSOLE_LEVELS) {
      console[level] = originalMethods[level];
    }
  };
}

module.exports = {
  appendDailyFileLog,
  flushDailyFileLogs,
  formatDailyFileLogMessage,
  getDailyFileLogDate,
  getDailyFileLogDir,
  getDailyFileLogPath,
  installDailyFileLogger,
  isDailyFileLogEnabled,
};
