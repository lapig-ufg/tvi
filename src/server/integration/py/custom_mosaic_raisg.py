#!/usr/bin/python

import sys
import ee
import datetime
import json
from pymongo import MongoClient

EE_PRIVATE_KEY_FILE = sys.argv[1]
data = json.load(open(EE_PRIVATE_KEY_FILE))
EE_ACCOUNT = data['client_email']

EE_CREDENTIALS = ee.ServiceAccountCredentials(EE_ACCOUNT, EE_PRIVATE_KEY_FILE)
ee.Initialize(EE_CREDENTIALS)

client = MongoClient('172.18.0.6', 27017)
db = client.tvi

urls = {}

def process_year(year):
    mosaic = (ee.ImageCollection("projects/mapbiomas-raisg/MOSAICOS/mosaics-pathrow-2")
              .filterMetadata('year', 'equals', year))

    url = mosaic.getMapId({"bands": ["swir1_median", "nir_median", "red_median"], "min": 407, "max": 3381})

    if year > 2012:
        satellite = 'L8'
    elif year > 2011:
        satellite = 'L7'
    elif year > 2003 or year < 2000:
        satellite = 'L5'
    else:
        satellite = 'L7'

    index = satellite + "_" + str(year) + "_WET"
    
    urls[index] = url['tile_fetcher'].url_format.replace("{z}/{x}/{y}", "${z}/${x}/${y}")

if __name__ == "__main__":
    campaigns = sys.argv[2].split(',')
    years = range(1985, datetime.datetime.now().year)

    for year in years:
         process_year(year)
        
    for campaign in campaigns:
         db.campaign.update_one({ "_id": campaign }, { "$set": {"customURLs": urls} }, True)
        
	
