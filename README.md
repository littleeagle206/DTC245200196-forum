# Đề 15 – Diễn đàn / Cộng đồng (Forum)

Bài tập lớn môn **Triển khai và Quản trị Hệ thống Phần mềm**.
Website diễn đàn (chủ đề, bài viết, bình luận, người dùng) được triển khai hoàn toàn bằng **Docker Compose**, kèm reverse proxy, giám sát, log tập trung, cảnh báo và hardening.

- Sinh viên: `Dương Văn Tuân` – MSSV: `DTC245200196` – Lớp: `CNTT K23G`

## Kiến trúc

```
                    Internet / Máy Windows
                              │ 80, 443, 8443
                    ┌─────────▼──────────┐
                    │  Nginx (non-root)  │  HTTPS tự ký, security headers, rate-limit
                    └──┬──────────────┬──┘
           frontend    │              │
              ┌────────▼───┐   ┌──────▼──────┐
              │ Forum app  │   │ phpMyAdmin  │
              │ Node.js    │   └──────┬──────┘
              └────┬───────┘          │
   backend (internal: true)           │
              ┌────▼──────────────────▼┐
              │        MySQL 8.4       │  không publish cổng
              └────────────────────────┘

 monitoring: Prometheus ◄─ cAdvisor, node-exporter, nginx-exporter, mysqld-exporter, app /metrics
             Grafana  ◄─ Prometheus, Loki, Alertmanager
             Promtail ─► Loki ─(Ruler: luật LogQL)─► Alertmanager ◄─ Prometheus (luật metrics)
```

| Thành phần | Công nghệ | Truy cập |
|---|---|---|
| Website Forum | Node.js 20 + Express + EJS | `https://<IP>/` |
| Cơ sở dữ liệu | MySQL 8.4 | chỉ trong mạng nội bộ |
| Quản trị DB | phpMyAdmin 5.2 (sau Nginx + Basic Auth) | `https://<IP>:8443/` |
| Reverse proxy | Nginx 1.27 (unprivileged) | cổng 80 → 443 |
| Metrics | Prometheus 2.55 + exporters | `http://<IP>:9090/` |
| Dashboard | Grafana 11.3 | `http://<IP>:3000/` |
| Cảnh báo | Alertmanager 0.27 | `http://<IP>:9093/` |
| Log tập trung | Loki 3.2 + Promtail 3.2 | qua Grafana → Explore |

## Chạy hệ thống

Yêu cầu: Ubuntu 22.04/24.04 (máy ảo), Docker Engine + Docker Compose v2, RAM máy ảo ≥ 4 GB.

```bash
git clone https://github.com/<tai-khoan>/<ten-repo>.git
cd <ten-repo>
bash scripts/setup.sh          # tạo .env (mật khẩu ngẫu nhiên), chứng chỉ HTTPS, htpasswd
docker compose up -d --build   # chạy toàn bộ (lần đầu mất vài phút để tải image)
docker compose ps              # kiểm tra trạng thái
```

`scripts/setup.sh` in ra toàn bộ tài khoản đăng nhập. File `.env`, chứng chỉ và `htpasswd` **không** được đưa lên GitHub.

Dừng hệ thống: `docker compose down` (thêm `-v` để xóa cả dữ liệu).

## Cấu trúc thư mục

```
├── docker-compose.yml             # Phần 1: app + MySQL + phpMyAdmin + Nginx
├── docker-compose.monitoring.yml  # Phần 2: Prometheus + Grafana + Alertmanager + exporters
├── docker-compose.logging.yml     # Phần 3: Loki + Promtail
├── .env.example                   # mẫu biến môi trường (COMPOSE_FILE chọn file nào được chạy)
├── app/                           # mã nguồn website Forum + Dockerfile
├── mysql/init/                    # tạo bảng, dữ liệu mẫu, user DB quyền hạn chế
├── nginx/                         # nginx.conf, reverse proxy, security headers, SSL
├── monitoring/
│   ├── prometheus/                # prometheus.yml, alert.rules.yml
│   ├── alertmanager/              # alertmanager.yml
│   ├── grafana/                   # datasource + dashboard tự động (provisioning)
│   ├── loki/                      # loki-config.yaml, rules/fake/forum-security.yml
│   └── promtail/                  # promtail-config.yaml
└── scripts/                       # setup.sh, simulate-bruteforce.sh, simulate-sqli.sh
```

## Truy vấn LogQL mẫu (Grafana → Explore → Loki)

```logql
# 1. Toàn bộ log của Nginx
{job="nginx"}

# 2. Request lỗi 4xx/5xx trên Nginx
{service="nginx"} | json | status >= 400

# 3. Log lỗi/ngoại lệ của ứng dụng
{service="app"} |~ "(?i)(error|exception|failed)"

# 4. Đếm đăng nhập thất bại theo IP trong 5 phút
sum by (client_ip) (count_over_time({service="app", event="LOGIN_FAILED"} | json [5m]))

# 5. Truy vết chi tiết hành vi của 1 IP tấn công
{service="app"} | json | client_ip="192.168.1.10"
  | line_format "{{.ts}} {{.event}} user={{.user}} {{.path}} {{.status}}"
```

## Demo sự cố an toàn thông tin

```bash
bash scripts/simulate-bruteforce.sh https://localhost admin 30   # dò mật khẩu admin
bash scripts/simulate-sqli.sh https://localhost                    # dò SQL Injection / XSS
```

1. Nginx giới hạn 20 lần đăng nhập/phút/IP → trả **HTTP 429** khi vượt ngưỡng.
2. Ứng dụng ghi log `LOGIN_FAILED` (kèm IP, username, user-agent) → Promtail → Loki.
3. Loki Ruler phát hiện > 5 lần sai/phút từ 1 IP → cảnh báo **BruteForceLoginDetected** gửi tới Alertmanager.
4. Xem cảnh báo ở Alertmanager (`:9093`) và Grafana → Alerting; truy vết log ở dashboard **Forum - Log & An ninh**.

## Hardening đã áp dụng

- Container chạy **non-root**: app (uid 1000), Nginx unprivileged (uid 101), Grafana, Prometheus, Loki…
- `read_only`, `cap_drop: ALL`, `no-new-privileges`, giới hạn RAM/CPU/PID.
- **Network isolation**: `backend` là mạng `internal`, MySQL không publish cổng.
- **Mật khẩu mạnh** sinh ngẫu nhiên, nằm trong `.env` (quyền 600, không commit).
- **DB least privilege**: user `forum_app` chỉ SELECT/INSERT/UPDATE/DELETE; `exporter` chỉ đọc.
- **Nginx**: HTTPS (TLS 1.2/1.3), ẩn version, security headers + CSP, rate-limit, chặn `/metrics`, Basic Auth cho phpMyAdmin.
- **Ứng dụng**: mật khẩu băm bcrypt, truy vấn tham số hóa, CSRF token, cookie `HttpOnly`/`Secure`/`SameSite`.
