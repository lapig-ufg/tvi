#!/usr/bin/python3

import sys
import ee
import json
import datetime
import traceback
import glob

CREDENTIALS_DIR = sys.argv[1]

TILES_BR = ['001057','001058']

def gee_multi_credentials(credentials_dir):
	
	def mpb_get_credentials_path():
		credentials_files = ee.oauth.credentials_files

		if ee.oauth.current_credentials_idx == len(credentials_files):
			ee.oauth.current_credentials_idx = 0
		
		credential = credentials_files[ee.oauth.current_credentials_idx]
		ee.oauth.current_credentials_idx += 1

		print("Acessing GEE from %s" % credential)

		return credential

	ee.oauth.current_credentials_idx = 0
	ee.oauth.credentials_files = glob.glob(credentials_dir+'/*.json')

	ee.oauth.get_credentials_path = mpb_get_credentials_path

def getWRS(feature):
    return ee.Feature(feature).get('PR')

def getWrsCodes(countryName):
    countries = ee.FeatureCollection("USDOS/LSIB_SIMPLE/2017")
    wrs = ee.FeatureCollection("users/lapig/WRS2")

    selectedCountry = ee.Feature(countries.filter(ee.Filter.eq('country_na', countryName)).first())

    wrs_filtered = wrs.filterBounds(selectedCountry.geometry())

    wrs_list = wrs_filtered.toList(wrs_filtered.size())

    listWrs = list(wrs_list.map(getWRS).getInfo())
    listWrs.sort()

    return listWrs

gee_multi_credentials(CREDENTIALS_DIR)

ee.Initialize()

if len(sys.argv) > 2:
    TILES_BR = getWrsCodes(sys.argv[2])


for i in TILES_BR:
    print(i)


ee.Reset()

