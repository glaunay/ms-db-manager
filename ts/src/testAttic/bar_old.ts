import { EventEmitter } from "events";
import { unixTimeStamp } from './utils';
import { inspect } from 'util';
import cliProgress = require('cli-progress');
import _colors = require('colors');

import fs = require('fs');

const dStream = fs.createWriteStream('./debug.log');

const template = 
{
    node: 'couchdb@localhost',
    pid: '<0.18668.1>',
    changes_done: 0,
    database: '',
    design_document: '_design/vNS',
    indexer_pid: '<0.18651.1>',
    progress: 0,
    started_on: 1578474647,
    total_changes: 583916,
    type: 'indexer',
    updated_on: 1578474881
}

function generateIndexer(name:string, msc:number=1000) {
    const emiter = new EventEmitter();
    let doc = JSON.parse(JSON.stringify(template));
    doc.database = name;
    doc.started_on = unixTimeStamp();
    const offset = 50000;
   
    const label = setInterval ( function(){
        doc.changes_done = doc.changes_done + offset < doc.total_changes ? doc.changes_done + offset : doc.total_changes;
        doc.progress = Math.round( (doc.changes_done / doc.total_changes) * 100 );
        emiter.emit("update");
        if (doc.changes_done === doc.total_changes)
            emiter.emit("completed");      
    }, msc);
    emiter.on("completed", function(){
        dStream.write("####################\n");
        dStream.write(inspect(label) + "\n");
        dStream.write(name + "\n");
        clearInterval(label);
        dStream.write(inspect(label) + "\n" );
    });

    return {
        doc : doc,
        e : emiter
    }
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
    dStream.write(inspect(time)+ "\n");
    dStream.write(`${time%3600}\n`);
    dStream.write(`${Math.floor((time%3600) / 60)}\n`);
    dStream.write(`${Math.floor(time%3600 / 60)}\n######\n`);
    const h = Math.floor(time / 3600) > 0 ? `${Math.floor(time / 3600)}h` : '';
    const m = Math.floor(time%3600 / 60) > 0 ? `${Math.floor((time%3600) / 60)}m` : '';
    const s = `${(time%3600)%60}s`;
    return `${h}${m}${s}`;
}

function baseTest(){
    const mBar = new cliProgress.MultiBar({
        clearOnComplete: false,
        hideCursor: true, //forceRedraw
        format: formatter
    }, cliProgress.Presets.shades_grey);

    setTimeout(()=> {
        let nBars = 2;
        const indexer1 = generateIndexer("shards/80000000-ffffffff/crispr_rc01_v36.1575985817");
        const indexer2 = generateIndexer("shards/80000000-ffffffff/crispr_rc01_v36.988888888", 500);
        const mb1 = mBar.create(indexer1.doc.total_changes, 0, indexer1.doc);
        const mb2 = mBar.create(indexer2.doc.total_changes, 0, indexer2.doc);
        if(mb1) {
            indexer1.e.on("update", ()=> {
                mb1.update(indexer1.doc.changes_done, indexer1.doc);
            })
            indexer1.e.on("completed", ()=> {   
                mb1.stop();
                nBars--;
                if (nBars == 0) {
                    mBar.stop();
                    console.log("OOH1");
                }
            })
        }
        if(mb2) {
            indexer2.e.on("update", ()=> {       
                mb2.update(indexer2.doc.changes_done, indexer2.doc);
            })
        indexer2.e.on("completed", ()=> {
                mb2.stop();
                nBars--;
                if (nBars == 0) {
                    mBar.stop();
                    console.log("OOH2");                
                }
            })
        }
        
    }, 2000 );
}