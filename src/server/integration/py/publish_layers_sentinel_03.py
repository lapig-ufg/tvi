#!/usr/bin/python3

import sys
import ee
import csv
import json
import datetime
import traceback
import numpy as np
from pymongo import MongoClient

# MONGO_HOST = '172.18.0.6'
# MONGO_PORT = 27017

MONGO_HOST = '127.0.0.1'
MONGO_PORT = 27019


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

BBOXES = []
PROJ = None

EE_PRIVATE_KEY_FILE = sys.argv[1]
data = json.load(open(EE_PRIVATE_KEY_FILE))
EE_ACCOUNT = data['client_email']

EE_CREDENTIALS = ee.ServiceAccountCredentials(EE_ACCOUNT, EE_PRIVATE_KEY_FILE)

BANDS = ['SWIR1','REDEDGE4','RED']
FOREST = ['RED', 'GREEN', 'BLUE']
DRYREGIONS = ['NIR', 'RED', 'GREEN']
AGRICULTURALAREAS = ['REDEDGE4', 'SWIR1', 'REDEDGE1']
LAPIG_TVI = ['SWIR1','REDEDGE4','RED']

def update_point(point, mosaics):
	try:
		db.points.update_one({ "_id": point['_id'] }, { "$set": {"mosaics": mosaics, "imgType": "sentinel", "updateAt": datetime.datetime.now()}}, upsert=True)
		print(mosaics)
	except:
		traceback.print_exc()
		print(point['_id'] + ' no image.')

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

def get_best_image_point(start_date, end_date, point):
    geom = ee.Geometry.Point([point['lon'], point['lat']])
    
    # Filter the collection by date
    s2 = ee.ImageCollection("COPERNICUS/S2_HARMONIZED")
    s2 = s2.filterDate(start_date, end_date).filterBounds(geom)
    s2 = s2.sort('CLOUDY_PIXEL_PERCENTAGE', False)

    s2 = s2.select( ['B2','B3','B4','B5','B6','B7','B8','B8A','B11','B12'],
                    ['BLUE','GREEN','RED','REDEDGE1','REDEDGE2','REDEDGE3','NIR','REDEDGE4','SWIR1','SWIR2'])

    LAPIG_TVI = ['SWIR1','REDEDGE4','RED']
                 B11, B8A, B4
    # Get the best image, based on the cloud cover.
    best_image = s2.mosaic()
    initial_scale = 156543.03  # meters/pixel at zoom level 0 at the equator
    zoom_level = 15

    scale = initial_scale * (2 ** (-zoom_level))
    scale_x = scale
    scale_y = scale

    request = {
        'expression': best_image,
        'fileFormat': 'PNG',
        'bandIds': BANDS,
        'grid': {
            'dimensions': {
                'width': 267,
                'height': 267
            },
            'affineTransform': {
                'scaleX': scale_x,
                'shearX': 0,
                'translateX': point['lon'],
                'shearY': 0,
                'scaleY': scale_y,
                'translateY': point['lat']
            },
            'crsCode': PROJ['crs'],
        },
        'visualizationOptions': {'ranges': [{"min": get_min(), "max": get_max()}]},
    }

    image_png = ee.data.computePixels(request)

    print(image_png, dir(image_png))

    s2 = None
  
    return image_png


def get_mosaic_list_point(point):
        keys = []
        values = []
        dates_keys = []
        dates_values = []
        end_year = datetime.datetime.now().year

        for year in range(2019, end_year):
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
                values.append(get_best_image_point(dt_start, dt_end, point))

        return dict(zip(keys, values)), dict(zip(dates_keys, dates_values))

client = MongoClient(MONGO_HOST, MONGO_PORT)
db = client['tvi']

ee.Initialize(EE_CREDENTIALS)
PROJ = ee.Projection('EPSG:3857').atScale(10).getInfo()
with open(sys.argv[2], 'r') as file:
    for line in file:
            campaign_id = line.strip()
            points = db.points.find({ "campaign": campaign_id }).limit(1)
            for point in points:
                mosaics = get_mosaic_list_point(point)
                update_point(point, mosaics)

    ee.Reset()
