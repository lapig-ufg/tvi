#!/usr/bin/python3
import os
import sys
import ee
import json
import datetime
import traceback
import glob
from google.oauth2 import service_account
from pymongo import MongoClient

MONGO_URL = os.getenv('MONGO_URL')

EE_PRIVATE_KEY_FILE = sys.argv[1]
MONGO_HOST = sys.argv[2]
MONGO_PORT = int(sys.argv[3])

TILES_BR = ['001057','001058','001059','001060','001061','001062','001063','001064','001065','001066','001067','002057','002059','002060','002061','002062','002063','002064','002065','002066','002067','002068','003058','003059','003060','003061','003062','003063','003064','003065','003066','003067','003068','004059','004060','004061','004062','004063','004064','004065','004066','004067','005059','005060','005063','005064','005065','005066','005067','006063','006064','006065','006066','214064','214065','214066','214067','215063','215064','215065','215066','215067','215068','215069','215070','215071','215072','215073','215074','216063','216064','216065','216066','216067','216068','216069','216070','216071','216072','216073','216074','216075','216076','217062','217063','217064','217065','217066','217067','217068','217069','217070','217071','217072','217073','217074','217075','217076','218062','218063','218064','218065','218066','218067','218068','218069','218070','218071','218072','218073','218074','218075','218076','218077','219062','219063','219064','219065','219066','219067','219068','219069','219070','219071','219072','219073','219074','219075','219076','219077','220062','220063','220064','220065','220066','220067','220068','220069','220070','220071','220072','220073','220074','220075','220076','220077','220078','220079','220080','220081','221061','221062','221063','221064','221065','221066','221067','221068','221069','221070','221071','221072','221073','221074','221075','221076','221077','221078','221079','221080','221081','221082','221083','222061','222062','222063','222064','222065','222066','222067','222068','222069','222070','222071','222072','222073','222074','222075','222076','222077','222078','222079','222080','222081','222082','222083','223060','223061','223062','223063','223064','223065','223066','223067','223068','223069','223070','223071','223072','223073','223074','223075','223076','223077','223078','223079','223080','223081','223082','224060','224061','224062','224063','224064','224065','224066','224067','224068','224069','224070','224071','224072','224073','224074','224075','224076','224077','224078','224079','224080','224081','224082','225058','225059','225060','225061','225062','225063','225064','225065','225066','225067','225068','225069','225070','225071','225072','225073','225074','225075','225076','225077','225080','225081','226057','226058','226059','226060','226061','226062','226063','226064','226065','226066','226067','226068','226069','226070','226071','226072','226073','226074','226075','227058','227059','227060','227061','227062','227063','227064','227065','227066','227067','227068','227069','227070','227071','227072','227073','227074','227075','228058','228059','228060','228061','228062','228063','228064','228065','228066','228067','228068','228069','228070','228071','228072','229058','229059','229060','229061','229062','229063','229064','229065','229066','229067','229068','229069','229070','229071','230059','230060','230061','230062','230063','230064','230065','230066','230067','230068','230069','231057','231058','231059','231060','231061','231062','231063','231064','231065','231066','231067','231068','231069','232056','232057','232058','232059','232060','232061','232062','232063','232064','232065','232066','232067','232068','232069','233057','233058','233059','233060','233061','233062','233063','233064','233065','233066','233067','233068', 
						'231072','231073','231074','231075','231076','231077','231078','231079','231080','231081','231082','231083','229072','229073','229074','229075','229076','229077','229078','229079','229080','229081','229082','229083','227073','227074','227075','227076','227077','227078','227079','227080','227081','225076','225077','225078','225079','225080','230072','230073','230074','230075','230076','230077','230078','230079','230080','230081','230082','230083','230084','228073','228074','228075','228076','228077','228078','228079','228080','228081','226075','226076','226077','226078','226079','226080','226081','224079','232081', '230055','230056','230057','230058','230059','230069','230070','230071','230072','230073','230074','004055','004056','004057','004058','004059','004060','004061','004062','004063','004066','004067','004068','004069','004070','004071','228056','228057','228058','228071','228072','002054','002055','002056','002057','002058','002059','002060','002067','002068','002069','002070','002071','009059','009060','009061','009062','009063','009064','009065','009066','226057','226058','226071','226072','233053','233054','233055','233056','233057','233058','233059','233067','233068','233069','233070','233071','233072','233073','007057','007058','007059','007060','007061','007062','007063','007064','007065','007066','007067','007068','231054','231055','231056','231057','231058','231059','231069','231070','231071','231072','231073','231074','005057','005058','005059','005060','005061','005062','005063','005064','005066','005067','005068','005069','005070','229056','229057','229058','229059','229070','229071','229072','229073','003054','003055','003056','003057','003058','003059','003067','003068','003069','003070','003071','010059','010060','010061','010062','010063','010064','227056','227057','227058','227059','227071','227072','001053','001054','001055','001056','001057','001058','001059','001067','001068','001069','001070','001071','001072','008057','008058','008059','008060','008061','008062','008063','008064','008065','008066','008067','225071','225072','232054','232055','232056','232057','232068','232069','232070','232071','232072','232073','006057','006058','006059','006060','006061','006062','006063','006064','006065','006066','006067','006068','006069','006070']

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

