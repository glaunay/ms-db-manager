import fetch from "node-fetch";
import {inspect} from "util";
import { logger } from "./logger";
import * as t from "./cType";

/*
From https://docs.couchdb.org/en/stable/api/ddoc/views.html
Query Parameters:
 	
conflicts (boolean) – Include conflicts information in response. Ignored if include_docs isn’t true. Default is false.
descending (boolean) – Return the documents in descending order by key. Default is false.
endkey (json) – Stop returning records when the specified key is reached.
end_key (json) – Alias for endkey param
endkey_docid (string) – Stop returning records when the specified document ID is reached. Ignored if endkey is not set.
end_key_doc_id (string) – Alias for endkey_docid.
group (boolean) – Group the results using the reduce function to a group or single row. Implies reduce is true and the maximum group_level. Default is false.
group_level (number) – Specify the group level to be used. Implies group is true.
include_docs (boolean) – Include the associated document with each row. Default is false.
attachments (boolean) – Include the Base64-encoded content of attachments in the documents that are included if include_docs is true. Ignored if include_docs isn’t true. Default is false.
att_encoding_info (boolean) – Include encoding information in attachment stubs if include_docs is true and the particular attachment is compressed. Ignored if include_docs isn’t true. Default is false.
inclusive_end (boolean) – Specifies whether the specified end key should be included in the result. Default is true.
key (json) – Return only documents that match the specified key.
keys (json-array) – Return only documents where the key matches one of the keys specified in the array.
limit (number) – Limit the number of the returned documents to the specified number.
reduce (boolean) – Use the reduction function. Default is true when a reduce function is defined.
skip (number) – Skip this number of records before starting to return the results. Default is 0.
sorted (boolean) – Sort returned rows (see Sorting Returned Rows). Setting this to false offers a performance boost. The total_rows and offset fields are not available when this is set to false. Default is true.
stable (boolean) – Whether or not the view results should be returned from a stable set of shards. Default is false.
stale (string) – Allow the results from a stale view to be used. Supported values: ok, update_after and false. ok is equivalent to stable=true&update=false. update_after is equivalent to stable=true&update=lazy. false is equivalent to stable=false&update=true.
startkey (json) – Return records starting with the specified key.
start_key (json) – Alias for startkey.
startkey_docid (string) – Return records starting with the specified document ID. Ignored if startkey is not set.
start_key_doc_id (string) – Alias for startkey_docid param
update (string) – Whether or not the view in question should be updated prior to responding to the user. Supported values: true, false, lazy. Default is true.
update_seq (boolean) – Whether to include in the response an update_seq value indicating the sequence id of the database the view reflects. Default is false.
*/
export interface viewParameters {
  descending?:Boolean,
  startkey?:string
  limit?:number
  skip?:number
  key?:string
}

interface viewDatum {
    key : string,
    id  : string
}

function isViewParameters(data:{[k:string]:any}):Boolean{
  const _:{[k:string]:string} = {
            "limit" : 'number', 
            "skip"  : 'number',
            "key"   : 'string',
            "startkey" : 'string',
            "startkey_docid" : 'string'
  };

  for (let k in data){
    if (! _.hasOwnProperty(k) ) {
        logger.debug(`isViewParameters: "${k}" is not a registred key`);
        return false;   
    }
    if( typeof (data[k]) != _[k] ) {
        logger.debug(`isViewParameters: "${k}" has wrong data type ${typeof (data[k])} instead of ${_[k]}`);
        return false;
    }
  }
  return true;
}

function urlParameters(data:viewParameters|undefined):string {
  if(data == undefined)
    return '';
  if (Object.keys(data).length == 0) 
    return '';
  //@ts-ignore
  return '?' + Object.keys(data).map((k) => `${k}=${data[k]}`).join('&');
}

// Sufficeint to trigger indexing ?
export async function getView(url:string, p?:viewParameters) {
  const v = new View(url, p);
  await v._init();
  return v;
}

async function viewFetchUnwrap(url:string) {
  logger.debug(`View.iterator:[GET] ${url}`);
  let res = await fetch(url, {
    method: 'GET'
  });
  let data = await res.json();
  if(t.isCouchNotFound(data))
    throw new Error(`view::${url} not found`);
  if (!t.isViewDocInterface(data))
    throw new Error(`Non valid view data ${inspect(data)}`);
  return data;
}

