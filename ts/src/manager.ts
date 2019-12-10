import { start } from "repl";
import vLib = require("./volume");
import * as t from "./cType";
import { logger } from "./logger";
import { inspect } from "util";

const fetch = require('node-fetch');
const readline = require('readline');

let endPointsRegistry: vLib.Volume[] = []; 

let CREDS:t.credentials|undefined;
let ROOT:string;
let PREFIX:string;

interface indexTask {
        node: string,
        pid: string,
        changes_done: number,
        database: string,
        design_document: string,
        indexer_pid: string,
        progress: number,
        started_on: number,
        total_changes: number,
        type: 'indexer',
        updated_on: number
}

type taskConstraintKey = "node" | "database" | "design_document";
type taskConstraint = {[ key in taskConstraintKey ]?:string|number} // ...

function isIndexTask(data:any): data is indexTask {
    if(data.hasOwnProperty("type"))
        return data.type === 'indexer'
    return false;
}

//{"error":"timeout","reason":"The request could not be processed in a reasonable amount of time."}


//rm -rf /Users/guillaumelaunay/Library/Application\ Support/CouchDB2/var/lib/couchdb/.shards/*/crispr2.*_design
/*
INDEX STAGE
{
    node: 'couchdb@localhost',
    pid: '<0.16880.23>',
    changes_done: 101101,
    database: 'shards/80000000-ffffffff/crispr_dvl.1551373752',
    design_document: '_design/by_org',
    indexer_pid: '<0.16849.23>',
    progress: 7,
    started_on: 1575886974,
    total_changes: 1300651,
    type: 'indexer',
    updated_on: 1575887004
  }
*/

async function parseMsg(couchMsg:Promise<t.couchResponse>):Promise<t.couchResponse> {
    logger.debug(`PARSEMSG input type ${typeof(couchMsg)}`);
    try {
        const data:t.couchResponse = await couchMsg;
        if (t.isCouchResponse(data))
            logger.debug(`ok Type ${typeof(data.ok)}`);
        return data;
        
    } catch(e) {
        throw(e)
    }

}

// Systematic test of registred Database for index and 
//export async function registerAll(endPoints:string[], designObject:{}):Promise<any>/*Promise<endPointStats>*/{
//    endPointsRegistry = endPoints.map( (endPoint) => new vLib.Volume(`${PREFIX}/${endPoint}`, endPoint, CREDS) );
//    let res = await Promise.all(endPointsRegistry.map(volume => volume.setIndex(designObject)).map(parseMsg));
//    return res;
//}

/*
Querying up to n views in parrallel
*/
export async function registerAllBatch(endPoints:string[], viewNS:string, designObject?:{}, n:number = 2):Promise<any> {
    endPointsRegistry = endPoints.map( (endPoint) => new vLib.Volume(`${PREFIX}/${endPoint}`, endPoint, CREDS) );

    let results:any[] = new Array(endPoints.length);
    let total = endPoints.length;
    let done = 0;
    let currIndex:number;
    
    function goAsync(it:any[], i:number, total:number, n:number, /*done:number,*/ results:any[], resolveAll:any, rejectAll:any) {
        let _volume = it[i];
        _volume.getIndex(viewNS, designObject).then((dbHand:{}) => {
        done++;
        results[i] = dbHand;
        logger.debug(`Done: ${done}/${total} [ i_index ${i} :: t_batch ${n}]`);
        if (i + n < total)
          goAsync(it, i + n, total, n/*, done*/, results, resolveAll, rejectAll);
        if (done == total)
          resolveAll(results);
      });
    };
  
    return new Promise((resolveAll, rejectAll) => {
      let work = []
      for (currIndex = 0 ; currIndex < (n < total ? n : total) ; currIndex++)
        work.push(goAsync(endPointsRegistry, currIndex, total, n, /*done,*/ results, resolveAll, rejectAll));
      //not working //Promise.all(work).then(()=>{resolveAll(results)});
    });
  }




