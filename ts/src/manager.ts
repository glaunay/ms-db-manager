import { start } from "repl";
import vLib = require("./volume");
import * as t from "./cType";
import { logger } from "./logger";
import { inspect } from "util";
import { timeIt, isEmptyObject } from './utils';

const fetch = require('node-fetch');
const readline = require('readline');

let endPointsRegistry: vLib.Volume[] = []; 
let oEndPointsRegistry:{ [name:string]:vLib.Volume };
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
    /**
     *
     * A function to raise expection in the event of
     * a non successfull actions reported in a couchDB response document
     * @param {Promise<t.couchResponse>} couchMsg The couch response  Document
     * @returns {Promise<t.couchResponse>} The couch response document not containing errors
     * @memberof DBmanager
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

    /**
     * Registered provided database and test their connections
     * by querying each of them for a default view.
     * This can take some time if indexation is required
     * @param {string[]} endPoints names of the databases
     * @param {string} viewNS name of the document storing the view definitions on the database
     * @param {{}} designObject Optional object storing the view definitions
     * @returns {Object} Raw results of the queried views
     * @memberof DBmanager
     */
export async function registerAllBatch(endPoints:string[], viewNS:string, designObject?:{}, n:number = 2):Promise<any> {
    endPointsRegistry = endPoints.map( (endPoint) => new vLib.Volume(`${PREFIX}/${endPoint}`, endPoint, CREDS) );
    oEndPointsRegistry = {};
    endPointsRegistry.forEach((v:vLib.Volume) => { oEndPointsRegistry[v.name] = v; });

    let results:any[] = new Array(endPoints.length);
    let total = endPoints.length;
    let done = 0;
    let currIndex:number;
    
    function goAsync(it:any[], i:number, total:number, n:number, /*done:number,*/ results:any[], resolveAll:any, rejectAll:any) {
        let _volume = it[i];
        _volume.buildIndex(viewNS, designObject).then((dbHand:{}) => {
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

    /**
     * Init connection to a couchDB daemon
     * @param {string} dbRoot HTTP endpoint to couchDB server
     * @param {t.credentials} userID admin user and password
     * @returns {Promise}
     * @memberof DBmanager
     */
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

    /**
     * Get the a list of task matching 
     * provided constraints. eg: a particular database
     * @param {taskConstraint} constraints A set of constraints
     * @returns {Promise<indexTask[]>} List of task
     * @memberof DBmanager
     */
export async function activeIndexTasks(constraints?:taskConstraint) {
    let _ = await activeTasks();
    const reDatabase = /shards\/[^\/]+\/(.+)\.[\d]+$/;

    logger.silly(`raw tasks Array ${inspect(_)}`);
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
    /**
     * Monitor the current active task of the couchDB process
     * using the "/_active_tasks" endpoint
     * @returns { Promise<{}> } An object with a single "task" key, whose value is a task array
     * @memberof DBmanager
     */
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
    /**
     * Execute a predefined "organism?key=[SPECIE]" view
     * on all registered databases
     * @param {string} ns The namespace of the view
     * @param {string} specie The namespace of the specie 
     * @returns {Promise<t.boundViewInterface[]>} List of resulting views, each wrapped with the database and view names
     * @memberof DBmanager
     */
export async function list(ns:string, specie:string):Promise<t.boundViewInterface[]> {
    const sp = specie.replace(' ','%20')
    //let views:Promise<any>[] = endPointsRegistry.map((vol:vLib.Volume)=> vol.view(ns, cmd));
    let spKeyArray:t.viewInterface[] = await view(ns, `organisms?key="${sp}"`);

    return spKeyArray.map((v, i) => {return { vID : 'organisms', 'vNS' : ns, '_' : i, 'source' : endPointsRegistry[i].name, "data" : v };});
}

export async function rank(ns:string):Promise<{[k:string]:number|string}[]> {
  
    let spKeyArray:t.viewInterface[] = await view(ns, `organisms`);
    let _:{[k:string]:number} = {};
    logger.debug(`DDD${spKeyArray}`);
    spKeyArray.forEach((v:t.viewInterface, i) => {
        v.rows.forEach((d:any) => {
            if ( ! _.hasOwnProperty(d.key) )
                _[d.key] = 0;
            _[d.key]++;
        });
    });
    return Object.keys(_).map((k:string) => { return { 'specie' : k, 'count' : _[k]}; })
        .sort((a,b)=>{ if (a.count < b.count) return -1;
                       if (a.count < b.count) return 1;
                       return 0;
                     });
}

    /**
     * Update documents extracted from a view results using provided update function
     *
     * @param {t.boundViewInterface[]} inputs List of view results
     * @param {t.nodePredicateFnType[]} _fn A document update function 
     * @param {Boolean} sync An optional boolean to force indexation after update, default=true
     * @returns { Promise<{}> } A report of the update process
     * @memberof DBmanager
     */
export async function filter(inputs:t.boundViewInterface[], _fn:t.nodePredicateFnType, sync=true) {
    const resp:{[k:string]: any} = {};
    for (let boundView of inputs) {
        if(t.isEmptyBoundViewInterface(boundView))
            continue;
        const oVol:vLib.Volume = oEndPointsRegistry[boundView.source];
        let keys = boundView.data.rows.map((d:any) => d.id);
        const syncSpecs = {
            'vNS' : boundView.vNS,
            'vID' : boundView.vID
        };
        resp[boundView.source] = await oVol.updateBulk(keys, _fn, sync?syncSpecs:undefined );
    }
    if (isEmptyObject(resp)) {
        logger.warn("No filter operation performed");
        return;
    }

    logger.info(`filter summary`);
    logger.debug(`${inspect(resp,{depth:5})}`);
    for (let volName in resp) {
        let up_ok   = 0;
        let up_err  = 0;
        let del_ok  = 0;
        let del_err = 0;
        resp[volName].updated.bulkUpdate.forEach((d:any) => {
            if (d.hasOwnProperty('ok') )
                up_ok++;
            else
                up_err++;
        })
        resp[volName].deleted.bulkUpdate.forEach((d:any) => {
            if (d.hasOwnProperty('ok') )
                del_ok++;
            else
                del_err++;
        })
        logger.info(`filter [${volName}]\t updated (ok/err): ${up_ok}/${up_err} || deleted (ok/err): ${del_ok}/${del_err}`);
    }
    // Log total deletion and volumes report
}

export function view(ns:string, cmd:string):Promise<t.viewInterface[]> {
    let views:Promise<t.viewInterface>[] = endPointsRegistry.map((vol:vLib.Volume)=> vol.view(ns, cmd));
    return Promise.all(views);
}

export async function watch() {
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