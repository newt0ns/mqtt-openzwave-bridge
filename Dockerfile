FROM node:6

RUN mkdir -p /usr/node_app
COPY . /usr/node_app
WORKDIR /usr/node_app
RUN npm install --production

CMD ["npm", "start"]