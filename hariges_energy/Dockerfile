ARG BUILD_FROM
FROM ${BUILD_FROM}

RUN apk add --no-cache nodejs npm

WORKDIR /app
COPY package*.json server.js ./
RUN npm install --omit=dev
COPY lib ./lib
COPY public ./public
COPY run.sh /run.sh
RUN chmod a+x /run.sh && mkdir -p /data

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    HA_URL=http://supervisor/core \
    DATA_FILE=/data/runtime.json

EXPOSE 3000
CMD ["/run.sh"]
