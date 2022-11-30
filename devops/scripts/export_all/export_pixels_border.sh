for campaign in amazonia_peru_raisg amazonia_bolivia_raisg amazonia_ecuador_raisg amazonia_colombia_raisg amazonia_venezuela_raisg amazonia_guyanas_raisg; do
  echo "Exporting $campaign"
  mongo --quiet 172.18.0.6:27017/tvi --eval "var campaign = '$campaign'" export_mongo.js > csv/raisg_2021/$campaign.csv
done  