export async function connect(dbRoot:string, userID?:t.credentials):Promise<any>/*Promise<endPointStats>*/{
    ROOT = dbRoot;
    CREDS = userID;
    PREFIX = `http://${dbRoot}`;
    if (CREDS)
        PREFIX = `http://${CREDS.login}:${CREDS.pwd}@${dbRoot}`;
    try {
        let res = await fetch(PREFIX, {
            method: 'GET'/*,
        body: JSON.stringify(this.wrapBulk(packet)),
        headers: { "Content-Type": "application/json" }
        */
        });
        return res.json();
    } catch (e) {
        throw (e);
    }
}

export async function activeIndexTasks(constraints?:taskConstraint) {
    let _ = await activeTasks();
    const reDatabase = /shards\/[^\/]+\/(.+)\.[\d]+$/;

    logger.debug(`raw tasks Array ${inspect(_)}`);
    let rawTasks:indexTask[] = _.tasks.filter(isIndexTask);
    if (constraints)
        return rawTasks.filter((e:indexTask)=> {
            if (constraints.hasOwnProperty('database')) {
                let m = reDatabase.exec(e.database);
                if (m) { 
                    return m[1] === constraints.database;
                }
            }
                return true;
            });
    return rawTasks;
}

export async function activeTasks() {
    try {
        logger.silly(`${PREFIX + '/_active_tasks'}`);
        let res = await fetch(PREFIX + '/_active_tasks', {
            method: 'GET'/*,
        body: JSON.stringify(this.wrapBulk(packet)),
        headers: { "Content-Type": "application/json" }
        */
        });
        let _ = await res.text();
        return JSON.parse(`{ "tasks" : ${_}}`);
    } catch (e) {
        throw (e);
    }
}
/*
export async function remove(toDel?:t.delConstraints) : Promise<any> {

}*/
 //Type is key interface
//export async function list(toDel?:t.delConstraints) /* : Promise<IteratorResult<T>>*/ {

//}


// Aggregated rerequest here
export async function list(ns:string, specie:string):Promise<{}> {
    //let views:Promise<any>[] = endPointsRegistry.map((vol:vLib.Volume)=> vol.view(ns, cmd));
    let spKeyArray = await view(ns, `organism?key=${specie}`);
    return spKeyArray;
    //return Promise.all(views);
}

export function view(ns:string, cmd:string):Promise<{}> {
    let views:Promise<any>[] = endPointsRegistry.map((vol:vLib.Volume)=> vol.view(ns, cmd));
    return Promise.all(views);
}
export async function watch() {
    //let timer:NodeJS.Timeout =
    logger.info("Watching Tasks")
    let n = 0;
    setInterval(()=>{
      let msg = `A${n}\nB${n}`;
      readline.moveCursor(process.stdout, 0, -n);
      readline.cursorTo(process.stdout, 0);            // then getting cursor at the begining of the line
      readline.clearScreenDown(process.stdout);
      process.stdout.write(msg);
      
      n = (msg.match(/\n/g) || []).length;
      n+=1;
    }, 1000);
    try {
        activeTasks();
    } catch(e){
        logger.fatal(`Error on watch`)
    }
}

export function _watch() {
    let asyncIntervals:Boolean[] = [];
    const runAsyncInterval = async (cb:()=>Promise<any>, interval:number, intervalIndex:number) => {
        let data = await cb();
        logger.info(`Data is : ${inspect(data)}`);
        //logger.info(`${inspect(asyncIntervals)}`);
        if (asyncIntervals[intervalIndex]) {
            setTimeout(() => runAsyncInterval(cb, interval, intervalIndex), interval);
        }
    };

    const setAsyncInterval = (cb:()=>Promise<any>, interval:number) => {
        if (cb && typeof cb === "function") {
            const intervalIndex = asyncIntervals.length;
            asyncIntervals.push(true);
            runAsyncInterval(cb, interval, intervalIndex);
            return intervalIndex;
        } else {
            throw new Error('Callback must be a function');
        }
    };

    const clearAsyncInterval = (intervalIndex:number) => {
        if (asyncIntervals[intervalIndex]) {
            asyncIntervals[intervalIndex] = false;
        }
    };

    /*setAsyncInterval(async () => {
        console.log('start');
        const promise = new Promise((resolve) => {
          setTimeout(() => { x += 1; resolve(`${x} all done`);}, 3000);
        });
        await promise;
        console.log('end');
      }, 1000);
      */
     setAsyncInterval(activeTasks,
        1000);
}