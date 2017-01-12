db.getCollection('points').mapReduce(
    function() {        
        for(var i in this.userName) {
            var userName = this.userName[i];
            var landUse = this.landUse[i];
            var concordance = 0;
            for(var j in this.userName) {
                if(this.userName[j] != userName && this.landUse[j] == landUse) {
                    concordance++;
                }
            }
            var result = { "count": 1, "counter": this.counter[i], "certaintyIndex": this.certaintyIndex[i] }
            result['count'+concordance] = 1;
            emit(userName, result)
        }
    },
    function(key, values) {
        var result = {};
        var rKeys = [ 'count', 'count0', 'count1', 'count2', 'count3', 'count4', 'counter', 'certaintyIndex' ];
        var rOps = [ 'sum', 'sum', 'sum', 'sum', 'sum', 'sum', 'avg', 'avg' ];
        
        for(var i in values) {
            for(var j in rKeys) {
                var rKey = rKeys[j];
                if(!result[rKey])
                    result[rKey] = []
                if(values[i][rKey] !== undefined)
                    result[rKey].push(values[i][rKey])
            }
        }
        
        for(var i in rKeys) {
            var rKey = rKeys[i];
            var rOp = rOps[i];
            result[rKey] = Array[rOp](result[rKey])
        }
        return result;
    }
    , {
        out: { merge: "report_inspector" }
    }
)