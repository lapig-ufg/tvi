
print('id,total_points');
db.getCollection('campaign').find().forEach( function(camp) {
    print(camp._id + ',' + db.points.countDocuments({ campaign: camp._id})); 
});
