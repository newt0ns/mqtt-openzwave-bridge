
const logging = require('./lib/logging.js')
const util = require('util')
const OpenZwave = require('openzwave-shared')
const mqtt = require('mqtt')
const fs = require('fs')

var ozw = null
var ozwConfig = {}
var openZwaveOptions = {}
var ozwConnected = false
var nodeMap = {}
var driverReadyStatus = false
var allowunreadyupdates = true
var mqttConnected = false
var basedir = "/zwave/"
var configFile = basedir + "OpenZwave.json"
var nodeMapFile = basedir + "NodeMap.json"
var UUIDPREFIX = "_macaddr_"
var HOMENAME = "_homename_"

var nodes = {}

logging.set_enabled(true)

var ozwEvents = {
    'driver ready': driverReady,
    'driver failed': driverFailed,
    'node added': nodeAdded,
    'node ready': nodeReady,
    'node event': nodeEvent,
    'value added': valueAdded,
    'value changed': valueChanged,
    'value removed': valueRemoved,
    'notification': notification,
    'scan complete': scanComplete,
    'controller command': controllerCommand
}

// Config
const mqttHost = process.env.MQTT_HOST
const mqttUsername = process.env.MQTT_USER
const mqttPassword = process.env.MQTT_PASS
const zwaveDevice = process.env.ZWAVE_DEVICE
const zwaveTopic = (process.env.MQTT_ZWAVE_TOPIC).endsWith("/") ? process.env.MQTT_ZWAVE_TOPIC : process.env.MQTT_ZWAVE_TOPIC + "/"

//Load zwave options file
if (fs.existsSync(configFile)) {
    openZwaveOptions = JSON.parse(fs.readFileSync(configFile, "utf8"))
}

//Load node id to node name map file
if (fs.existsSync(nodeMapFile)) {
    nodeMap = JSON.parse(fs.readFileSync(nodeMapFile, "utf8"))
}

// Setup MQTT
var mqttOptions = {}
if (mqttUsername !== null && mqttUsername !== undefined)
    mqttOptions.username = mqttUsername
if (mqttPassword !== null && mqttPassword !== undefined)
    mqttOptions.password = mqttPassword

client = mqtt.connect(mqttHost, mqttOptions)

// MQTT Observation
client.on('error', (error) => {
    logging.log("mqtt error: " + error)
})

client.on('connect', () => {
    logging.log('mqtt connected')
    mqttConnected = true
    client.subscribe(zwaveTopic + 'set/#')
    client.subscribe(zwaveTopic + 'configure/#')

    ///Wait for mqtt connection before we fire up the zwave controller the first time to ensure we capture all activity
    if (!ozwConnected) {

        ozw = new OpenZwave(openZwaveOptions)

        //Map the callbacks to zwave events
        Object.keys(ozwEvents).forEach(function (evt) {
            logging.log('addListener ' + evt)
            ozw.on(evt, ozwEvents[evt])
        })

        /* time to connect to zwave stick */
        logging.log('connecting to ' + zwaveDevice)
        ozw.connect(zwaveDevice)
        ozwConnected = true
    }
})

//I thought you loved me!?
client.on('disconnect', () => {
    logging.log('mqtt reconnecting...\n')
    client.connect(mqttHost, mqttOptions) //You'll come around
})


//Direct the zwave topic to the appropriate function
client.on('message', (topic, message) => {
    logging.log("mqtt message recieved, topic:" + topic + " message:" + message)
    var trimmedTopic = topic.substring(zwaveTopic.length)

    switch (true) {
        case trimmedTopic.startsWith("set/"):
            zwaveSetMessage(topic, message)
            break
        case trimmedTopic.startsWith("configure/"):
            zwaveConfigMessage(topic, message)
            break
        default:
            break
    }

})


function zwaveConfigMessage(topic, message) {
    try {
        var args = JSON.parse(message)

        logging.log("zwaveConfigMessage(" + topic + "," + JSON.stringify(args, null, 2))


        switch (true) {
            case /setNodeName/.test(topic):
                if (!(args.nodeid === undefined || args.nodeid === null) && !(args.name === undefined || args.name === null)) {
                    logging.log("zwaveConfigMessage(): Setting node[" + args.nodeid + "] name to " + args.name)
                    nodeMap[args.nodeid] = args.name.replace("/", "_")
                    fs.writeFile(nodeMapFile, JSON.stringify(nodeMap), function (err) {
                        if (err) {
                            logging.error("Error saving nodeMapFile " + err)
                        }
                        logging.log("The nodeMapFile was saved!");
                    });

                }
                break
            case /getNodeNames/.test(topic):
                logging.log("zwaveConfigMessage(): getNodeNames: " + JSON.stringify(nodeMap, null, 2))
                zwcallback("configureResult/getNodeNames", JSON.stringify(nodeMap))
                break
            case /unsetNodeName/.test(topic):
                if (!(args.nodeid === undefined || args.nodeid === null) && !(args.name === undefined || args.name === null)) {
                    nodeMap[args.nodeid] = args.name.replace("/", "_")
                    fs.write(nodeMapFile, JSON.stringify(nodeMap))
                }
                break
        }

    }
    catch (err) {

    }

}


