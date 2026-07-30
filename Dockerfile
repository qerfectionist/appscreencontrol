FROM node:20-alpine
WORKDIR /app
COPY server/package*.json ./server/
WORKDIR /app/server
RUN npm install --production
COPY server/ ./
EXPOSE 5000
ENV PORT=5000
CMD ["node", "server.js"]
