# Cấu hình TLS dùng chung (chứng chỉ tự ký tạo bởi scripts/setup.sh)
ssl_certificate     /etc/nginx/certs/server.crt;
ssl_certificate_key /etc/nginx/certs/server.key;
ssl_protocols       TLSv1.2 TLSv1.3;      # tắt SSLv3, TLS 1.0, 1.1 (đã lỗi thời)
ssl_prefer_server_ciphers off;
ssl_session_cache   shared:SSL:10m;
ssl_session_timeout 1d;
ssl_session_tickets off;
