#!/usr/bin/python

from __future__ import print_function
from apiclient import discovery
from apiclient.http import MediaIoBaseDownload
from sys import argv

import oauth2client
from oauth2client import client
from oauth2client import tools
try:
	import argparse
	flags = argparse.ArgumentParser(parents=[tools.argparser]).parse_args()
except ImportError:
	flags = None

import httplib2
import ee
import datetime
import traceback
import wget
import zipfile
import os
import time
import io

ee.Initialize()

#L8_BANDS = ['B6','B5','B4']
L8_BANDS = ['B5','B6','B4']
L8_COLLECTION = ee.ImageCollection("LANDSAT/LC8_L1T_TOA")
L8_START = datetime.datetime.strptime('2013-01-01', '%Y-%m-%d').date()

#L7_BANDS = ['B5','B4','B3']
L7_BANDS = ['B4','B5','B3']
L7_COLLECTION = ee.ImageCollection("LANDSAT/LE7_L1T_TOA")
L7_START = datetime.datetime.strptime('2012-01-01', '%Y-%m-%d').date()

L5_START = datetime.datetime.strptime('1984-01-01', '%Y-%m-%d').date()
L5_COLLECTION = ee.ImageCollection("LANDSAT/LT5_L1T_TOA");

GDRIVE_SLEEP_TIME=10
CLIENT_SECRET_FILE = 'client_secrets.json'
APPLICATION_NAME = 'Earth Engine Download'
SCOPES = 'https://www.googleapis.com/auth/drive'
CREDENTIALS_FILENAME = 'earth_engine_download.json'
LANDSAT_GRID = 'ft:1qNHyIqgUjShP2gQAcfGXw-XoxWwCRn5ZXNVqKIS5'

def getGDriveService():
		home_dir = os.path.expanduser('~')
		credential_dir = os.path.join(home_dir, '.credentials')
		if not os.path.exists(credential_dir):
				os.makedirs(credential_dir)
		credential_path = os.path.join(credential_dir, CREDENTIALS_FILENAME)

		store = oauth2client.file.Storage(credential_path)
		credentials = store.get()
		if not credentials or credentials.invalid:
				flow = client.flow_from_clientsecrets(CLIENT_SECRET_FILE, SCOPES)
				flow.user_agent = APPLICATION_NAME
				if flags:
						credentials = tools.run_flow(flow, store, flags)
				else: # Needed only for compatibility with Python 2.6
						credentials = tools.run(flow, store)
				print('Storing credentials to ' + credential_path)
		
		http = credentials.authorize(httplib2.Http())
		return discovery.build('drive', 'v3', http=http)

def getFileId(gDriveService, filename):
	results = gDriveService.files().list(q="name='"+filename+"'", pageSize=1, fields="nextPageToken, files(id, name)").execute()
	items = results.get('files', [])
	if items:
		item = items[0]
		if item['name'] == filename:
			return item['id'];

	return None

def downloadFile(gDriveService, fileGdriveId, destFilename):
	request = gDriveService.files().get_media(fileId=fileGdriveId)
	fh = io.FileIO(destFilename, mode='wb')
	downloader = MediaIoBaseDownload(fh, request, chunksize=1024*1024)
	done = False
	while done is False:
		status, done = downloader.next_chunk()

def permanentDeleteFile(gDriveService, fileGdriveId):
	try:
		gDriveService.files().delete(fileId=fileGdriveId).execute();
		gDriveService.files().emptyTrash();
	except:
		pass

def getLandsatFromYear(year):
	dtStart = str(year)+'-01-01';
	dtStartObj = datetime.datetime.strptime(dtStart, '%Y-%m-%d').date()
	if dtStartObj >= L8_START:
		landsatBands = L8_BANDS;
		landsatCollection = L8_COLLECTION;
	elif dtStartObj >= L7_START:
		landsatBands = L7_BANDS;
		landsatCollection = L7_COLLECTION;
	elif dtStartObj >= L5_START:
		landsatBands = L7_BANDS;
		landsatCollection = L5_COLLECTION;
	
	return landsatBands, landsatCollection

#-49.0963 #-16.8775
#-46.2293	-11.0596 // Crop - Formosa do Rio Preto

# -46.7582 -6.8643 // N pastagem
# -54.4980 -13.7521 // N pastagem
# -54.7599 -13.5594 // Pastagem / Crop terraclass




def main(lon, lat, startYear, endYear):

	print (lon, lat);

	inc = 1
	bufferR = 5000
	folder='quicklook'
	taskConfig = { "scale": 30, "maxPixels": 1.0E13, "driveFolder": 'quicklook' }

	gDriveService = getGDriveService();

	point = ee.Geometry.Point(lon,lat);
	bufferArea = point.buffer(bufferR).bounds();
	scene = ee.FeatureCollection(LANDSAT_GRID) \
			.filterBounds(point) \
			.first();

	tile = scene.get('TILE_T').getInfo();
	path = tile[1:4]
	row = tile[4:7]

	for year in xrange(startYear, endYear, inc):
		
		dtStart = str(year)+'-01-01';
		dtEnd = str(year)+'-06-30';
		landsatBands, landsatCollection = getLandsatFromYear(year);

		imgResult = landsatCollection \
											.filterDate(dtStart,dtEnd) \
											.filterMetadata('WRS_PATH', 'equals', int(path)) \
											.filterMetadata('WRS_ROW', 'equals', int(row)) \
											.sort('CLOUD_COVER', True) \
											.first();
		
		try:
			img = ee.Image(imgResult);
			dataAcquired = img.get('DATE_ACQUIRED').getInfo();
			spacecraft = img.get('SPACECRAFT_ID').getInfo();
			
			filename = spacecraft.lower() + '_' + dataAcquired

			imgResult = img.clip(bufferArea);
			img = imgResult.visualize(bands=landsatBands, min=[0,0,0], max=[0.7,0.6,0.6], gamma=[1.5,1,1.5])

			coordList = bufferArea.coordinates().getInfo();
			region = [coordList[0][0], coordList[0][1], coordList[0][2], coordList[0][3]];
			taskConfig['region'] = [coordList[0][0], coordList[0][1], coordList[0][2], coordList[0][3]]

			task = ee.batch.Export.image.toDrive(image=img, description=filename, folder=folder, region=region, scale=30)
			task.start()

			status = task.status()	
			taskStatus = status['state']

			fileGdriveId=None;
			filename = filename + '.tif'

			while fileGdriveId == None or taskStatus not in (ee.batch.Task.State.FAILED, ee.batch.Task.State.COMPLETED, ee.batch.Task.State.CANCELLED):
				time.sleep(GDRIVE_SLEEP_TIME)
				fileGdriveId = getFileId(gDriveService, filename);
				status = task.status()	
				taskStatus = status['state']
				taskDescri = task.config['description']

			if fileGdriveId != None:
				downloadFile(gDriveService, fileGdriveId, filename);
				permanentDeleteFile(gDriveService, fileGdriveId);
				print (filename, "Download completed...")
			else:
				print (filename, taskDescri)
		except:
			print (filename, 'No images avaiable', dtStart, dtEnd)
			pass



if __name__ == "__main__":
	
	
	lon = argv[0] #-46.0347
	lat = argv[1] #-12.6345
	startYear = argv[2] #2000
	endYear = argv[3] #2016
	
	


	main(lon, lat, startYear, endYear);


