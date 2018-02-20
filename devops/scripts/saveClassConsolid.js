db.getCollection('points').find({}).forEach(function(point) {
    var campaign = db.getCollection('campaign').findOne({_id: point.campaign})
    var initialYear = campaign.initialYear
    var finalYear = campaign.finalYear
    var numInspections = (finalYear - initialYear + 1)
    var numInspec = db.getCollection('campaign').distinct('numInspec',{'_id': point.campaign})
    var landUseArray = []
    var count = 0
    var tempObj = {}
    var classConsolidated = []

    point.inspection.forEach(function(inspec) {
        for(var i=0; i<inspec.form.length; i++) {
            if(inspec.form[i].finalYear<=finalYear) {
                for(var x=inspec.form[i].initialYear; x<=inspec.form[i].finalYear; x++) {
                    landUseArray.push(inspec.form[i].landUse)
                    
                    if(x == finalYear) {
                        count++
                    }
                }
            }
        }

        tempObj[count] = landUseArray
        landUseArray = []
    })

    var objClassConsolid = {}
    var countInt = 0

    if (tempObj[1]) {
        if (point.inspection.length == numInspec[0]) { 
            print(point._id, 'classConsolidated')
            for(var i=0; i<tempObj[1].length; i++) {
                var flagConsolid = false

                for(var key in tempObj) {
                    if(!objClassConsolid[tempObj[key][i]])
                        objClassConsolid[tempObj[key][i]] = 0

                    objClassConsolid[tempObj[key][i]]++
                }

                var objCount = Object.keys(objClassConsolid).length;
                var countInt = 0;

                for(var key in objClassConsolid) {
                    countInt++

                    //Alterado condição de (>=) para (>), evitando campanhas com numero par dando problema na consolidação
                    if(objClassConsolid[key] > numInspec[0]/2) {
                        flagConsolid = true
                        classConsolidated.push(key)

                    } else if(objCount == countInt && flagConsolid == false) {
                        flagConsolid = true
                        classConsolidated.push("Não consolidado")
                    }
                }

                countInt++;
                objClassConsolid = {}
            }

            db.getCollection('points').update({_id: point._id}, {$set: {"classConsolidated": classConsolidated}})
        } else {
            print(point._id)
            db.getCollection('points').update({_id: point._id}, {$unset: {"classConsolidated": ""}})
        }
    }
})




/* ------------ADD LÓGICA PARA CONTAGEM DE NÚMERO DE VOTOS NO SCRIPT-------

    var landUses = {};
    
    for(var i=0; i < point.userName.length; i++) {
        
        var userName = point.userName[i];
        var form = point.inspection[i].form;

        form.forEach(function(f) {
            for( var year = f.initialYear; year <= f.finalYear; year++) {
                csvLines[year+"_"+userName] = f.landUse
                
                if(!landUses[year])
                    landUses[year] = [];

                landUses[year].push(f.landUse);
            }
        });
    }

    for(var landUse in landUses) {
        
        var votes = {};

        for (var i in landUses[landUse]) {
            if(!votes[landUses[landUse][i]])
                votes[landUses[landUse][i]]=0

            votes[landUses[landUse][i]] += 1;
        }

        for(var i in votes) {
            
            if (votes[i] >= Math.ceil(landUses[landUse].length / 2)) {
                csvLines[landUse+"_majority"] = i;
                csvLines[landUse+"_majority_votes"] = votes[i];
                break;
            }

        }
    }
*/