export class View {
  step:number = 5000 
  length?:number
  endPoint:string
  parameters:viewParameters

  constructor(nativeUrl:string, params?:viewParameters) {
    
    if(params)
      if (!isViewParameters(params))
        throw new Error(`Non valid view parameters${inspect(params)}`)
      else
        this.parameters = params;  
    else
      this.parameters = { 'skip' : 0 }; // default value parameters

    this.endPoint = nativeUrl;
  }
  async _init() {
    let url = `${this.endPoint}`
    if (this.parameters)
      url += `${urlParameters(this.parameters)}&limit=0`;
    else
      url += '?limit=0';
    logger.debug(`view.init::${url}`);
    let data = await viewFetchUnwrap(url);
    this.length = data.total_rows;
  }

  async * iteratorSlow(): AsyncGenerator<any>{
    let _parameters:{[k:string]: any } = { ... this.parameters };
    _parameters.limit = _parameters.hasOwnProperty('limit') ? _parameters.limit : this.step;
    _parameters.skip = _parameters.hasOwnProperty('skip') ? _parameters.skip : 0;

    if(_parameters.skip > <number>this.length)
      logger.warn(`view.iterator:user defined offset ${_parameters.skip} > data record ${this.length}`);
    
    while( _parameters.skip < (this.length as number) ) {
      const url = `${this.endPoint}${urlParameters(_parameters)}`;
      let data = await viewFetchUnwrap(url);
      logger.debug(`iterator${inspect(data.rows)}:`);
      for (let datum of data.rows)
        yield datum;
      _parameters.skip += _parameters.limit;
    }
  }
  // Need to implement treatment of skip parameter, with initial fetch
  // Shoulb be promptly reiterable
  async * iteratorQuick(): AsyncGenerator<any>{
   
    let calls = 0;
    // We get an initial start key here in case of a non-zero initial skip
    // offset is zero and limit is 1
    const initSkip = this.parameters.hasOwnProperty('skip') ? <number>this.parameters.skip : 0;
    let _startingParameters:{[k:string]: any } = { ... this.parameters };
    _startingParameters.limit = 1;

    if(initSkip > 0)
      logger.warn(`view.iteratorQuick:user defined non-zero skip ${initSkip} may impair performances`);
    
    if(initSkip > <number>this.length) {
      logger.fatal(`view.iterator:user defined offset ${initSkip} > data record ${this.length}`);
      throw new Error("iteratorQuick unable to start");
    }
    
    let url = `${this.endPoint}${urlParameters(_startingParameters)}`;
    let data = await viewFetchUnwrap(url);
    logger.debug(`Seed view document:${url} is ${inspect(data.rows[0])}`);
    
    logger.debug(`Start key is ${data.rows[0].key}`);
    // We set buffer parameters in their intial state
    // startKey is defined, limit is step value and skip is zero
    let _bufferParameters:{[k:string]: any } = { ... this.parameters };
    _bufferParameters.limit = this.parameters.hasOwnProperty('limit') ? this.parameters.limit : this.step;
    _bufferParameters.skip = 0;

    _bufferParameters.startkey = `"${data.rows[0].key}"`;

    let currentStartPos = initSkip;
    while( currentStartPos < (this.length as number) ) {
      calls++;
      
      const url = `${this.endPoint}${urlParameters(_bufferParameters)}`;
      //logger.info(`${calls} :: ${url}`);
     
      
      let data = await viewFetchUnwrap(url);

      //logger.info(`Packet(${data.rows.length}) First Item, Second Item, LastItem\n${inspect(data.rows[0])}\n${inspect(data.rows[1])}${inspect(data.rows[data.rows.length -1])}`);
      //logger.debug(`iterator${inspect(data.rows)}:`);
      for (let datum of data.rows)
        yield datum as viewDatum;
      // We set last key as first to fetch and ignore it w/ skip = 1
      const lastItem = data.rows[data.rows.length -1];
      _bufferParameters.startkey = `"${lastItem.key}"`;
      _bufferParameters.startkey_docid = `${lastItem.id}`;
      _bufferParameters.skip = 1;
     
      currentStartPos += _bufferParameters.limit
    }
  }
  async mapQuick( fn:(d:viewDatum)=>any ): Promise<any[]> {
      let results:any[] = [];
      for await (const vDatum of this.iteratorQuick()) {
          results.push(fn(vDatum));
      }
      return results;
  }
}
