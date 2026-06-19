FROM node:18-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./

# Install all deps (including dev) so vite is available for the build step
RUN npm ci && npm cache clean --force

COPY . .

RUN npm run build

# Drop dev deps — vite and other build tools are no longer needed at runtime
RUN npm prune --omit=dev

CMD ["npm", "run", "docker-start"]
