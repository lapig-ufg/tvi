#!/usr/bin/python3

import sys
import ee
import json
import datetime
import traceback
import numpy as np
from pymongo import MongoClient

MONGO_HOST = '172.18.0.6'
MONGO_PORT = 27017

SATELLITES = [ 'L8', 'L7', 'L5' ]

PERIODS_BR = [
	{
		"name": 'WET',
		"dtStart": '-01-01',
		"dtEnd": '-04-30'
	},
	{
		"name": 'DRY',
		"dtStart": '-06-01',
		"dtEnd": '-10-30'
	}
]

EE_PRIVATE_KEY_FILE = sys.argv[1]
data = json.load(open(EE_PRIVATE_KEY_FILE))
EE_ACCOUNT = data['client_email']

EE_CREDENTIALS = ee.ServiceAccountCredentials(EE_ACCOUNT, EE_PRIVATE_KEY_FILE)

BANDS = ['SWIR1','REDEDGE4','RED']
FOREST = ['RED', 'GREEN', 'BLUE']
DRYREGIONS = ['NIR', 'RED', 'GREEN']
AGRICULTURALAREAS = ['REDEDGE4', 'SWIR1', 'REDEDGE1']
LAPIG_TVI = ['SWIR1','REDEDGE4','RED']

def update_campaign(campaign_id, mosaics, dates):
	try:
# 		db.campaign.update_one({ "_id": campaign_id }, { "$set": {"customURLs":  mosaics, "dates": infos, "updateAt": datetime.datetime.now()}}, upsert=True)
		print(campaign_id, mosaics, dates)
	except:
		traceback.print_exc()
		print(campaign_id + ' no image.')

def get_min():
    min = [0.0]
    if np.array_equal(FOREST, BANDS):
        min = [200,300,700]
    elif np.array_equal(DRYREGIONS, BANDS):
        min = [1100,700,600]
    elif np.array_equal(AGRICULTURALAREAS, BANDS):
        min = [1700,700,600]
    elif np.array_equal(LAPIG_TVI, BANDS):
        min = [600,700,400]
    return min

def get_max():
    max = [0.0]
    if np.array_equal(FOREST,BANDS):
        max = [3000,2500,2300]
    elif np.array_equal(DRYREGIONS,BANDS):
        max = [4000,2800,2400]
    elif np.array_equal(AGRICULTURALAREAS,BANDS):
        max = [4600,5000,2400]
    elif np.array_equal(LAPIG_TVI,BANDS):
        max = [4300,5400,2800]
    return max

def get_gamma():
    gamma = [1.35]
    if np.array_equal(FOREST, BANDS):
        gamma = [1.35]
    elif np.array_equal(DRYREGIONS, BANDS):
        gamma =  [1.1]
    elif np.array_equal(AGRICULTURALAREAS, BANDS):
        gamma = [0.8]
    elif np.array_equal(LAPIG_TVI, BANDS):
        gamma = [1.1,1.1,1.1]
    return gamma

def get_best_image(start_date, end_date):
    print(start_date, end_date)
    # Get the Sentinel-2 collection.
    s2 = ee.ImageCollection("COPERNICUS/S2")

    # Create a bbox for Brazil.
    # brazil = ee.FeatureCollection('FAO/GAUL_SIMPLIFIED_500m/2015/level0').filter(ee.Filter.eq('ADM0_NAME', 'Brazil'))
    bounds_geometry = ee.Geometry.Rectangle([-73.56, -16.96, -43.99, 4.16])
    
    # Filter the collection by date
    s2 = s2.filterDate(start_date, end_date).filterBounds(bounds_geometry)
    s2 = s2.select( ['B2','B3','B4','B5','B6','B7','B8','B8A','B11','B12'], ['BLUE','GREEN','RED','REDEDGE1','REDEDGE2','REDEDGE3','NIR','REDEDGE4','SWIR1','SWIR2'])
 
    # Get the best image, based on the cloud cover.
    best_image = s2.sort("CLOUDY_PIXEL_PERCENTAGE").mosaic()

    # Get the date of the best image.
#     date_str = best_image.getInfo()['properties']['DATATAKE_IDENTIFIER']
#     date_string = date_str[5:13]
#
#     # Convert the date string to the desired format (YYYY-MM-DD)
#     formatted_date = f"{date_string[0:4]}-{date_string[4:6]}-{date_string[6:8]}"

    image = best_image.getMapId({ "bands": BANDS, "min": get_min(), "max": get_max(), "gamma": get_gamma()})

    return image, best_image.getInfo()

def get_mosaic_list():
        keys = []
        values = []
        dates_keys = []
        dates_values = []
        end_year = datetime.datetime.now().year

        ee.Initialize(EE_CREDENTIALS)

        for year in range(2022, end_year):
            if year > 2012: 
                satellite = 'L8'
            elif year > 2011:
                satellite = 'L7'
            elif year > 2003 or year < 2000:
                satellite = 'L5'
            else:
                satellite = 'L7'

            for period_dict in PERIODS_BR:
                period = period_dict['name']
                dt_start = f"{year}{period_dict['dtStart']}"
                dt_end = f"{year}{period_dict['dtEnd']}"

                index = f"{satellite}_{year}_{period}"
                keys.append(index)
                dates_keys.append(index)

                mosaic, date = get_best_image(dt_start, dt_end)
                modified_url_format = mosaic['tile_fetcher'].url_format.replace('{', '${')

                values.append(modified_url_format)
                dates_values.append(date)

        ee.Reset()
        return dict(zip(keys, values)), dict(zip(dates_keys, dates_values))

# client = MongoClient(MONGO_HOST, MONGO_PORT)
# db = client['tvi']


with open(sys.argv[2], 'r') as file:
	for line in file:
            mosaics, info = get_mosaic_list()
            campaign_id = line.strip()
            update_campaign(campaign_id, mosaics, info)

