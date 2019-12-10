import * as t from "./cType";
import { logger } from "./logger";
import { activeIndexTasks } from "./manager";
import fetch from "node-fetch";
import { inspect } from "util";
import { Z_NEED_DICT } from "zlib";

/*
 view management

 1ST view query leads to error 404 due to time delay
 Ensure View is rebuild once deletion complete -> release lock
    -> view-rebuild trigger to identify, (CH presumes view  query)
    -> view-rebuild finish event to identify to allow lock release 

The definition of a view within a design document also creates an index 
based on the key information defined within each view. The production 
and use of the index significantly increases the speed of access and 
searching or selecting documents from the view. However, the index is 
not updated when new documents are added or modified in the database.
 Instead, the index is generated or updated, either when the view is 
 first accessed, or when the view is accessed after a document has been 
 updated. In each case, the index is updated before the view query is 
 executed against the database. The consequence of this behavior is that 
 an index update for a view may take an excessive amount of time after a 
 large number of new documents are added or modified. When documents are 
 added or modified incrementally, the index update is much quicker. While 
 all indices would be updated eventually upon access, a system that depends 
 upon design document views may hang or crash while waiting for an initial 
 index update after a large document load (such as after a migration).


    */
export class Volume {
    endpoint : string
    name : string
    constructor (url:string, name:string, userID?:t.credentials) {
        this.endpoint = url;
        this.name = name;
    }
    // tasks representations
    async handshake() {
        try {
            let url = this.endpoint;
            logger.debug(`GET:${url}`);
            let res = await fetch(url, {
                method: 'GET'/*,
            body: JSON.stringify(this.wrapBulk(packet)),
            headers: { "Content-Type": "application/json" }
            */
            });
            return res.json(); // Seems a Promise Object
        } catch (e) {
            logger.error(`Can't handshake at ${this.endpoint} reason : ${e}`);
            throw(e);
        }
    }
    async defaultViewKey(viewNS:string){
        const url = this.endpoint + `/_design/${viewNS}`;      
        let res =  await fetch(url, {
            method: 'GET'
        });
        let _doc = await res.json();
        if(!_doc.hasOwnProperty("views"))
            throw new Error(`Irregular view design document at [${url}]\n${inspect(_doc)}`);
        return Object.keys(_doc.views)[0];
    }
    // WE HANDLE DELAY FOR TASK TRACKING HERE
    async getIndex(viewNS:string, designObject?:{}) {
        logger.warn(`vNS is ${viewNS} and designObject is ${inspect(designObject)}`);
        try {
            if (designObject)
                await this.setIndex(designObject, viewNS);
            const triggerKey = await this.defaultViewKey(viewNS);
            logger.warn(`TriggerKey:${triggerKey}`);
            let url = this.endpoint + `/_design/${viewNS}/_view/${triggerKey}`;
            logger.debug(`GET:${url}`);
            let res = await fetch(url, {
                method: 'GET'
            });
            let json = await res.json();
            if (t.isCouchTimeOut(json)) {
                await this.waitForIndexation();
                logger.info(`RDY TO INDEX_PULL ${this.name}`);
                let resBack = await fetch(url, {
                    method: 'GET'
                });
               json = await resBack.json();
            }
            return json; // Seems a Promise Object
        } catch (e) {
            logger.error(`Can't get view from ${this.endpoint} reason : ${e}`);
            throw(e);
        }
    }
   
    //curl -X PUT wh_agent:couch@localhost:5984/crispr_v10/_design/by_org
    async setIndex(designObject:{}, viewNS:string) {
        logger.debug(`[${this.endpoint}] Setting index`);
        try {
            let url = this.endpoint + `/_design/${viewNS}`;
            logger.debug(`PUT:${url}`);
            let res = await fetch(url, {
                method: 'PUT',
            body: JSON.stringify(designObject),
            headers: { "Content-Type": "application/json" }
            });
            return res.json(); // Seems a Promise Object
        } catch (e) {
            logger.error(`Can't set view from ${this.endpoint} reason : ${e}`);
            throw(e);
        }
    }
    async waitForIndexation(){
        logger.debug(`${this.name} starts waiting for indexation`);

        return new Promise ((resolve, reject) => {
            let asyncIntervals:Boolean[] = [];
            const runAsyncInterval = async (cb:()=>Promise<any>, interval:number, intervalIndex:number) => {
                let data = await cb();
                logger.info(`${this.name} [Still Waiting] Current Indexation Task is : ${inspect(data)}`);
                
                if (data.length == 0) {
                    logger.debug("clearing");
                    clearAsyncInterval(intervalIndex);
                    logger.fatal(`RDY TO INDEX_PULL ${this.name}`);
                    resolve();
                }

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
            setAsyncInterval(async () => { return await activeIndexTasks({'database' : this.name}); },
                5000);

            
            
        });
    }
    async view(ns:string, cmd:string) {
        const url = this.endpoint + `/_design/${ns}/${cmd}`;      
        logger.debug(`GET:${url}`);
        let res =  await fetch(url, {
            method: 'GET'
        });
        let _doc = await res.json();
        return _doc;
    }
    // We wanna type this function as returnin a document object type
    async updateDoc(updateFunc:any) {

    }
}
//  TROP LONG !!
//curl -X GET 'localhost:5984/crispr_rc01_v35/_design/vNS/_view/organisms?key="Komagataeibacter xylinus E25 GCF_000550765.1"'

//DELETE AGGTTTTGATTTGTAGTTTAGGG

//curl 'localhost:5984/crispr_v10/_design/by_org/_view/organisms?key="Candidatus%20Portiera%20aleyrodidarum%20BT-B-HRs%20GCF_000300075.1"'
//curl -X PUT wh_agent:couch@localhost:5984/crispr_v10/_design/by_org -H "Content-Type : application/json" -d @work/DVL/JS/ms-db-manager/views/byOrganism.json
//curl -X DELETE 'localhost:5984/crispr_v10/AGGTTTTGATTTGTAGTTTAGGG?rev=4-f3551a9b1fa52867a7ea6305ac494f32'
//-->{"ok":true,"id":"AGGTTTTGATTTGTAGTTTAGGG","rev":"5-008d91c666168f62996c296cbc0b4cce"}

class Document {
    //update
    //create
    //delete
}