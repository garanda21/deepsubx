# Build stage
FROM node:24-slim AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:24-slim

# Install FFmpeg & Nginx
RUN apt-get update && \
    apt-get install -y ffmpeg && \
    apt-get install -y nginx && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built assets and server files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server

# Copy nginx configuration
COPY nginx.conf ./nginx.conf

# Create directories for data and temp files
RUN mkdir -p /data /movies /tmp/subtitles

# Set environment variables
ENV NODE_ENV=production \
    DATA_DIR=/data \
    MOVIES_DIR=/movies \
    TEMP_DIR=/tmp/subtitles

# Expose both ports
EXPOSE 3000 80

# Create start script
RUN echo '#!/bin/sh\nnginx -c /app/nginx.conf -g "daemon off;" & node server/index.js' > start.sh  && \
chmod +x start.sh

# Start both nginx and node server
CMD ["./start.sh"]
