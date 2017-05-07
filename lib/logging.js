const Syslog = require('syslog')
var syslog = null

var enable_logging = false

exports.setRemoteHost = function (remoteHost, remotePort) {
    syslog = Syslog.createClient(remotePort, remoteHost)
}

exports.log = function (someString) {
    if (enable_logging) console.log(someString)

    if (syslog !== null)
        syslog.info(someString)
}

exports.info = function (someValue) {
    var string = null

    if ((typeof someValue) === typeof ('')) {
        string = someValue
    } else {
        string = JSON.stringify(someValue)
    }

    if (syslog !== null)
        syslog.info(string)
}

exports.warn = function (someString) {
    console.log(someString)
    if (syslog !== null)
        syslog.warn(someString)

}

exports.set_enabled = function (enabled) {
    enable_logging = enabled
}