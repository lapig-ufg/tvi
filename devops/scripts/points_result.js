db.getCollection('points').mapReduce(
    function() {        
           var result = {
               //lon: this.lon,
               //lat: this.lat
           }
           var majority = {};
           var certainty = {};
           
           for (var i=0; i < this.landUse.length; i++) {
               var l = this.landUse[i];
               var c = this.userName[i];
               if(majority[l] == undefined) {
                   majority[l] = 0;
                   certainty[l] = 0;
               }
               majority[l] += 1;
               certainty[l] += c;
           };

           for(key in majority) {
               if (majority[key] > 1) {
                   result.class = key;
                   result.votes = majority[key];
                   result.certainty = certainty[key]/majority[key];
                   break;
               }
           }
           
           emit(this._id,result);
    },
    function(key,values) {
        
    }
    , {
<<<<<<< Updated upstream
        out: { inline: "points_result" },
        query: {campaign: "campanha_2008"}
=======
        out: { merge: "points_result" },
        query:{ "campaign" : "campanha_2008" }
>>>>>>> Stashed changes
    }
)