import { EventEmitter } from "events";
import * as t from "./cType";
import fetch from "node-fetch";
import { logger } from "./logger";
import { inspect } from 'util';
import { union, intersection } from "./utils";
/*
interface activeTaskCore {
    changes_done:number// – Processed changes
    database:string // – Source database
    pid:string// – Process ID
    progress:number// Current percentage progress
    started_on:number//Task start time as unix timestamp
    status:string//Task status message
    task:string//Task name
    total_changes:number//Total changes to process
    type:string//Operation Type
    updated_on:number//Unix timestamp of last operation update
}
*/
type taskSpecs = activeTaskCompaction|activeTaskIndexer;
type taskType = "replication" | "indexer" | "database_compaction"; 
export type taskObjs = CompactionTask|IndexerTask ;

interface taskConstraints {
    database?: string
    type?:taskType
}

interface activeTaskCore {
    pid        : string;
    progress   : string;
    started_on : string;
    type       : taskType;
    updated_on : number;
}

export interface activeTaskCompaction extends activeTaskCore {
    database      : string
    changes_done  : number
    total_changes : number
}

interface activeTaskIndexer  extends activeTaskCompaction {
    design_document : string
}

interface activeTaskReplicator extends activeTaskCore {
    checkpointed_source_seq : number
    continuous              : boolean
    doc_id                  : any
    doc_write_failures      : number
    docs_read               : number
    docs_written            : number
    missing_revisions_found : number
    replication_id          : string
    revisions_checked       : number
    source                  : string
    source_seq              : number
    target                  : string
}

function _checkHeader(h:string[], o:{[k:string]: any }) {
    for (let k of h )
        if (!o.hasOwnProperty(k))
            return false;
    return true;
}

const coreHeader = ['pid', 'progress', 'started_on', 'type', 'updated_on'];
function isActiveTaskDocument(data:any): data is activeTaskCore {
    return _checkHeader(coreHeader, data)
}

const compactionHeader = ['database', 'changes_done', 'total_changes'];
function isActiveTaskCompaction(data:any, asSuper:boolean=false): data is activeTaskCompaction {
    if (!isActiveTaskDocument(data))
        return false;
    if (!_checkHeader(compactionHeader, data))
        return false;
    if (asSuper)
        return true;
    return data.type === 'database_compaction';
}

function isActiveTaskIndexer(data:any): data is activeTaskIndexer {
    if (!isActiveTaskCompaction(data, true))
        return false;
    if (!data.hasOwnProperty("design_document"))
        return false;
    return data.type === 'indexer';
}

function isTaskSpecs(data:any): data is taskSpecs {
    if(isActiveTaskIndexer(data))
        return true;
    if (isActiveTaskCompaction(data))
        return true;
    
    return false;
}


const replicatorHeader = [ "checkpointed_source_seq", "continuous", "doc_id", "doc_write_failures", 
                            "docs_read", "docs_written", "missing_revisions_found", "replication_id", 
                            "revisions_checked", "source", "source_seq", "started_on", "target" ];
function isActiveTaskReplicator(data:any): data is activeTaskReplicator {
    if (!isActiveTaskDocument(data))
        return false;
    if (!_checkHeader(replicatorHeader, data))
        return false;
    return data.type === 'replication';
}

let oTaskCollection:TaskCollection;
export async function start(url:string, msc:number=1500):Promise<EventEmitter> {
    const emitter = new EventEmitter();
    const urlRoot =  `${url}/_active_tasks`;
    oTaskCollection = new TaskCollection(urlRoot);
    try {
        const resp = await fetch(url, { method : 'GET'});
        const dbHello = await resp.json();
    } catch(e) {
        logger.fatal(`activeTask::start: Fail handshake at ${url}`);
    }
    
    logger.debug(`activeTask::start:Tracking active task from ${urlRoot} at ${msc}ms`);
    
    pulse(oTaskCollection.urlRoot).then(()=> 
        setInterval( pulse, msc, urlRoot, emitter)
    );
    return emitter;
}