//Parse the incomming mqtt message for some basic actions, or delve into the full API
function zwaveSetMessage(topic, message) {
    try {

        logging.log(' mqtt message received, topic:' + topic + ', message: ' + message)

        var payload

        try {
            //We're expecting all messages to be in a JSON format
            payload = JSON.parse(message)
        } catch (err) {
            logging.warn('Illegal message! Msg:"' + message + '"  Error:(' + err + ')')
            return
        }

        logging.log(JSON.stringify(payload, null, 2))

        switch (true) {
            // switch On/Off: for basic single-instance switches and dimmers
            case /switchOn/.test(topic):
                ozw.setValue(payload.nodeid, 37, 1, 0, true)
                break
            case /switchOff/.test(topic):
                ozw.setValue(payload.nodeid, 37, 1, 0, false)
                break

            // setLevel: for dimmers
            case /setLevel/.test(topic):
                ozw.setValue(payload.nodeid, 38, 1, 0, payload.value)
                break

            // setValue: for everything else
            case /setValue/.test(topic):
                logging.log(util.format("ZWaveOut.setValue payload: %j", payload))
                ozw.setValue(
                    payload.nodeid, (payload.cmdclass || 37), // default cmdclass: on-off
                    (payload.instance || 1), // default instance
                    (payload.cmdidx || 0), // default cmd index
                    payload.value
                )
                break

            /* EXPERIMENTAL: send basically every available command down
             * to OpenZWave, just name the function in the message topic
             * and pass in the arguments as "payload.args" as an array:
             * {"topic": "someOpenZWaveCommand", "payload": {"args": [1, 2, 3]}}
             * If the command needs the HomeID as the 1st arg, use "payload.prependHomeId"
             * */
            default:
                if (topic && typeof ozw[topic] === 'function' && payload) {

                    var args = payload.args || []

                    if (payload.prependHomeId) args.unshift(ozwConfig.homeid)

                    logging.log('attempting direct API call to ' + topic + '()')

                    try {
                        var result = ozw[topic].apply(ozw, args)
                        logging.log('direct API call success, result=' + JSON.stringify(result))
                        if (typeof result != undefined) {
                            payload.result = result
                            // send off the direct API call's result to the output
                            client.publish(zwaveTopic + '/apiResult/' + topic, JSON.stringify(payload))
                        }
                    } catch (err) {
                        logging.log('direct API call to ' + topic + ' failed: ' + err, 'error')
                    }
                }
        }
    }
    catch (ex) {
        logging.warn('zwave error (' + ex + ')')
        zwcallback("zwave error", ex)
        return
    }
}

//Zwave driver ready
function driverReady(homeid) {
    driverReadyStatus = true
    ozwConfig.homeid = homeid
    var homeHex = '0x' + homeid.toString(16)
    HOMENAME = homeHex
    ozwConfig.name = homeHex
    logging.log('scanning network with homeid: ' + homeHex)
    zwcallback('driver ready', ozwConfig)
}

//Zwave driver went badly
function driverFailed() {
    zwcallback('driver failed', ozwConfig)
    process.exit()
}

//New node seen on network for this session
function nodeAdded(nodeid) {
    nodes[nodeid] = {
        manufacturer: '',
        manufacturerid: '',
        product: '',
        producttype: '',
        productid: '',
        type: '',
        name: '',
        loc: '',
        classes: {},
        ready: false,
    }
    zwcallback('node added', {
        "nodeid": nodeid
    })
}

//New node value found
function valueAdded(nodeid, comclass, valueId) {
    var ozwnode = nodes[nodeid]
    if (!ozwnode) {
        logging.log('valueAdded: no such node: ' + nodeid + ' error!')
    }
    if (!ozwnode['classes'][comclass])
        ozwnode['classes'][comclass] = {}
    if (!ozwnode['classes'][comclass][valueId.instance])
        ozwnode['classes'][comclass][valueId.instance] = {}
    // add to cache
    logging.log("valueAdded: " + JSON.stringify(valueId))
    ozwnode['classes'][comclass][valueId.instance][valueId.index] = valueId
    // tell NR
    zwcallback('value added', {
        "nodeid": nodeid,
        "cmdclass": comclass,
        "instance": valueId.instance,
        "cmdidx": valueId.index,
        "currState": valueId['value'],
        "label": valueId['label'],
        "units": valueId['units'],
        "value": valueId
    })
}

