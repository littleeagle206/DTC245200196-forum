// Logger ghi log dạng JSON ra stdout.
// Docker thu stdout của container -> Promtail đọc -> đẩy về Loki.
// Mỗi dòng log là 1 object JSON nên LogQL có thể dùng "| json" để lọc theo trường.

function write(level, event, msg, fields = {}) {
  const line = {
    ts: new Date().toISOString(),
    level,
    event,
    msg,
    ...fields,
  };
  const out = JSON.stringify(line);
  if (level === 'error') {
    process.stderr.write(out + '\n');
  } else {
    process.stdout.write(out + '\n');
  }
}

module.exports = {
  info: (event, msg, fields) => write('info', event, msg, fields),
  warn: (event, msg, fields) => write('warn', event, msg, fields),
  error: (event, msg, fields) => write('error', event, msg, fields),
};
