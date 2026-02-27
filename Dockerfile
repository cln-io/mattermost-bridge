# Use official Node.js runtime as base image
FROM node:22-alpine AS builder

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (including dev dependencies for build)
RUN npm ci --ignore-scripts

# Copy source code
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Production stage
FROM node:22-alpine AS production

# Create app user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S appuser -u 1001

# Set working directory
WORKDIR /app

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm ci --only=production --ignore-scripts && \
    npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Create necessary directories and set permissions
RUN mkdir -p logs data && \
    chown -R appuser:nodejs /app

# Change to app user
USER appuser

# Expose port (if needed later for health checks)
EXPOSE 3000

# Health check — fail if health.json is stale (>5 min) or WS in bad state
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e " \
    const fs = require('fs'); \
    try { \
      const h = JSON.parse(fs.readFileSync('/app/data/health.json','utf8')); \
      const age = Date.now() - h.timestamp; \
      if (age > 300000) { console.error('stale: ' + age + 'ms'); process.exit(1); } \
      if (/CLOSED|CLOSING|CONNECTING/.test(h.wsState)) { console.error('ws: ' + h.wsState); process.exit(1); } \
      console.log('ok: ' + h.wsState); \
    } catch(e) { console.error(e.message); process.exit(1); } \
  "

# Start the application directly with node
CMD ["node", "dist/index.js"]