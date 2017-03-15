db.getCollection('points').mapReduce(
    function() {
        var coord = (String(this.lon) + '-' + String(this.lat));
        var values = {
            inspection: this.landUse.length,
            count: 1,
            index: this.index,
            ids: this._id,
        };
        emit(coord, values);
    },
    function(key, values) {
        var counts = [];
        var indexes = [];
        var inspections = [];
        var remove = [];
        var notRemove = [];
        
        for(var i=0; i < values.length; i++) {
            inspectionsNum = values[i].inspection;
            
            if (inspectionsNum == 0) {
                remove.push(values[i].ids);
            } else {
                notRemove.push(values[i].ids);
            }
            
            counts.push(values[i].count);
            indexes.push(values[i].index);
            inspections.push(values[i].inspection);
        }
        
        var countR = Array.sum(counts);
        var inspectionsR = Array.sum(inspections);
        
        return {
            count: countR,
            inspection: inspectionsR,
            indexes: indexes,
            notRemove: notRemove,
            remove: remove
        }
    }
    , {
        out: { merge: "points_duplicate" },
        query: { campaign: 'campanha_2008' }
    }
)
