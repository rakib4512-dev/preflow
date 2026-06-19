FROM node:20-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./

# Node 20 satisfies engines requirement (>=20.19). Install all deps including
# dev so vite is available for the build step.
RUN npm ci && npm cache clean --force

COPY . .

RUN npm run build

CMD ["npm", "run", "docker-start"]
