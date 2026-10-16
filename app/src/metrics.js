// Các metrics ứng dụng cho Prometheus (endpoint /metrics).
const client = require('prom-client');

const register = new client.Registry();
register.setDefaultLabels({ app: 'forum' });
client.collectDefaultMetrics({ register }); // CPU, RAM, event loop của tiến trình Node.js

const httpRequests = new client.Counter({
  name: 'http_requests_total',
  help: 'Tong so HTTP request ung dung xu ly',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Thoi gian xu ly HTTP request (giay)',
  labelNames: ['method', 'route'],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  registers: [register],
});

const loginFailed = new client.Counter({
  name: 'forum_login_failed_total',
  help: 'So lan dang nhap that bai',
  registers: [register],
});

const loginSuccess = new client.Counter({
  name: 'forum_login_success_total',
  help: 'So lan dang nhap thanh cong',
  registers: [register],
});

const postsCreated = new client.Counter({
  name: 'forum_posts_created_total',
  help: 'So bai viet duoc tao',
  registers: [register],
});

const commentsCreated = new client.Counter({
  name: 'forum_comments_created_total',
  help: 'So binh luan duoc tao',
  registers: [register],
});

module.exports = {
  register,
  httpRequests,
  httpDuration,
  loginFailed,
  loginSuccess,
  postsCreated,
  commentsCreated,
};
