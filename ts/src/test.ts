
    import * as t from "./cType";
    import { inspect } from "util";
    import { isObject, isEmptyObject} from "./utils";

    let depth = 0;

  
    function predicate(k:string,v:any){
        depth++;
        if(depth == 10) {
            console.warn("D3");
            process.exit()
        }
        console.log(`inspecting ${k} :: ${v}`);
        if (k === "Providencia rettgeri GCF_001874625.1")
        //if (k === "Proteus mirabilis HI4320 GCF_000069965.1")
            return undefined;
        return v;
    }

    function filter(fn:any, allowEmptyObject:Boolean=true) {
        const srcDoc:{[k:string]:any} = {
            "_id": "GATAAAAAAAAAGCCTATCATGG",
            "_rev": "1-6ec18aa233ee36f83fb1e85c5e76166a",
            "Proteus mirabilis HI4320 GCF_000069965.1": {
              "NC_010554.1": [
                "+(1502097,1502119)"
              ],
              "TITI" : {
                  "TOTO": 12,
                  "TATA" : {
                    "Providencia rettgeri GCF_001874625.1": {
                        "NZ_CP017671.1": [
                          "-(2117009,2117031)"
                        ]
                      }
                  }
              }
            },
            "Providencia rettgeri GCF_001874625.1": {
              "NZ_CP017671.1": [
                "-(2117009,2117031)"
              ]
            }
          }
      /*  const srcDoc:{[k:string]:any} = {
            "_id": "GATAAAAAAAAAGCCTATCATGG",
            "_rev": "1-6ec18aa233ee36f83fb1e85c5e76166a",
            "Proteus mirabilis HI4320 GCF_000069965.1": {
              "NC_010554.1": [
                "+(1502097,1502119)"
              ]
            },
            "Providencia rettgeri GCF_001874625.1": {
              "NZ_CP017671.1": [
                "-(2117009,2117031)"
              ]
            }
          }*/

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
            return node;
        }
        let u = Object.keys(srcDoc).filter((k:string) => ! k.startsWith('_'));
        console.log(u);
       
        for (let key of Object.keys(srcDoc).filter((k:string) => ! k.startsWith('_'))) {
            const _ = _fn(key, srcDoc[key]);
            if(_)
                tgtDoc[key] = _;
        }
        return tgtDoc;
    }


    let x = filter(predicate, false);
    console.dir(`Results is ${inspect(x)}`);