export async function getTasks(data:taskConstraints, strict:boolean=true):Promise<taskObjs[]> {
    const res:taskObjs[] = [];

    logger.debug(`activeTask::getTasks:  input constraints is ${inspect(data)} ... auto pulse`);
    await pulse(oTaskCollection.urlRoot);

    let taskSet1:Set<taskObjs>|undefined;

     
    if (data.hasOwnProperty('database')) {
        taskSet1 = new Set();
        const l1 = oTaskCollection.pullByDatabase(<string>data.database);
        if(l1)
            l1.forEach((d) => { (taskSet1 as Set<taskObjs>).add(d); });
    }

    let taskSet2:Set<taskObjs>|undefined;
    if (data.hasOwnProperty('type')) {
        taskSet2 = new Set();
        const l2 = oTaskCollection.pullByType(<string>data.type);
        if(l2)
            l2.forEach((d) => { (taskSet2 as Set<taskObjs>).add(d); });
    }
    if (taskSet1 && taskSet2) {
        logger.debug(`activeTask::getTasks: bufferSets sizes ${taskSet1.size} ${taskSet2.size}`);
        const fn = strict ? intersection : union;
        return <taskObjs[]>Array.from( fn(taskSet1, taskSet2) );
    }
    if (taskSet1)
        return <taskObjs[]>Array.from(taskSet1);
   
    return <taskObjs[]>Array.from(taskSet2 as Set<taskObjs>);
}

async function pulse(url:string, semaphore?:EventEmitter){
    logger.silly(`activeTask::pulse:${url}`);
    let res;
    try {
        res = await fetch(url, { method: 'GET' });
    } catch (e) {
        logger.error(`activeTask::pulse: HTTP FAILED [url:${url}]${e}`);
        return;
    }
    try { // Get rid of non guarded type task (most probably replication)
        let resData = await res.json()
        resData = resData.filter((e:any) => isTaskSpecs(e));
        const pushed:taskObjs[]|taskObjs = oTaskCollection.push(resData, semaphore); // Some typeGuard on specs here
        logger.debug(`activeTask::pulse:pushed successfull with ${inspect(pushed)}`);
        const removedPIDs:string[] = oTaskCollection.sweep(resData/*, semaphore*/);
    } catch (e) {
        logger.error(`activeTask::pulse:PARSING/PUSHING failed at [url:${url}]${e}`);
        //throw new t.httpError(res.statusText, url, res.status);
    }
}

class TaskCollection {
    pool:{[pid:string]:CompactionTask|IndexerTask}
    urlRoot:string
    constructor(urlRoot:string){
        this.pool = {};
        this.urlRoot = urlRoot;
    }
    // To factorize with generics
    push(data:taskSpecs|taskSpecs[], semaphore?:EventEmitter):taskObjs|taskObjs[] {
        const results:taskObjs[] = [];
        if(! Array.isArray(data) )
            data = [data];
        data.forEach( (d)=> {
            const pid = d.pid;
        // Previous task to update
            if (pid in this.pool){ // ??
                const oTask = this.pool[pid];
                if (oTask instanceof IndexerTask)
                    oTask.update(<activeTaskIndexer>d);
                else if (oTask instanceof CompactionTask)
                    oTask.update(<activeTaskCompaction>d);
                else
                    logger.warn(`${inspect(d)}`);
                oTask.emit("update");                
        // New task to create
            } else {
                //logger.debug(`activeTask::push: new Task for ${inspect(d)}`);
                if (isActiveTaskCompaction(d)) {
                    logger.debug(`activeTask::push:already running and guessed "compaction" type\n${inspect(d)}`);
                    this.pool[pid] = new CompactionTask(d);
                } else if (isActiveTaskIndexer(d)) {
                    logger.debug(`activeTask::push:already running and guessed "indexer" type\n${inspect(d)}`);
                    this.pool[pid] = new IndexerTask(d);
                } else {
                    logger.error(`activeTask::push: unknown type\n${inspect(d)}`);
                }
                if(this.pool.hasOwnProperty(pid) && semaphore) {
                    logger.debug("BATEAU" + inspect(semaphore));
                    semaphore.emit('newTask', this.pool[pid]);
                }
            }
            results.push(this.pool[pid]);
        })
        return results.length == 1 ? results[0] : results;
    }
    // Shallow copy the taskSpecs interfaces
    sweep(data:taskSpecs[]) {
        const _ = data.map((d:taskSpecs) => Object.assign({}, d));
        const alivePID = new Set(_.map((e) => e.pid));
        const toDel = Object.values(this.pool).filter(
                            (oTask:CompactionTask|IndexerTask) => !alivePID.has(oTask.pid) 
                    ).map((oTask:CompactionTask|IndexerTask) => oTask.pid);
        if (toDel.length > 0)
            logger.warn(`activeTask::taskCollection:sweep removing following processes \n${inspect(toDel)}`);
        toDel.forEach((pid:string)=> this.remove(pid));
        return toDel;
    }
    pullByType(type:string):(CompactionTask|IndexerTask)[]|undefined {
        logger.debug(`activeTask::taskCollection:pullByType Pulling w/ ${type}`);
        return Object.values(this.pool)
        .filter((oTask:CompactionTask|IndexerTask)=> oTask.type === type );
    }
    pullByDatabase(database:string):(CompactionTask|IndexerTask)[]|undefined {
        logger.debug(`activeTask::taskCollection:pullByDatabase w/ ${database}`);
        return Object.values(this.pool)
        .filter((oTask:CompactionTask|IndexerTask)=> RegExp(`\/${database}\.[0-9]+$`, "g").test(oTask.database));
    }
    remove(pid:string) {
        if(pid in this.pool) {
            this.pool[pid].emit('completed');
            logger.debug(`activeTask::taskCollection:remove deleting ${inspect(this.pool[pid])}`);
            delete(this.pool[pid]);
        } else {
            logger.fatal(`activeTask::taskCollection:remove bad pid ${pid}`);
        }
    }
}

