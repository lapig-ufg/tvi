#!/bin/bash

while read -r campaign; do
  echo "$(date) - Calling: $campaign" >> /APP/tvi/src/server/bin/correct_campaigns.log
  mongo tvi --host 172.18.0.6 --eval 'var campaignId="'$campaign'";' correct_campaign.js >> /APP/tvi/src/server/bin/correct_campaigns.log
done < "$1"
