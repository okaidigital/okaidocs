FROM node:22-alpine

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

COPY --chown=node:node index.html server.js ./
COPY --chown=node:node files ./blank-files
RUN mkdir -p /app/files && chown node:node /app/files

USER node

EXPOSE 3000

CMD ["node", "server.js"]
