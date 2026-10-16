// =============================================================
// Website Diễn đàn / Cộng đồng (Forum) - Đề 15
// Chức năng: người dùng (đăng ký/đăng nhập), chủ đề, bài viết, bình luận, tìm kiếm.
// Ghi log JSON (cho Loki) và xuất metrics (cho Prometheus).
// =============================================================
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const bcrypt = require('bcryptjs');

const log = require('./logger');
const metrics = require('./metrics');
const { pool, waitForDb } = require('./db');

const PORT = Number(process.env.PORT || 3000);
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  log.error('CONFIG_ERROR', 'SESSION_SECRET chua dat hoac qua ngan (>= 32 ky tu)');
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');           // Không lộ "X-Powered-By: Express"
app.set('trust proxy', 1);             // Tin 1 lớp proxy (Nginx) -> req.ip là IP thật của client
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));

// ---------- Ghi log + đo metrics cho MỌI request ----------
app.use((req, res, next) => {
  if (req.path === '/metrics' || req.path === '/healthz') return next();
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const seconds = Number(process.hrtime.bigint() - start) / 1e9;
    const route = req.route ? ((req.baseUrl || '') + req.route.path).replace(/\([^)]*\)/g, '') : (req.path.startsWith('/static') ? '/static' : 'unmatched');
    metrics.httpRequests.inc({ method: req.method, route, status: String(res.statusCode) });
    metrics.httpDuration.observe({ method: req.method, route }, seconds);
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    log[level]('HTTP_REQUEST', `${req.method} ${req.originalUrl} ${res.statusCode}`, {
      method: req.method,
      path: req.originalUrl.slice(0, 300),
      route,
      status: res.statusCode,
      duration_ms: Math.round(seconds * 1000),
      client_ip: req.ip,
      user: req.session && req.session.user ? req.session.user.username : null,
    });
  });
  next();
});

// ---------- Phát hiện đầu vào đáng ngờ (SQL Injection / XSS) ----------
// Ứng dụng đã dùng câu lệnh tham số hóa nên không bị SQLi, nhưng vẫn ghi log cảnh báo
// để phục vụ giám sát an toàn thông tin.
const SUSPICIOUS = /(\bunion\b.+\bselect\b|\bor\b\s+['"]?\d+['"]?\s*=\s*['"]?\d+|--\s|;\s*drop\s|<script|javascript:|\.\.\/)/i;
app.use((req, res, next) => {
  const values = [...Object.values(req.query || {}), ...Object.values(req.body || {})]
    .filter((v) => typeof v === 'string');
  values.push(decodeURIComponentSafe(req.path));
  const hit = values.find((v) => SUSPICIOUS.test(v));
  if (hit) {
    log.warn('SUSPICIOUS_INPUT', 'Phat hien dau vao nghi ngo tan cong (SQLi/XSS/Path traversal)', {
      client_ip: req.ip,
      path: req.path,
      sample: hit.slice(0, 120),
      user_agent: req.get('user-agent') || '',
    });
  }
  next();
});

function decodeURIComponentSafe(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

// ---------- Endpoint cho giám sát (Nginx chặn không cho truy cập từ ngoài) ----------
app.get('/healthz', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (e) {
    res.status(503).json({ status: 'db_error' });
  }
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', metrics.register.contentType);
  res.end(await metrics.register.metrics());
});

// ---------- Session (lưu trong MySQL) ----------
const sessionStore = new MySQLStore({ createDatabaseTable: false, clearExpired: true }, pool);
app.use(session({
  name: 'forum.sid',
  secret: SESSION_SECRET,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,               // JavaScript không đọc được cookie -> giảm rủi ro XSS đánh cắp phiên
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE !== 'false', // chỉ gửi cookie qua HTTPS
    maxAge: 1000 * 60 * 60 * 8,
  },
}));

// ---------- CSRF token đơn giản ----------
app.use((req, res, next) => {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrf = req.session.csrf;
  res.locals.user = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  if (req.method === 'POST' && req.body._csrf !== req.session.csrf) {
    log.warn('CSRF_REJECTED', 'Token CSRF khong hop le', { client_ip: req.ip, path: req.path });
    return res.status(403).render('error', { title: 'Lỗi bảo mật', message: 'Phiên làm việc không hợp lệ, vui lòng tải lại trang.' });
  }
  next();
});

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