def initialize_gee_with_service_account(private_key_file):
    """
    Inicializa o Google Earth Engine usando um arquivo de chave privada de Service Account.

    Args:
        private_key_file (str): Caminho para o arquivo de chave privada (.json).
    """
    try:
        service_account_file = private_key_file
        print(f"Initializing service account {service_account_file}")
        credentials = service_account.Credentials.from_service_account_file(
            service_account_file,
            scopes=["https://www.googleapis.com/auth/earthengine.readonly"],
        )
        ee.Initialize(credentials)

        print("GEE Initialized successfully.")
    except Exception as e:
        raise HTTPException(status_code=500, detail="Failed to initialize GEE")

def getBestImg(satellite, year, mDaysStart, mDaysEnd, path, row):
	dtStart = str(year) + mDaysStart
	dtEnd = str(year) + mDaysEnd

	if satellite == 'L8':
		collection = LANDSAT_8
		bands = ['B5','B6','B4']
	elif satellite == 'L5':
		collection = LANDSAT_5
		bands = ['B4','B5','B3']
	elif satellite == 'L7':
		collection = LANDSAT_7
		bands = ['B4','B5','B3']

	bestImg = collection.filterDate(dtStart,dtEnd) \
										.filterMetadata('WRS_PATH','equals',path)  \
										.filterMetadata('WRS_ROW','equals',row) \
										.sort("CLOUD_COVER") \
										.select(bands,['NIR','SWIR','RED']) \
										.first()
	
	return ee.Image(bestImg)

def getWRS(feature):
    return ee.Feature(feature).get('PR')

def getWrsCodes(countryName):
    ee.Initialize()
    countries = ee.FeatureCollection("users/lapig/countries")
    wrs = ee.FeatureCollection("users/lapig/WRS2")

    query = ee.Filter.inList('ISO', countryName.split(','))

    selectedcountries = ee.Feature(countries.filter(query))

    selectedRegion =  ee.FeatureCollection(selectedcountries).flatten()

    wrs_filtered = wrs.filterBounds(selectedRegion.geometry())

    wrs_list = wrs_filtered.toList(wrs_filtered.size())

    listWrs = list(wrs_list.map(getWRS).getInfo())
    listWrs.sort()

    ee.Reset()

    return listWrs

def getBestMosaic(tiles, satellite, year, dtStart, dtEnd):
	images = []
	for tile in tiles:
		path = int(tile[0:3])
		row = int(tile[3:6])
		bestImg = getBestImg(satellite, year, dtStart, dtEnd, path, row)
		
		images.append(bestImg)
	
	imageCollection = ee.ImageCollection.fromImages(images)
	
	return imageCollection.mosaic()

def publishImg(image):
	# mapId = image.getMapId({ "bands": 'NIR,SWIR,RED'}) - Padrão LAPIG
	# mapId = image.getMapId({ "bands": 'SWIR,NIR,RED'}) - Padrão RAISG

	mapId = image.getMapId({ "bands": 'NIR,SWIR,RED'})
	
	print(mapId['tile_fetcher'].url_format)

	for i in mapId:
		
		if(i == u'token'):
			eeToken = str(mapId.get(i))
		elif (i == u'mapid'):
			eeMapid = str(mapId.get(i))

	return eeToken, eeMapid

def getExpirationDate():
	now = datetime.datetime.now()
	return datetime.datetime(now.year, now.month, now.day) + datetime.timedelta(hours=24)

def processPeriod(tiles, periods, suffix = ''):
	for periodDict in periods:

		period = periodDict['name']
		dtStart = periodDict['dtStart']
		dtEnd = periodDict['dtEnd']

		mosaicId = satellite + "_" + str(year) + "_" + period + suffix
		existMosaic = db.mosaics.find_one({ "_id": mosaicId })

		if existMosaic == None or datetime.datetime.now() > existMosaic['expiration_date']:
			try:
				bestMosaic = getBestMosaic(tiles, satellite,year,dtStart,dtEnd)
				eeToken, eeMapid = publishImg(bestMosaic)

				expirationDate = getExpirationDate()

				mosaic = {
					"ee_token": eeToken,
					"ee_mapid": eeMapid,
					"expiration_date": expirationDate
				}

				db.mosaics.update_one({ "_id": mosaicId }, { "$set": mosaic }, True)
				print(mosaicId + ' updated.')
			except:
				traceback.print_exc()
				print(mosaicId + ' no image.')

		else:
			print(mosaicId + ' exists and is valid.')

client = MongoClient(MONGO_URL)
db = client.tvi

initialize_gee_with_service_account(EE_PRIVATE_KEY_FILE)

now = datetime.datetime.now()
current_year = now.year

if len(sys.argv) > 4:
    TILES_BR = getWrsCodes(sys.argv[4])

for year in range(1985, current_year):

	LANDSAT_5 = ee.ImageCollection("LANDSAT/LT05/C02/T1_TOA")
	LANDSAT_7 = ee.ImageCollection("LANDSAT/LE07/C02/T1_TOA")
	LANDSAT_8 = ee.ImageCollection("LANDSAT/LC08/C02/T1_TOA")

	for satellite in SATELLITES:
		if (satellite == 'L8' and year < 2013) or (satellite == 'L5' and year > 2011):
			continue

		if (satellite == 'L7' and year < 2000):
			continue

		processPeriod(TILES_BR, PERIODS_BR)


ee.Reset()
