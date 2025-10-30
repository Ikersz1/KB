cat > Dockerfile.app << 'DOCK'
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# si tu front necesita build: (ajusta si tu script es distinto)
RUN npm run build || true
ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000
CMD ["node", "src/server/index.js"]
DOCK