function requireLogin(req, res, next) {
  if (!req.session.user) {
    req.session.flash = { type: 'warn', text: 'Bạn cần đăng nhập để thực hiện thao tác này.' };
    return res.redirect('/login');
  }
  next();
}

// =================== TRANG CHỦ ===================
app.get('/', wrap(async (req, res) => {
  const [categories] = await pool.query(`
    SELECT c.*, COUNT(p.id) AS post_count
    FROM categories c LEFT JOIN posts p ON p.category_id = c.id
    GROUP BY c.id ORDER BY c.id`);
  const [posts] = await pool.query(`
    SELECT p.id, p.title, p.views, p.created_at, u.username, c.name AS category, c.slug,
           (SELECT COUNT(*) FROM comments cm WHERE cm.post_id = p.id) AS comment_count
    FROM posts p JOIN users u ON u.id = p.user_id JOIN categories c ON c.id = p.category_id
    ORDER BY p.created_at DESC LIMIT 20`);
  const [[stats]] = await pool.query(`
    SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM posts) AS posts,
           (SELECT COUNT(*) FROM comments) AS comments`);
  res.render('index', { title: 'Trang chủ', categories, posts, stats });
}));

// =================== CHỦ ĐỀ ===================
app.get('/c/:slug', wrap(async (req, res) => {
  const [[category]] = await pool.query('SELECT * FROM categories WHERE slug = ?', [req.params.slug]);
  if (!category) return res.status(404).render('error', { title: 'Không tìm thấy', message: 'Chủ đề không tồn tại.' });
  const [posts] = await pool.query(`
    SELECT p.id, p.title, p.views, p.created_at, u.username,
           (SELECT COUNT(*) FROM comments cm WHERE cm.post_id = p.id) AS comment_count
    FROM posts p JOIN users u ON u.id = p.user_id
    WHERE p.category_id = ? ORDER BY p.created_at DESC`, [category.id]);
  res.render('category', { title: category.name, category, posts });
}));

// =================== BÀI VIẾT ===================
app.get('/p/:id(\\d+)', wrap(async (req, res) => {
  const id = Number(req.params.id);
  await pool.query('UPDATE posts SET views = views + 1 WHERE id = ?', [id]);
  const [[post]] = await pool.query(`
    SELECT p.*, u.username, c.name AS category, c.slug
    FROM posts p JOIN users u ON u.id = p.user_id JOIN categories c ON c.id = p.category_id
    WHERE p.id = ?`, [id]);
  if (!post) return res.status(404).render('error', { title: 'Không tìm thấy', message: 'Bài viết không tồn tại.' });
  const [comments] = await pool.query(`
    SELECT cm.*, u.username FROM comments cm JOIN users u ON u.id = cm.user_id
    WHERE cm.post_id = ? ORDER BY cm.created_at ASC`, [id]);
  res.render('post', { title: post.title, post, comments });
}));

app.get('/new', requireLogin, wrap(async (req, res) => {
  const [categories] = await pool.query('SELECT id, name FROM categories ORDER BY id');
  res.render('new', { title: 'Viết bài mới', categories, error: null, form: {} });
}));

app.post('/posts', requireLogin, wrap(async (req, res) => {
  const title = (req.body.title || '').trim();
  const content = (req.body.content || '').trim();
  const categoryId = Number(req.body.category_id);
  if (title.length < 5 || title.length > 200 || content.length < 10 || !categoryId) {
    const [categories] = await pool.query('SELECT id, name FROM categories ORDER BY id');
    return res.status(400).render('new', {
      title: 'Viết bài mới', categories, form: req.body,
      error: 'Tiêu đề 5-200 ký tự, nội dung tối thiểu 10 ký tự và phải chọn chủ đề.',
    });
  }
  const [r] = await pool.query('INSERT INTO posts (category_id, user_id, title, content) VALUES (?, ?, ?, ?)',
    [categoryId, req.session.user.id, title, content]);
  metrics.postsCreated.inc();
  log.info('POST_CREATED', 'Tao bai viet moi', { post_id: r.insertId, user: req.session.user.username, client_ip: req.ip });
  res.redirect(`/p/${r.insertId}`);
}));

