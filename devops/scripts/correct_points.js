db.getCollection('points').find({campaign: 'amazonia_bolivia_raisg', index: { $gte: 177, $lt:1367 }  }).forEach( function(point) {
    db.points.update({ _id: point._id}, { '$set': { "cached": false} });
    db.points.update({ _id: point._id}, { '$set': { "underInspection": "3"} });
});