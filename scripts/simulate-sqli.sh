#!/usr/bin/env bash
# =============================================================
# MÔ PHỎNG dò quét SQL Injection / XSS vào chức năng tìm kiếm.
# Ứng dụng dùng truy vấn tham số hóa nên KHÔNG bị khai thác,
# nhưng các request vẫn được ghi log SUSPICIOUS_INPUT và sinh cảnh báo.
#   bash scripts/simulate-sqli.sh [https://localhost]
# =============================================================
TARGET="${1:-https://localhost}"
PAYLOADS=(
  "1' OR '1'='1"
  "' UNION SELECT username, password_hash FROM users -- "
  "admin'-- "
  "1; DROP TABLE users"
  "<script>alert(document.cookie)</script>"
  "../../etc/passwd"
)
for p in "${PAYLOADS[@]}"; do
  code=$(curl -sk -o /dev/null -w '%{http_code}' -A "sqlmap-sim/1.0" -G --data-urlencode "q=${p}" "${TARGET}/search")
  echo "payload: ${p}  -> HTTP ${code}"
  sleep 0.5
done
