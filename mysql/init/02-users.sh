#!/bin/bash
# =============================================================
# HARDENING - Nguyên tắc đặc quyền tối thiểu (least privilege) cho DB
#  - forum_app : tài khoản ứng dụng, CHỈ được SELECT/INSERT/UPDATE/DELETE
#                trên database forum (không DROP, không ALTER, không GRANT).
#  - exporter  : tài khoản cho mysqld-exporter, chỉ đọc thông số giám sát.
# Mật khẩu lấy từ biến môi trường (file .env), không viết cứng.
# =============================================================
set -e

mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" <<-EOSQL
  CREATE USER IF NOT EXISTS 'forum_app'@'%' IDENTIFIED BY '${DB_APP_PASSWORD}';
  GRANT SELECT, INSERT, UPDATE, DELETE ON forum.* TO 'forum_app'@'%';

  CREATE USER IF NOT EXISTS 'exporter'@'%' IDENTIFIED BY '${DB_EXPORTER_PASSWORD}' WITH MAX_USER_CONNECTIONS 3;
  GRANT PROCESS, REPLICATION CLIENT, SELECT ON *.* TO 'exporter'@'%';

  FLUSH PRIVILEGES;
EOSQL

echo "[init] Da tao user forum_app (quyen han che) va exporter (chi doc)"
