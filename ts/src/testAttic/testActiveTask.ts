import program = require ("commander");
import { logger, muteLogger, setLogLevel, setFile, logLvl } from "./logger";
import { inspect } from 'util';
import { unixTimeStamp } from './utils';
import { start, getTasks } from './activeTask';
import cliProgress = require('cli-progress');
import _colors = require('colors');

program
  .option("-v, --verbosity <logLevel>", "Set log level (debug, info, success, warning, error, critical)", "debug")
  .option("-t, --target <couchDB endpoint>", "URL to couchDB server")
  .option("-o, --output <logFile>", "fpath to the log file", "watcher.log")
  .parse(process.argv);

setLogLevel(program.verbosity);
if (!program.target) {
    logger.fatal("Please specify --target");
    process.exit(0);
}

logger.info("Starting task monitoring");

muteLogger();
setFile({ "level": program.verbosity, "filename" : program.output, options : {flags: 'w'} });

( async () => {
    const url = program.target;
//start('http://wh_agent:couch@localhost:5984');
    const taskMonitor = await start(url);
    const taskObjs = []
    if(program.database)
        taskObjs.push( ...await getTasks({database : program.database, type : 'indexer'}) );
    //logger.info(inspect(taskObjs));

    taskMonitor.on("newTask", (oTask:any) => {
        logger.debug(`CATCH ${inspect(oTask)}`);
    })
})();

function formatter (options:any, params:any, payload:any) {
    const bar = options.barCompleteString.substr(0, Math.round(params.progress*options.barsize))
                 + options.barIncompleteString.substr(Math.round(params.progress*options.barsize), options.barsize);
    const nameMaxChar = 50;
    let name = payload.database;
    const elid = '...';
    if (name.length > nameMaxChar) {
        name = elid + name.substr(-(nameMaxChar - elid.length))
    } else {
        name = ' '.repeat(nameMaxChar - name.length) + name; 
    }
    const percentage = Math.round(params.progress * 100);
    
    if (params.value >= params.total){
        if (! payload.hasOwnProperty('completedIn'))
            payload.completedIn = unixTimeStamp() - payload.started_on;
        return _colors.green(name + ' ' + bar + ' ' + percentage + '%| COMPLETED IN : ' + stringifyTime(payload.completedIn) + '| TOTAL CHANGES ' + params.value);
    } else {
        return _colors.grey(name) + ' ' + bar + ' ' + percentage + '%| ETA: ' +  stringifyTime(params.eta) + ' | changes : ' + params.value + '/' + params.total;
    }

}

function stringifyTime(time:number) {
   /* logger.debug(inspect(time)+ "\n");
    dStream.write(`${time%3600}\n`);
    dStream.write(`${Math.floor((time%3600) / 60)}\n`);
    dStream.write(`${Math.floor(time%3600 / 60)}\n######\n`);
    */
    const h = Math.floor(time / 3600) > 0 ? `${Math.floor(time / 3600)}h` : '';
    const m = Math.floor(time%3600 / 60) > 0 ? `${Math.floor((time%3600) / 60)}m` : '';
    const s = `${(time%3600)%60}s`;
    return `${h}${m}${s}`;
}
