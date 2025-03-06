FROM node:17.3.0-alpine3.13

# Create app directory
WORKDIR /usr/src/app

# Copy application dependency manifests to the container image.
COPY  package*.json ./

RUN apk update
RUN apk add --no-cache --virtual add g++ make python3 py3-pip ffmpeg
RUN npm i --ignore-engines
RUN npm install -g nodemon
RUN npm install -g typescript

COPY . .

# Expose the necessary ports (optional if needed)
EXPOSE 1883 8883 443

CMD ["node", "src/index.js"]