FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY *.js ./
ENV PORT=8080 DATA_DIR=/data DIST_DIR=/game/dist IMG_DIR=/game/img
EXPOSE 8080
CMD ["node", "server.js"]