class VirtualTask extends EventEmitter implements activeTaskCore {
    pid:string
    progress: string
    started_on : string
    type:taskType
    updated_on:number

    constructor(data:activeTaskCore) {
        super();
        this.pid = data.pid;
        this.progress = data.progress;
        this.started_on = data.started_on;
        this.type = data.type;
        this.updated_on = data.updated_on;
    }
    update(data:activeTaskCore) {
        this.progress = data.progress;
        this.updated_on = data.updated_on;
    }
}

export class CompactionTask extends VirtualTask implements activeTaskCompaction { 
    database      : string
    changes_done  : number
    total_changes : number

    constructor(data:activeTaskCompaction) {
        super(data);
        this.database = data.database;
        this.changes_done = data.changes_done;
        this.total_changes = data.total_changes;
        
        logger.silly(`Creating CompactionTask ${inspect(this)}`);
    }

    update(data:activeTaskCompaction){
        super.update(<activeTaskCore>data);
        this.changes_done = data.changes_done;
        logger.silly(`Updating CompactionTask ${inspect(this)}`);
    }
}

export class IndexerTask extends CompactionTask implements activeTaskIndexer {
    
    design_document : string
    label?:number
    
    constructor(data:activeTaskIndexer) {
        super(data);
        this.design_document = data.design_document;
        logger.silly(`Creating IndexerTask ${inspect(this)}`);
    }
    update(data:activeTaskIndexer){
        super.update(<activeTaskCompaction>data);   
        logger.silly(`Updating IndexerTask ${inspect(this)}`);     
    }

}

/*
class ReplicatorTask extends EventEmitter implements activeTaskReplicator {
    
    label?:number
    
    constructor(data:activeTaskReplicator) {
        super();
    }
}

class CompactionTask extends EventEmitter implements activeTaskCompaction {
    
    label?:number
    
    constructor(data:activeTaskCompaction) {
        super();
    }
}

*/

/*
[
    {
        "changes_done": 64438,
        "database": "mailbox",
        "pid": "<0.12986.1>",
        "progress": 84,
        "started_on": 1376116576,
        "total_changes": 76215,
        "type": "database_compaction",
        "updated_on": 1376116619
    },
    {
        "changes_done": 14443,
        "database": "mailbox",
        "design_document": "c9753817b3ba7c674d92361f24f59b9f",
        "pid": "<0.10461.3>",
        "progress": 18,
        "started_on": 1376116621,
        "total_changes": 76215,
        "type": "indexer",
        "updated_on": 1376116650
    },
    {
        "changes_done": 5454,
        "database": "mailbox",
        "design_document": "_design/meta",
        "pid": "<0.6838.4>",
        "progress": 7,
        "started_on": 1376116632,
        "total_changes": 76215,
        "type": "indexer",
        "updated_on": 1376116651
    },
    {
        "checkpointed_source_seq": 68585,
        "continuous": false,
        "doc_id": null,
        "doc_write_failures": 0,
        "docs_read": 4524,
        "docs_written": 4524,
        "missing_revisions_found": 4524,
        "pid": "<0.1538.5>",
        "progress": 44,
        "replication_id": "9bc1727d74d49d9e157e260bb8bbd1d5",
        "revisions_checked": 4524,
        "source": "mailbox",
        "source_seq": 154419,
        "started_on": 1376116644,
        "target": "http://mailsrv:5984/mailbox",
        "type": "replication",
        "updated_on": 1376116651
    }
]
*/