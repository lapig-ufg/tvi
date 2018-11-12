db.getCollection('points').find({ 'pointEdited': null }).forEach(function(point) {
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

            print(point._id, 'set classConsolidated')
            db.getCollection('points').update({_id: point._id}, {$set: {"classConsolidated": classConsolidated}})
        } else {
            print(point._id, 'unset classConsolidated')
            db.getCollection('points').update({_id: point._id}, {$unset: {"classConsolidated": ""}})
        }
    }
})