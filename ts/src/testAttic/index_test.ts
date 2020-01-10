import {getView} from "./view";
import { logger, setLogLevel, setFile, logLvl } from "./logger";
import {inspect} from 'util';
import {timeIt} from './utils';

setLogLevel('debug');
const url = 'http://localhost:5984/crispr_rc01_v35/_design/vNS/_view/organisms';

(async () => {
    const time  = process.hrtime();
    const keySet = new Set([]);
    const v = await getView(url, {"key" : "Candidatus Portiera aleyrodidarum BT-B-HRs GCF_000300075.1"});
    logger.info(v.length)
    let i=0;
    for await ( const datum of v.iteratorQuick() ) {            
        i++;
        const _ = <string>datum.key + "_" + <string>datum.id;
        if ( keySet.has(_) ) {
            throw new Error(`at ${i} ${_} is already part of the set`);
        }
        keySet.add(_);
       // console.log(`${i}::${inspect(datum)}`);
    }
    logger.info(i);
    const _time = timeIt(time);
    logger.info(`consuming ${url}: (${i} items theoric is ${v.length}) took ${_time[0]}H:${_time[1]}M:${_time[2]}S`);
})();