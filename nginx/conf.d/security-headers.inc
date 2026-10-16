# =============================================================
# Security Headers dùng chung (được include vào các server block)
# =============================================================
add_header X-Frame-Options "SAMEORIGIN" always;                      # chống Clickjacking
add_header X-Content-Type-Options "nosniff" always;                  # chống MIME-sniffing
add_header X-XSS-Protection "1; mode=block" always;                  # bộ lọc XSS (trình duyệt cũ)
add_header Referrer-Policy "strict-origin-when-cross-origin" always; # hạn chế lộ URL nguồn
add_header Permissions-Policy "geolocation=(), camera=(), microphone=()" always;
add_header Strict-Transport-Security "max-age=31536000" always;      # HSTS: bắt buộc dùng HTTPS
