#!/usr/bin/env bash
# =============================================================
# Kiểm tra môi trường máy ảo Ubuntu trước khi triển khai Đề 15 (Forum)
#   bash scripts/check-env.sh
# [OK] = đạt   [!!] = cần sửa   [--] = lưu ý / tuỳ chọn
# =============================================================
ok()   { printf "\e[32m[OK]\e[0m %s\n" "$*"; }
bad()  { printf "\e[31m[!!]\e[0m %s\n" "$*"; FAIL=$((FAIL+1)); }
note() { printf "\e[33m[--]\e[0m %s\n" "$*"; }
FAIL=0

echo "===== 1. HE DIEU HANH & TAI NGUYEN ====="
. /etc/os-release 2>/dev/null && ok "He dieu hanh: ${PRETTY_NAME}"
case "${VERSION_ID}" in 22.04|24.04) ;; *) note "Nen dung Ubuntu 22.04 hoac 24.04";; esac
RAM_MB=$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo)
[ "$RAM_MB" -ge 3800 ] && ok "RAM: ${RAM_MB} MB" || bad "RAM: ${RAM_MB} MB (can >= 4096 MB, nen 6144 MB)"
CPU=$(nproc); [ "$CPU" -ge 2 ] && ok "CPU: ${CPU} core" || bad "CPU: ${CPU} core (can >= 2)"
DISK_GB=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
[ "$DISK_GB" -ge 10 ] && ok "O dia trong: ${DISK_GB} GB" || bad "O dia trong: ${DISK_GB} GB (can >= 10 GB)"
[ -f /sys/fs/cgroup/cgroup.controllers ] && ok "cgroup v2 (cAdvisor chay tot)" || note "cgroup v1 - cAdvisor van chay, chi luu y"

echo; echo "===== 2. MANG ====="
IP=$(hostname -I | awk '{print $1}')
[ -n "$IP" ] && ok "IP may ao: ${IP}  (dung IP nay tren trinh duyet Windows)" || bad "Khong lay duoc IP"
curl -s -m 8 -o /dev/null https://github.com && ok "Ra Internet duoc (github.com)" || bad "Khong ra Internet - kiem tra card mang VMware (NAT)"
systemctl is-active --quiet ssh 2>/dev/null && ok "SSH server dang chay (Antigravity Remote-SSH)" || bad "SSH chua chay: sudo apt install -y openssh-server && sudo systemctl enable --now ssh"

echo; echo "===== 3. CONG CU ====="
for c in git curl openssl unzip; do
  command -v $c >/dev/null && ok "Da co $c" || bad "Thieu $c: sudo apt install -y $c"
done
[ -n "$(git config --global user.name)" ] && ok "git user.name = $(git config --global user.name)" || bad "Chua dat: git config --global user.name \"Ho Ten\""
[ -n "$(git config --global user.email)" ] && ok "git user.email = $(git config --global user.email)" || bad "Chua dat: git config --global user.email \"email@...\""

echo; echo "===== 4. DOCKER ====="
if command -v docker >/dev/null; then
  ok "Docker: $(docker --version)"
  if docker compose version >/dev/null 2>&1; then ok "Compose: $(docker compose version --short) (v2 - dung lenh 'docker compose')"
  else bad "Thieu Docker Compose v2 - cai lai bang: curl -fsSL https://get.docker.com | sudo sh"; fi
  systemctl is-active --quiet docker 2>/dev/null && ok "Docker daemon dang chay" || bad "Docker chua chay: sudo systemctl enable --now docker"
  if docker info >/dev/null 2>&1; then ok "Chay docker khong can sudo"
  else bad "Chua dung docker khong can sudo: sudo usermod -aG docker \$USER  roi DANG XUAT va dang nhap lai"; fi
  if docker run --rm hello-world >/dev/null 2>&1; then ok "Tai va chay image tu Docker Hub duoc (hello-world)"
  else bad "Khong chay duoc hello-world - kiem tra Internet / quyen docker"; fi
else
  bad "Chua cai Docker: curl -fsSL https://get.docker.com | sudo sh"
fi
command -v docker-compose >/dev/null && note "Co 'docker-compose' v1 cu - KHONG dung, hay dung 'docker compose'"

echo; echo "===== 5. CONG CAN TRONG (80 443 8443 3000 9090 9093) ====="
for p in 80 443 8443 3000 9090 9093; do
  who=$(sudo -n ss -ltnp 2>/dev/null "sport = :$p" | awk 'NR>1{print $NF}' | head -1)
  if ss -ltn "sport = :$p" | grep -q LISTEN; then
    if echo "$who" | grep -q docker-proxy; then note "Cong $p dang duoc Docker dung (container cua ban dang chay - OK)"
    else bad "Cong $p dang bi chiem ${who} - vd: sudo systemctl disable --now apache2 nginx"; fi
  else ok "Cong $p trong"; fi
done

echo; echo "===== 6. THU MUC PROJECT ====="
D="${1:-$HOME/forum}"
if [ -d "$D/.git" ]; then
  ok "Repo git: $D  (remote: $(git -C "$D" remote get-url origin 2>/dev/null || echo chua co))"
  [ -f "$D/.env" ] && ok ".env da tao" || note ".env chua co - se tao khi chay: bash scripts/setup.sh"
  if [ -d "$D/scripts" ] && grep -lq $'\r' "$D"/scripts/*.sh "$D"/mysql/init/*.sh 2>/dev/null; then
    bad "File .sh bi xuong dong Windows (CRLF): sed -i 's/\r\$//' scripts/*.sh mysql/init/*.sh"
  fi
else
  note "Chua co repo tai $D - lam muc 4.3/4.4 trong huong dan (git clone)"
fi

echo
[ "$FAIL" -eq 0 ] && printf "\e[32m==> MOI TRUONG SAN SANG.\e[0m\n" || printf "\e[31m==> Con %d muc can sua (dong [!!]).\e[0m\n" "$FAIL"
