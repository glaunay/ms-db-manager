import * as t from "./cType";
import { logger } from "./logger";
import { activeIndexTasks } from "./manager";
import fetch from "node-fetch";
import { inspect } from "util";
import { isObject, isEmptyObject } from './utils';
import { timeIt } from './utils';
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
                logger.debug(`${this.name} [Still Waiting] Current Indexation Task is : ${inspect(data)}`);
                
                if (data.length == 0) {
                    logger.debug("WaitForIndexation clearing");
                    clearAsyncInterval(intervalIndex);
                    logger.debug(`Rdy to index pull ${this.name}`);
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
            setAsyncInterval(async () => { return await activeIndexTasks({'database' : this.name}); },
                5000);
        });
    }
     // WE HANDLE DELAY FOR TASK TRACKING HERE
     async buildIndex(viewNS:string, designObject?:{}) {
        const time = process.hrtime();
        
        logger.debug(`vNS is ${viewNS} and designObject is ${inspect(designObject)}`);
        try {
            if (designObject)
                await this.setIndex(designObject, viewNS);
            const triggerKey = await this.defaultViewKey(viewNS);
            logger.debug(`Following key will be used to trigger index building ${triggerKey}`);
            
            let json = await this.view(viewNS, triggerKey);
            const _time = timeIt(time);
            logger.success(`${this.name} buildIndex in ${_time[0]}H:${_time[1]}M:${_time[0]}S`);

            return json;
        } catch (e) {
            throw new Error("build Index failed");
        }
            /*let url = this.endpoint + `/_design/${viewNS}/_view/${triggerKey}`;
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
        }*/

    }
    async view (ns:string, cmd:string):Promise<t.viewInterface> { // Should typeguard async json response
        const url = this.endpoint + `/_design/${ns}/_view/${cmd}`;      
        logger.debug(`[view]GET:${url}`);
        try {
            let res = await fetch(url, {
                method: 'GET'
            });
            let json = await res.json();
            if (t.isCouchTimeOut(json)) {
                logger.warn(`view needs indexation [${url}]`);
                await this.waitForIndexation();
                logger.info(`RDY TO INDEX_PULL ${this.name}`);
                let resBack = await fetch(url, {
                    method: 'GET'
                });
                json = await resBack.json();
            }
            if(t.isCouchNotFound(json))
                throw new Error(`view::${url} not found`);
            return json; // Seems a Promise Object
        } catch (e) {
            logger.error(`Can't get view [${url}]\nfrom ${this.endpoint} reason : ${e}`);
            throw(e);
        }


    }
    // We wanna type this function as returnin a document object type
    async updateDoc(updateFunc:any) {

    }
    // docIDs will be consumed
    // WE need TypeGuard on input, at least to detect error
    async getBulkDoc(docIDs:string[], slice:number=100) {
        let i  = 0;
        while (docIDs.length > 0) {
            i++;
            let reqBody:t.couchBulkQuery = { "docs" : docIDs.splice(0, slice).map((key:string)=> { return { "id" : key };}) };
            logger.info(`slice ${i}`);
            try {
                let url = this.endpoint + '/_bulk_get';
                logger.debug(`GET:${url}`);
                let res = await fetch(url, {
                    method: 'POST',
                body: JSON.stringify(reqBody),
                headers: { "Content-Type": "application/json" }            
                });
                let data = await res.json(); // Seems a Promise Object
                logger.warn(`getBulkDoc:${inspect(reqBody)}\n${inspect(data)}`);
            } catch (e) {
                logger.error(`Can't handshake at ${this.endpoint} reason : ${e}`);
                throw(e);
            }
        }
    }
    async getDoc(docID:string):Promise<t.documentInterface> {
        let json:any;
        const url = this.endpoint + `/${docID}`;      
        logger.debug(`[view]GET:${url}`);
        try {
            let res = await fetch(url, {
                method: 'GET'
            });
            json = await res.json();
            if (t.isCouchNotFound(json))
                throw new Error(`${docID} not found at ${this.name}`);
            if (t.isDocument(json))
                return json;
        } catch (e) {
            throw new Error(`${this.name} failed to get document at ${docID}`);
        }
        throw new Error (`Irregular document pulled ${inspect(json)}`);
    } // Finish this
    async filterBulk(stuff:t.couchBulkResponse, fn:t.nodePredicateFnType, allowEmptyObject=true) {
        const filterAccumulator = (acc:t.documentInterface[], d:t.couchBulkResponseChunk) => {
            return [...acc, d.docs.map((e:t.couchBulkResponseItem)=> this.filter(e.ok, fn, allowEmptyObject) )]
        }
        let _:t.documentInterface[] = stuff.results.reduce(  => {
            ;
        }, []);
    }
    // Filter the content of a document by applying predicate function to all its key,value pair 
    // CPU bound may have to spawn it if large document
    async filter(docID:string, fn:t.nodePredicateFnType, allowEmptyObject=true) {
        const srcDoc = await this.getDoc(docID);
        const tgtDoc:t.documentInterface|undefined = await this.filterDoc(srcDoc, fn, allowEmptyObject);
    }
    async filterDoc(srcDoc:t.documentInterface, fn:t.nodePredicateFnType, allowEmptyObject=true):Promise<t.documentInterface|undefined> {
        let tgtDoc:t.documentInterface = {
            "_id": srcDoc._id,
            "_rev": srcDoc._rev
        };

        const nodePredicate = fn;
        const _fn = (nodekey:string, nodeContent:any) => {
            console.log(`_fn on ${nodekey}`);
            //process.exit(0);
            if (!nodePredicate(nodekey, nodeContent)) {
                console.log(`${nodekey} failed`);
                return undefined;
            }
            // The current node holds a scalar,
            // It was evaluated at nodePredicate above call
            // Safe to return it
            if ( !isObject(nodeContent) )
                return nodeContent;
            // The current node holds many ones, we have to account for all their k,v
            const node:{[k:string]:any} = {};
            
            for (let k in nodeContent) {
                let _ = _fn(k, nodeContent[k]);
                if(_) { 
                    if (!allowEmptyObject && isEmptyObject(_))
                        continue;
                    node[k] = _;
                }
            }
            if(Object.keys(node).length == 2) 
                return undefined;

            return node;
        }
        let u = Object.keys(srcDoc).filter((k:string) => ! k.startsWith('_'));
       
        for (let key of Object.keys(srcDoc).filter((k:string) => ! k.startsWith('_'))) {
            const _ = _fn(key, srcDoc[key]);
            if(_)
                tgtDoc[key] = _;
        }

        logger.debug(`FILTER : \n${inspect(srcDoc)}\nbecame\n${inspect(tgtDoc)}`);
        return tgtDoc;
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