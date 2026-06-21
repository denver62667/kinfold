# Kinfold — container image
FROM node:20-alpine

WORKDIR /app

# Install dependencies first (better layer caching).
COPY package*.json ./
RUN npm install --omit=dev

# App source.
COPY . .

ENV NODE_ENV=production
# Most platforms inject PORT; default to 3000 locally.
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server/index.js"]
