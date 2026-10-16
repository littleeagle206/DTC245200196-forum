#!/usr/bin/env bash
# =============================================================
# Chuẩn bị trước khi chạy "docker compose up -d":
#   1. Tạo file .env với mật khẩu ngẫu nhiên mạnh (nếu chưa có)
#   2. Tạo chứng chỉ HTTPS tự ký cho Nginx
#   3. Tạo file htpasswd (Basic Auth bảo vệ phpMyAdmin)
# Cách chạy (từ thư mục gốc project):   bash scripts/setup.sh
# =============================================================
set -euo pipefail
cd "$(dirname "$0")/.."

command -v openssl >/dev/null || { echo "Can cai openssl: sudo apt install -y openssl"; exit 1; }

rand() { openssl rand -hex "${1:-16}"; }

# ---------- 1. File .env ----------
if [ ! -f .env ]; then
  cp .env.example .env
  sed -i "s|^MYSQL_ROOT_PASSWORD=.*|MYSQL_ROOT_PASSWORD=$(rand 16)|" .env
  sed -i "s|^DB_APP_PASSWORD=.*|DB_APP_PASSWORD=$(rand 16)|" .env
  sed -i "s|^DB_EXPORTER_PASSWORD=.*|DB_EXPORTER_PASSWORD=$(rand 16)|" .env
  sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$(rand 32)|" .env
  # Mật khẩu đăng nhập web: có chữ hoa + chữ thường + số
  sed -i "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=Forum$(rand 6)X9|" .env
  sed -i "s|^GRAFANA_ADMIN_PASSWORD=.*|GRAFANA_ADMIN_PASSWORD=Graf$(rand 6)Z7|" .env
  sed -i "s|^PMA_BASIC_AUTH_PASSWORD=.*|PMA_BASIC_AUTH_PASSWORD=Pma$(rand 6)Q5|" .env
  chmod 600 .env                     # chỉ chủ sở hữu được đọc
  echo "[OK] Da tao .env voi mat khau ngau nhien"
else
  echo "[--] .env da ton tai, giu nguyen"
fi
set -a; . ./.env; set +a

# ---------- 2. Chứng chỉ HTTPS tự ký ----------
mkdir -p nginx/certs
if [ ! -f nginx/certs/server.crt ]; then
  VM_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
  SAN="DNS:forum.local,DNS:localhost,IP:127.0.0.1"
  [ -n "${VM_IP}" ] && SAN="${SAN},IP:${VM_IP}"
  openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout nginx/certs/server.key -out nginx/certs/server.crt \
    -subj "/C=VN/ST=Thai Nguyen/L=Thai Nguyen/O=ICTU/OU=TKQT HTPM/CN=forum.local" \
    -addext "subjectAltName=${SAN}" 2>/dev/null
  # Nginx trong container chạy bằng uid 101 nên cần đọc được file key.
  # (Môi trường thật: chown 101:101 server.key && chmod 600 server.key)
  chmod 644 nginx/certs/server.crt nginx/certs/server.key
  echo "[OK] Da tao chung chi tu ky (SAN: ${SAN})"
else
  echo "[--] Chung chi da ton tai, giu nguyen"
fi

# ---------- 3. Basic Auth cho phpMyAdmin ----------
if [ -d nginx/htpasswd ]; then rmdir nginx/htpasswd 2>/dev/null || true; fi
printf "%s:%s\n" "${PMA_BASIC_AUTH_USER}" "$(openssl passwd -apr1 "${PMA_BASIC_AUTH_PASSWORD}")" > nginx/htpasswd
chmod 644 nginx/htpasswd
echo "[OK] Da tao nginx/htpasswd cho user ${PMA_BASIC_AUTH_USER}"

chmod +x scripts/*.sh 2>/dev/null || true

cat <<EOF

================= THONG TIN DANG NHAP (luu lai, KHONG dua len GitHub) =================
 Website Forum   : https://<IP-may-ao>/          user: ${ADMIN_USERNAME}   pass: ${ADMIN_PASSWORD}
 phpMyAdmin      : https://<IP-may-ao>:8443/
     - Lop 1 (Nginx Basic Auth)               user: ${PMA_BASIC_AUTH_USER}  pass: ${PMA_BASIC_AUTH_PASSWORD}
     - Lop 2 (MySQL)                          user: root     pass: ${MYSQL_ROOT_PASSWORD}
 Grafana         : http://<IP-may-ao>:3000/    user: ${GRAFANA_ADMIN_USER}   pass: ${GRAFANA_ADMIN_PASSWORD}
 Prometheus      : http://<IP-may-ao>:9090/
 Alertmanager    : http://<IP-may-ao>:9093/
========================================================================================
Tiep theo:  docker compose up -d --build
EOF