app.post('/p/:id(\\d+)/comments', requireLogin, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const content = (req.body.content || '').trim();
  if (content.length < 2 || content.length > 5000) {
    req.session.flash = { type: 'warn', text: 'Bình luận phải từ 2 đến 5000 ký tự.' };
    return res.redirect(`/p/${id}`);
  }
  await pool.query('INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)', [id, req.session.user.id, content]);
  metrics.commentsCreated.inc();
  log.info('COMMENT_CREATED', 'Them binh luan', { post_id: id, user: req.session.user.username, client_ip: req.ip });
  res.redirect(`/p/${id}#comments`);
}));

app.post('/p/:id(\\d+)/delete', requireLogin, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const [[post]] = await pool.query('SELECT id, user_id FROM posts WHERE id = ?', [id]);
  if (!post) return res.redirect('/');
  const u = req.session.user;
  if (post.user_id !== u.id && u.role !== 'admin') {
    log.warn('ACCESS_DENIED', 'Nguoi dung co xoa bai viet khong phai cua minh', { post_id: id, user: u.username, client_ip: req.ip });
    return res.status(403).render('error', { title: 'Không có quyền', message: 'Bạn không có quyền xóa bài viết này.' });
  }
  await pool.query('DELETE FROM posts WHERE id = ?', [id]);
  log.info('POST_DELETED', 'Xoa bai viet', { post_id: id, user: u.username, role: u.role, client_ip: req.ip });
  req.session.flash = { type: 'ok', text: 'Đã xóa bài viết.' };
  res.redirect('/');
}));

// =================== TÌM KIẾM ===================
app.get('/search', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  let posts = [];
  if (q) {
    [posts] = await pool.query(`
      SELECT p.id, p.title, p.created_at, u.username, c.name AS category
      FROM posts p JOIN users u ON u.id = p.user_id JOIN categories c ON c.id = p.category_id
      WHERE p.title LIKE ? OR p.content LIKE ? ORDER BY p.created_at DESC LIMIT 50`, [`%${q}%`, `%${q}%`]);
  }
  res.render('search', { title: 'Tìm kiếm', q, posts });
}));

// =================== TÀI KHOẢN ===================
app.get('/register', (req, res) => res.render('register', { title: 'Đăng ký', error: null, form: {} }));

app.post('/register', wrap(async (req, res, next) => {
  const username = (req.body.username || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  const fail = (msg) => res.status(400).render('register', { title: 'Đăng ký', error: msg, form: { username, email } });

  if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) return fail('Tên đăng nhập 3-30 ký tự, chỉ gồm chữ, số, dấu gạch dưới.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('Email không hợp lệ.');
  // Chính sách mật khẩu mạnh: >= 8 ký tự, có chữ hoa, chữ thường và số
  if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) {
    return fail('Mật khẩu tối thiểu 8 ký tự, gồm chữ hoa, chữ thường và số.');
  }
  const [[exists]] = await pool.query('SELECT id FROM users WHERE username = ? OR email = ?', [username, email]);
  if (exists) return fail('Tên đăng nhập hoặc email đã được sử dụng.');

  const hash = await bcrypt.hash(password, 10); // Mật khẩu được băm bcrypt, không lưu dạng rõ
  const [r] = await pool.query('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)', [username, email, hash]);
  log.info('USER_REGISTERED', 'Dang ky tai khoan moi', { user_id: r.insertId, user: username, client_ip: req.ip });
  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.user = { id: r.insertId, username, role: 'user' };
    req.session.flash = { type: 'ok', text: 'Đăng ký thành công. Chào mừng bạn!' };
    res.redirect('/');
  });
}));

app.get('/login', (req, res) => res.render('login', { title: 'Đăng nhập', error: null, form: {} }));

