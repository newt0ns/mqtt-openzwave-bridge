# mqtt-openzwave-bridge
### Simple node.js app to expose the openzwave-shared library to mqtt

## Usage
Intended for use within a docker, uses environment variables to define several configuration options required for zwave library to know how to work in your environment.
#### Environment Variables
* __MQTT_HOST__ Your mqtt host with full URI, example "mqtt://myawesomemqttserver.com" (you'll probably want a fast local host due to the message rates the zwave controller can generate
* __MQTT_USER__(optional) mqtt user
* __MQTT_PASS__(optional) mqtt password
* __MQTT_ZWAVE_TOPIC__ mqtt topic you want to publish your zwave activity to. Remember when running in a docker you will need to pass your actual device through as well.
* __ZWAVE_DEVICE__ port/location the zwave stick is on. Examples for Windows: "\\\\.\\COM3", Linux:"/dev/ttyUSB0", Raspberry Pi:"/dev/ttyACM0"

#### Additional Configuration
The app will look for a OpenZwave.json configuration file in the __/zwave__ folder for additional configuration options, in addition to storing the openzwave logs there. A full list of configuration options can be found here: https://github.com/OpenZWave/open-zwave/wiki/Config-Options