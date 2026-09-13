# Deployable image for the Part 2 job-source agent web demo.
# Playwright's base image ships Chromium plus its system dependencies, which the
# agent needs to render JS-only career pages (Workday, Ashby embeds, SPA sites).
FROM mcr.microsoft.com/playwright:v1.49.1-noble

WORKDIR /app
ENV NODE_ENV=production \
    USE_BROWSER=1 \
    CACHE_DIR=/tmp/jobsource-cache \
    PORT=3000

# Install deps first so the layer caches across source edits.
COPY package.json package-lock.json* tsconfig.base.json ./
COPY part2-job-source-agent/package.json ./part2-job-source-agent/
COPY part3-auto-apply-agent/package.json ./part3-auto-apply-agent/
RUN npm install --omit=dev --no-audit --no-fund || npm install --no-audit --no-fund

COPY . .

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "serve"]