function valueChanged(nodeid, comclass, valueId) {
    var ozwnode = nodes[nodeid]
    if (!ozwnode) {
        logging.log('valueChanged: no such node: ' + nodeid, 'error')
    } else {
        // valueId: OpenZWave ValueID (struct) - not just a boolean
        var oldst
        if (ozwnode.ready || allowunreadyupdates) {
            oldst = ozwnode['classes'][comclass][valueId.instance][valueId.index].value
            logging.log(util.format(
                'zwave node %d: changed: %d:%s:%s -> %j', nodeid, comclass,
                valueId['label'], oldst, JSON.stringify(valueId)))
            // tell NR only if the node is marked as ready
            zwcallback('value changed', {
                "nodeid": nodeid,
                "cmdclass": comclass,
                "cmdidx": valueId.index,
                "instance": valueId.instance,
                "oldState": oldst,
                "currState": valueId['value'],
                "label": valueId['label'],
                "units": valueId['units'],
                "value": valueId
            })
        }
        // update cache
        ozwnode['classes'][comclass][valueId.instance][valueId.index] = valueId
    }
}

//aaaaand it's gone
function valueRemoved(nodeid, comclass, instance, index) {
    var ozwnode = nodes[nodeid]
    if (ozwnode &&
        ozwnode['classes'] &&
        ozwnode['classes'][comclass] &&
        ozwnode['classes'][comclass][instance] &&
        ozwnode['classes'][comclass][instance][index]) {
        delete ozwnode['classes'][comclass][instance][index]
        zwcallback('value deleted', {
            "nodeid": nodeid,
            "cmdclass": comclass,
            "cmdidx": index,
            "instance": instance
        })
    } else {
        logging.log('valueRemoved: no such node: ' + nodeid, 'error')
    }
}

//Completed the scanning of this node, we're good to do what we want with it now
function nodeReady(nodeid, nodeinfo) {
    var ozwnode = nodes[nodeid]
    if (ozwnode) {
        for (var attrname in nodeinfo) {
            if (nodeinfo.hasOwnProperty(attrname)) {
                ozwnode[attrname] = nodeinfo[attrname]
            }
        }
        ozwnode.ready = true
        //
        logging.log('nodeReady: only|R|W| (nodeid-cmdclass-instance-index): type : current state')
        for (var comclass in ozwnode['classes']) {

            switch (comclass) {
                case 0x25: // COMMAND_CLASS_SWITCH_BINARY
                case 0x26: // COMMAND_CLASS_SWITCH_MULTILEVEL
                case 0x30: // COMMAND_CLASS_SENSOR_BINARY
                case 0x31: // COMMAND_CLASS_SENSOR_MULTILEVEL
                case 0x60: // COMMAND_CLASS_MULTI_INSTANCE
                    log.logging("         => Enabling polling for node " + nodeid + ":" + comclass)
                    ozwDriver.enablePoll(nodeid, comclass)
                    break
            }
            var values = ozwnode['classes'][comclass]

            for (var inst in values)
                for (var idx in values[inst]) {
                    var ozwval = values[inst][idx]
                    var rdonly = ozwval.read_only ? '*' : ' '
                    var wronly = ozwval.write_only ? '*' : ' '
                    logging.log('           =>' + util.format(
                        '\t|%s|%s| %s: %s:\t%s\t', rdonly, wronly, ozwval.value_id, ozwval.label, ozwval.value))
                }
        }

        zwcallback('node ready', {
            nodeid: nodeid,
            nodeinfo: nodeinfo
        })
    }
}

//Something evented
function nodeEvent(nodeid, evtcode) {
    logging.log('nodeEvent: ' + util.format('node %d: %d', nodeid, evtcode))
    zwcallback('node event', {
        "nodeid": nodeid,
        "event": evtcode
    })
}

//zwave controller notifications land here, timeouts, sleep notifications, etc.
function notification(nodeid, notif, help) {
    logging.log('notification: ' + util.format('node %d: %s', nodeid, help))
    zwcallback('notification', {
        nodeid: nodeid,
        notification: notif,
        help: help
    })
}

//Like a 90's flatbed
function scanComplete() {
    logging.log('network scan complete.')
    zwcallback('scan complete', {})
}

//Controller command responses, often from API calls
function controllerCommand(nodeid, state, errcode, help) {
    var obj = {
        nodeid: nodeid,
        state: state,
        errcode: errcode,
        help: help
    }
    logging.log('controllerCommannd: ' + util.format('command feedback received: %j', JSON.stringify(obj)))
    zwcallback('controller command', obj)
}

//dispatch OpenZwave events to mqtt
function zwcallback(event, arghash) {
    logging.log('zwcallback: ' + util.format("%s, args: %j", event, arghash))
    try {
        var nodeDesc = ""
        var label = ""

        if (!(arghash['nodeid'] === undefined || arghash['nodeid'] === null)) {
            var nodeid = arghash['nodeid']
            label = (arghash['label'] != undefined) ? arghash['label'].toLowerCase()+ "/" : ""
            var nodeName = nodeMap[nodeid]
            if (!(nodeName === undefined || nodeName === null)) {
                nodeDesc = nodeName + "/";
            }
            else {
                nodeDesc = "node_" + nodeid + "/"
            }
        }
    }
    catch (err) {
        logging.log("zwcallback: error, " + err)
    }

    client.publish(zwaveTopic + nodeDesc + label + event, JSON.stringify(arghash))

}

