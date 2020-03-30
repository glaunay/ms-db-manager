# Housekeeping Micro Service for CRISPR database

## Prerequesites

## Install

```sh
https://github.com/glaunay/ms-db-manager
cd ms-db-manager
npm install
tsc
cd build
```

### Setting up the views

#### Listing specie sgRNAs associations

The views folder provides the **byOrganisms.json** [couchDB design document](https://docs.couchdb.org/en/stable/ddocs/index.html) file. This file gives the specifics for a couchDB view named *organisms*

```json
{
    "views" : {
        "organisms" : {
            "map" : "function(doc) { 
                for (var org in doc) { 
                    if (org.charAt(0) != '_') { 
                        var nb_occurences = 0; 
                        for (var seq_ref in doc[org]){
                            nb_occurences = nb_occurences + doc[org][seq_ref].length
                        } 
                        emit(org,nb_occurences)
                }}}"
        }
    }
}
```

This view will return the list of all possible `[specie,sgRNAs]` possibly filtered for a single specie.

eg : `curl 'localhost:5984/[database]/_design/[namespace]/_view/organisms?key="Candidatus Portiera aleyrodidarum BT-B-HRs GCF_000300075.1"'`

would return

```json
[
    {"id":"AGGTTTTAACTTATTAGCTACGG","key":"Candidatus Portiera aleyrodidarum BT-B-HRs GCF_000300075.1","value":1},
    {"id":"AGGTTTTAGATAGGTTGATTTGG","key":"Candidatus Portiera aleyrodidarum BT-B-HRs GCF_000300075.1","value":1},
    {"id":"AGGTTTTCCTATTGGTGTCAAGG","key":"Candidatus Portiera aleyrodidarum BT-B-HRs GCF_000300075.1","value":1},
    {"id":"AGGTTTTCTCCCGAACCCAATGG","key":"Candidatus Portiera aleyrodidarum BT-B-HRs GCF_000300075.1","value":1}
]
```

To interrogate views, you need config.json file with access keys to database. Example : 
```json
{
    "login": "couch_agent",
    "password": "couch",
    "adress": "localhost",
    "port": 5984
}

```

#### Indexing

You setup a view over a range of databases the following way

```sh
node index.js --target '[RANGE_EXPR]' --design  [DESIGN_DOCUMENT]--namespace [DESIGN_FOLDER] --config [CONFIG_JSON_FILE]
```

Where,

* `--target [RANGE_EXPR]` is a pseudo-regular expression with number interpolation capability
* `--design [DESIGN_DOCUMENT]` is the file path to write the rankings, default='jsonOut'
* `--namespace [DESIGN_FOLDER]` is the folder where couchDB will store the document. Optional, default="vNS"


All databases will be checked for the availability of the provided view. It may trigger the indexing of several databases which can take time.

##### Example

```sh
node index.js --target 'crispr_rc01_v3[7-8]' --design ../views/byOrganism.json --config ../config.json
```

**NB** When a database is modified, its corresponding views are not rebuildt until they are queried again.

### Usage

In the following case, `--design [DESIGN_DOCUMENT]` and `--namespace [DESIGN_FOLDER]` do not need to be specified.
If you choose a specific `namespace` during the indexation step, you will have to provide it further.

#### List all species with their respective number of snRNAs entries

```sh
node index.js --target [RANGE_EXPR] --rank [JSON_OUPUT] --config [CONFIG_JSON_FILE]
```

where,

* `--target [RANGE_EXPR]` is a pseudo-regular expression with number interpolation capability
* `--rank [JSON_OUPUT]` is the file path to write the rankings

##### Example

```sh
node index.js --target 'crispr_rc01_v3[7-8]' --rank rankings.json --config ../config.json
```

will produce a `rankings.json` file with the following content type

```json
{"ranks":[
    {"specie":"pAR-dCas","count":8},
    {"specie":"pAR1","count":8},
    {"specie":"pOXA-48","count":36},
    {"specie":"Kineococcus radiotolerans SRS30216 = ATCC BAA-149 GCF_000017305.1","count":88}
}
```

#### List the sgRNAs relative to a particular specie

```sh
node index.js --target [RANGE_EXPR] --find [SPECIE_NAME] --config [CONFIG_JSON_FILE]
```

where,

* `--target [RANGE_EXPR]` is a pseudo-regular expression with number interpolation capability
* `--find [SPECIE_NAME]` is a valid complete specie name

##### Example

```sh
node index.js --target 'crispr_rc01_v3[7-8]' --find 'Deinococcus actinosclerus GCF_001507665.1' --config ../config.json
```

will produce a `Deinococcus actinosclerus GCF_001507665.1.json` file with the following content type,

```json
{"find":[
    {"vID":"organisms","vNS":"vNS","_":0,"source":"crispr_rc01_v37","data":{
        "total_rows":1236604,
        "offset":351371,
        "rows":[
            {"id":"GATAAAACCCCGCTCGGGGCGGG","key":"Deinococcus actinosclerus GCF_001507665.1","value":1},
            {"id":"GATAAAATAACCATCTTGTTAGG","key":"Deinococcus actinosclerus GCF_001507665.1","value":1},
            {"id":"GATAAAATTATCCTAATTGAAGG","key":"Deinococcus actinosclerus GCF_001507665.1","value":1},
            {"id":"GATAAACCTCAGCACGCGGTCGG","key":"Deinococcus actinosclerus GCF_001507665.1","value":1},
            {"id":"GATAAACGACGCGGCGAACACGG","key":"Deinococcus actinosclerus GCF_001507665.1","value":1}
        ]
    }
    }
]}
```

where **"find"** references the results of the view **vNS/vID** applied to all the databases identified under the **source** key.

#### Delete all sgRNAs relative to a particular specie

```sh
node index.js --target [RANGE_EXPR] --remove [SPECIE_NAME] --config [CONFIG_JSON_FILE]
```

where,

* `--target [RANGE_EXPR]` is a pseudo-regular expression with number interpolation capability
* `--remove [SPECIE_NAME]` is a valid complete specie name

```sh
node index.js --target 'crispr_rc01_v3[7-8]' --remove 'Deinococcus actinosclerus GCF_001507665.1' --config ../config.json
```

will remove all `Deinococcus actinosclerus GCF_001507665.1.json` sgRNAs entries from the target databases

## Watch active tasks

This micro-service also allows you to monitor active tasks. Launch : 
```
node watcher.js --target http://user:password@localhost:5984
```
You need to provide user and password to access active tasks document. 