app.post('/login', wrap(async (req, res, next) => {
  const username = (req.body.username || '').trim().slice(0, 50);
  const password = req.body.password || '';
  const [[user]] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
  const ok = user ? await bcrypt.compare(password, user.password_hash) : false;

  if (!ok) {
    metrics.loginFailed.inc();
    // Sự kiện quan trọng cho giám sát ATTT: Loki ruler đếm sự kiện này theo client_ip
    log.warn('LOGIN_FAILED', 'Dang nhap that bai', {
      user: username,
      reason: user ? 'wrong_password' : 'user_not_found',
      client_ip: req.ip,
      user_agent: (req.get('user-agent') || '').slice(0, 200),
    });
    return res.status(401).render('login', { title: 'Đăng nhập', error: 'Sai tên đăng nhập hoặc mật khẩu.', form: { username } });
  }

  metrics.loginSuccess.inc();
  log.info('LOGIN_SUCCESS', 'Dang nhap thanh cong', { user: user.username, role: user.role, client_ip: req.ip });
  req.session.regenerate((err) => {     // Tạo session ID mới -> chống session fixation
    if (err) return next(err);
    req.session.user = { id: user.id, username: user.username, role: user.role };
    res.redirect('/');
  });
}));

app.post('/logout', (req, res) => {
  const who = req.session.user ? req.session.user.username : null;
  req.session.destroy(() => {
    log.info('LOGOUT', 'Dang xuat', { user: who, client_ip: req.ip });
    res.clearCookie('forum.sid');
    res.redirect('/');
  });
});

// ---------- 404 & lỗi ----------
app.use((req, res) => res.status(404).render('error', { title: 'Không tìm thấy', message: 'Trang bạn tìm không tồn tại.' }));

app.use((err, req, res, next) => {
  log.error('APP_ERROR', err.message, { path: req.path, client_ip: req.ip, code: err.code || null });
  res.status(500).render('error', { title: 'Lỗi hệ thống', message: 'Đã có lỗi xảy ra, vui lòng thử lại sau.' });
});

// ---------- Khởi tạo dữ liệu mẫu ----------
async function seed() {
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM users');
  if (n > 0) return;
  const adminUser = process.env.ADMIN_USERNAME || 'admin';
  const adminPass = process.env.ADMIN_PASSWORD;
  if (!adminPass) {
    log.warn('SEED_SKIPPED', 'Khong co ADMIN_PASSWORD, bo qua tao tai khoan admin');
    return;
  }
  const hash = await bcrypt.hash(adminPass, 10);
  const [r] = await pool.query("INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, 'admin')",
    [adminUser, `${adminUser}@forum.local`, hash]);
  const samples = [
    [1, 'Chào mừng đến với Diễn đàn Cộng đồng!', 'Đây là diễn đàn demo cho bài tập lớn môn Triển khai và Quản trị Hệ thống Phần mềm.\nHệ thống chạy hoàn toàn bằng Docker Compose: Nginx, Node.js, MySQL, phpMyAdmin, Prometheus, Grafana, Loki, Promtail, Alertmanager.'],
    [3, 'Hỏi: Nginx reverse proxy hoạt động như thế nào?', 'Mọi request từ trình duyệt đi vào Nginx (cổng 443), Nginx chuyển tiếp vào container app ở cổng 3000 trong mạng nội bộ Docker.'],
    [2, 'Chia sẻ: Câu lệnh SQL tham số hóa chống SQL Injection', 'Luôn dùng dấu ? và truyền tham số riêng thay vì nối chuỗi trực tiếp vào câu lệnh SQL.'],
  ];
  for (const [cat, title, content] of samples) {
    await pool.query('INSERT INTO posts (category_id, user_id, title, content) VALUES (?, ?, ?, ?)', [cat, r.insertId, title, content]);
  }
  log.info('SEED_DONE', 'Da tao tai khoan admin va bai viet mau', { admin: adminUser });
}

async function main() {
  await waitForDb();
  await seed();
  const server = app.listen(PORT, () => log.info('APP_STARTED', `Forum dang chay tai cong ${PORT}`, { port: PORT }));
  const shutdown = (sig) => {
    log.info('APP_STOPPING', `Nhan tin hieu ${sig}, dung ung dung`);
    server.close(() => pool.end().finally(() => process.exit(0)));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  log.error('APP_START_FAILED', err.message);
  process.exit(1);
});
