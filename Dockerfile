FROM ubuntu

MAINTAINER "Nate Stuart [newt0ns]"

# Compile openzwave-mqtt and it deps, then remove all unnecessary stuff.
# Must be done in single layer to reduce image size.
RUN apt-get update
RUN apt-get install -y git
RUN apt-get install -y npm gcc g++ libudev-dev libmosquitto-dev 
RUN git clone https://github.com/OpenZWave/open-zwave.git && cd open-zwave &&  git checkout V1.5 && make install PREFIX=/usr && cd .. && cp -v /usr/lib64/* /usr/lib && find /usr |grep libopenzwave && ldconfig -v

RUN mkdir -p /usr/node_app

RUN git clone https://github.com/newt0ns/mqtt-openzwave-bridge.git && cd mqtt-openzwave-bridge

COPY . /usr/node_app
WORKDIR /usr/node_app
RUN npm install --production

CMD ["npm", "start"]