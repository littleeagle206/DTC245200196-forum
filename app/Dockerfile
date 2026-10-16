# =============================================================
# Dockerfile cho ứng dụng Forum (Node.js)
# Hardening: image alpine nhỏ gọn, chỉ cài dependency production,
#            chạy bằng user "node" (KHÔNG chạy root).
# =============================================================
FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /usr/src/app

# Cài dependency trước để tận dụng cache của Docker
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

# Sao chép mã nguồn, chủ sở hữu là user node
COPY --chown=node:node src ./src
COPY --chown=node:node views ./views
COPY --chown=node:node public ./public

# Chạy bằng user không có đặc quyền (uid 1000)
USER node

EXPOSE 3000

# Docker tự kiểm tra sức khỏe container
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

CMD ["node", "src/server.js"]
