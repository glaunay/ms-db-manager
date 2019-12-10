/*
* This is the logger module using winston package. Redirecting some logs into the standard output (Console).
* Setting up a log level need to be implemented before uses logs.
* Use the #levelMin variable to set up the minimum log level that will be used in the entire program.
* The default value of the log level is 'INFO'.
* Require this module with: 
*    import win = require('./lib/logger');
*
* Using examples:
* - win.logger.log('CRITICAL', <text>)      - Higher level of logger, critical error
* - win.logger.log('ERROR', <text>)         - Second level of logger, error
* - win.logger.log('WARNING', <text>)       - Third level of logger, warning message
* - win.logger.log('SUCCESS', <text>)       - 4th level of logger, success message
* - win.logger.log('INFO', <text>)          - 5th level of logger, info message
* - win.logger.log('DEBUG', <text>)         - Lower level of logger, debug mode
*/
const ws = require('winston');

const myCustomLevels = {
    levels: {
        fatal:0,
        error:1,
        warn: 2,
        success:3,
        info:4,
        debug:5,
        silly:6
        },
    colors: {
        fatal: 'red',
        error:  'red',
        warn:'yellow',
        success: 'green',
        info:  'cyan',
        debug: 'blue',
        silly : 'red'
    }
  };
// See winston format API at https://github.com/winstonjs/logform
const cLogger = ws.createLogger({
  format: ws.format.combine(
    ws.format.colorize(),
    ws.format.timestamp(),
    ws.format.printf((info:any) => `[${info.timestamp}] ${info.level}: ${info.message}`)
  ),
  levels: myCustomLevels.levels,
  transports: [new ws.transports.Console()]
});

ws.addColors(myCustomLevels.colors);

export type logLvl = 'debug'|'info'|'success'|'warn'|'error'|'critical'|'silly';
function isLogLvl (value:string) : value is logLvl {
    return value === 'debug' || value === 'info' || value === 'success' || value === 'warning'
    || value === 'error' || value === 'critical' || value === 'silly';
}
export function setLogLevel (value : string) : void {
    if (!isLogLvl(value)) throw `Unrecognized logLvel "${value}"`;
    cLogger.level = value;
}

interface fileTransportOptions {
  level?: logLvl, //Level of messages that this transport should log (default: level set on parent logger).
  silent?:Boolean, // Boolean flag indicating whether to suppress output (default false).
  filename: string,//The filename of the logfile to write output to.
  maxsize?: number,//Max size in bytes of the logfile, if the size is exceeded then a new file is created, a counter will become a suffix of the log file.
  maxFiles?: number,// Limit the number of files created when the size of the logfile is exceeded.
  tailable?: Boolean,// If true, log files will be rolled based on maxsize and maxfiles, but in ascending order. The filename will always have the most recent log lines. The larger the appended number, the older the log file. This option requires maxFiles to be set, or it will be ignored.
  maxRetries?: number, //The number of stream creation retry attempts before entering a failed state. In a failed state the transport stays active but performs a NOOP on it's log function. (default 2)
  zippedArchive?:Boolean,// If true, all log files but the current one will be zipped.
  options?:{} //options passed to fs.createWriteStream (default {flags: 'a'}).
}

export function setFile(options:fileTransportOptions) {
  cLogger.add(options);
}

export {cLogger as logger};