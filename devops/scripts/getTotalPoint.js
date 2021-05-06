var listInsp = [];
var totalPoinst = 0; 

db.campaign.find({"_id": /.*mapbiomas_100k_etapa.*/}).forEach( function(campaign) {

	var points = db.points.find({"campaign" : campaign._id});
	var total =  db.points.countDocuments( { campaign: { $eq: campaign._id } })
	var totalInspectionCampaignTime = 0; 

	points.forEach( function(doc){
		var totalInspectionPointTime = 0; 
		doc.inspection.forEach(function(inspection){
			totalInspectionPointTime = inspection.counter
		});
		totalInspectionCampaignTime += totalInspectionPointTime
	})

	listInsp.push({campaign: campaign._id, totalPoints: total, inspectionCampaignTimeInSeceonds: totalInspectionCampaignTime})
});
printjsononeline(listInsp); 

