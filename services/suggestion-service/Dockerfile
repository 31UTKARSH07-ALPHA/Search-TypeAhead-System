FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY services/suggestion-service/package.json services/suggestion-service/package.json
RUN npm ci --workspace @typeahead/shared-types --workspace @typeahead/suggestion-service --include-workspace-root

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared-types ./packages/shared-types
COPY services/suggestion-service ./services/suggestion-service
RUN npm run build --workspace @typeahead/shared-types
RUN npm run build --workspace @typeahead/suggestion-service

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared-types ./packages/shared-types
COPY --from=build /app/services/suggestion-service ./services/suggestion-service
WORKDIR /app/services/suggestion-service
EXPOSE 4002
CMD ["npm", "run", "start"]
