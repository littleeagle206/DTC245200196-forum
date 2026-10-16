// Kết nối MySQL bằng connection pool.
// Thông tin kết nối lấy từ biến môi trường (truyền vào từ file .env qua docker-compose),
// KHÔNG viết cứng mật khẩu trong mã nguồn.
const mysql = require('mysql2/promise');
const log = require('./logger');

const config = {
  host: process.env.DB_HOST || 'mysql',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'forum_app',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'forum',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
};

const pool = mysql.createPool(config);

// Đợi MySQL sẵn sàng (lần đầu khởi tạo MySQL mất 20-60 giây).
async function waitForDb(retries = 30, delayMs = 3000) {
  for (let i = 1; i <= retries; i++) {
    try {
      await pool.query('SELECT 1');
      log.info('DB_CONNECTED', 'Ket noi MySQL thanh cong', { host: config.host, database: config.database });
      return;
    } catch (err) {
      log.warn('DB_WAITING', `Chua ket noi duoc MySQL (lan ${i}/${retries})`, { error: err.code || err.message });
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error('Khong the ket noi MySQL');
}

module.exports = { pool, config, waitForDb };
