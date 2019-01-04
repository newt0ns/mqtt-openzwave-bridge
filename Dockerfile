FROM ubuntu

MAINTAINER "Nate Stuart [newt0ns]"

# Compile openzwave-mqtt and it deps, then remove all unnecessary stuff.
# Must be done in single layer to reduce image size.
RUN apt-get update\
    && apt-get install -y --no-install-recommends git npm gcc g++ make libudev-dev \
    && apt-get clean
RUN export GIT_SSL_NO_VERIFY=true \
    && git clone https://github.com/OpenZWave/open-zwave.git \
    && cd open-zwave \
    && make install PREFIX=/usr \
    && cd .. \
    && cp -vr /usr/lib64/* /usr/lib \
    && ldconfig -v

RUN mkdir -p /usr/node_app \
    && export GIT_SSL_NO_VERIFY=true \
    && git clone https://github.com/newt0ns/mqtt-openzwave-bridge.git \
    && cd mqtt-openzwave-bridge

COPY . /usr/node_app
WORKDIR /usr/node_app
RUN npm config set registry http://registry.npmjs.org/  \
    && npm install --production

CMD ["npm", "start"]