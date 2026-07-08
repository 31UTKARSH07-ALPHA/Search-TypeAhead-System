FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY services/search-service/package.json services/search-service/package.json
RUN npm ci --workspace @typeahead/shared-types --workspace @typeahead/search-service --include-workspace-root

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared-types ./packages/shared-types
COPY services/search-service ./services/search-service
RUN npm run build --workspace @typeahead/shared-types
RUN npm run build --workspace @typeahead/search-service

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared-types ./packages/shared-types
COPY --from=build /app/services/search-service ./services/search-service
WORKDIR /app/services/search-service
EXPOSE 4001
CMD ["npm", "run", "start"]
