#!/usr/bin/python3

import sys
import ee
import json
import datetime
import traceback
from pymongo import MongoClient

MONGO_HOST = '172.18.0.6'
MONGO_PORT = 27017

SATELLITES = [ 'L8', 'L7', 'L5' ]

EE_PRIVATE_KEY_FILE = sys.argv[1]
data = json.load(open(EE_PRIVATE_KEY_FILE))
EE_ACCOUNT = data['client_email']

EE_CREDENTIALS = ee.ServiceAccountCredentials(EE_ACCOUNT, EE_PRIVATE_KEY_FILE)

mosaics = None

def update_campaign(campaign_id):
	try:
		db.campaign.update_one({ "_id": campaign_id }, { "$set": {"customURLs":  mosaics, "updateAt": datetime.datetime.now()}}, upsert=True)
		print(campaign_id + ' updated.')
	except:
		traceback.print_exc()
		print(campaign_id + ' no image.')

def get_mosaic_list():
	keys = []
	values = []
	end_year = datetime.datetime.now().year
	ee.Initialize(EE_CREDENTIALS)

	for year in range(2000, end_year):
		mosaic = ee.ImageCollection("projects/mapbiomas-indonesia/MOSAICS/workspace-c2").filterMetadata('year', 'equals', year)
		url = mosaic.getMapId({'bands': ['swir1_median', 'nir_median', 'red_median'], 'gain': [0.08, 0.06, 0.2], 'gamma': 0.85})

		if year > 2012: 
			satellite = 'L8'
		elif year > 2011:
			satellite = 'L7'
		elif year > 2003 or year < 2000:
			satellite = 'L5'
		else:
			satellite = 'L7'
		
		index = f"{satellite}_{year}_WET"
		keys.append(index)

		modified_url_format = url['tile_fetcher'].url_format.replace('{', '${')
		values.append(modified_url_format)

	ee.Reset()
	return dict(zip(keys, values))

client = MongoClient(MONGO_HOST, MONGO_PORT)
db = client['tvi-indonesia']
mosaics = get_mosaic_list()

with open(sys.argv[2], 'r') as file:
	for line in file:
		campaign_id = line.strip()
		update_campaign(campaign_id)

