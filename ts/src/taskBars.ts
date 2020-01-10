import { unixTimeStamp } from './utils';
import cliProgress = require('cli-progress');
import _colors = require('colors');
import { logger } from "./logger";
import * as t from "./cType";
import { inspect } from 'util';
let TASK_BAR:any;

type taskDatabasePayload = Pick<t.activeTaskDatabase, 'database'|'started_on'|'total_changes'>;

// Mandatory singleton
export function createTaskBar() {
    TASK_BAR = new cliProgress.MultiBar({
        clearOnComplete: false,
        hideCursor: true, //forceRedraw
        format: formatter
    }, cliProgress.Presets.shades_grey);

    //return mBar;
}

export function addTask(oTask:t.taskTypes) {
    const payload:taskDatabasePayload = {
        database : oTask.database,
        total_changes : oTask.total_changes,
        started_on : oTask.started_on 
    }
    logger.debug(`taskBars::addTask: creatint w/ payload ${inspect(payload)}`);
    const _bar = TASK_BAR.create(payload.total_changes, 0, payload);
    logger.debug(`About to listen to ${inspect(oTask)}`);
    oTask.on("update"   , () => { _bar.update(oTask.changes_done, payload)  });
    oTask.on("completed", () => { _bar.update(oTask.total_changes, payload) });
}

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