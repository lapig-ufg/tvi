#!/usr/bin/python

from __future__ import print_function
from apiclient import discovery
from apiclient.http import MediaIoBaseDownload
from sys import argv

import oauth2client
from oauth2client import client
from oauth2client import tools
import argparse
import numpy as np
'''
try:
	import argparse
	flags = argparse.ArgumentParser(parents=[tools.argparser]).parse_args()
except ImportError:
	flags = None
'''	
import httplib2
import ee
import datetime
import traceback
import wget
import zipfile
import time
import io
import gdal
import osr
import os, csv;
from PIL import Image
import shutil

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

def getPNG(files):
	for file in files:	
		os.system("gdal_translate -of png " +file+".tif"+" "+file+".png"+" "+"&>"+" "+"/dev/null");
		os.system("convert " +file+".png -channel RGB -contrast-stretch 2x2% " +file+".png");
		print(file+".png")
		os.remove(file+".tif");

def createReferenceImage(lon, lat, files):	

	for file in files:
		
		GDALDataSet = gdal.Open(file+".tif");

		rasterBand = GDALDataSet.GetRasterBand(2);

		gt = GDALDataSet.GetGeoTransform()

		originX = gt[0];
		originY = gt[3];
		
		cols = rasterBand.XSize
		rows = rasterBand.YSize

		if int(file[38:40]) >= 10:
			newRaster = file+"two.tif";
		else:
			newRaster = file+"one.tif";

		driver = gdal.GetDriverByName('GTiff');

		outRaster = driver.Create(newRaster, cols, rows, 3, gdal.GDT_Byte)

		outRaster.SetGeoTransform((originX, 1, 0, originY, 0, 1))

		for i in xrange(1,4):

			rasterBand = GDALDataSet.GetRasterBand(i);
			outband = outRaster.GetRasterBand(i)
		    
			mx, my = float(lon), float(lat);

			px = int((mx - gt[0]) / gt[1]) #x pixel
			py = int((my - gt[3]) / gt[5]) #y pixel

			intval = rasterBand.ReadAsArray()

			for x in xrange(px-2, px+3):
				for y in xrange(py-2, py+3):
					if(x == px-2) | (x == px+2) | (y == py-2) | (y == py+2):
						intval[x][y] = 255;
					else:
						intval[x][y] = 0;
				
			outband.WriteArray(intval)
			outRasterSRS = osr.SpatialReference()
			outRasterSRS.ImportFromEPSG(4326)
			outRaster.SetProjection(outRasterSRS.ExportToWkt())	

			outband.FlushCache()

	for file in files:
		if(file == files[0]):
			files.insert(1, file+"one");
		elif(file == files[2]):
			files.append(file+"two");

	return files;

def main(longitude, latitude, startYear, endYear, startChuva, endChuva, startSeco, endSeco, png):
	nameFile = [];
	longitude = float(longitude)
	latitude = float(latitude)
	startYear = int(startYear)
	endYear = int(endYear)

	inc = 1
	bufferR = 5000
	folder='quicklook'
	taskConfig = { "scale": 30, "maxPixels": 1.0E13, "driveFolder": 'quicklook' }

	gDriveService = getGDriveService();

	point = ee.Geometry.Point(longitude,latitude);
	bufferArea = point.buffer(bufferR).bounds();
	scene = ee.FeatureCollection(LANDSAT_GRID) \
			.filterBounds(point) \
			.first();

	tile = scene.get('TILE_T').getInfo();
	path = tile[1:4]
	row = tile[4:7]

	period = [];
	season = []; 
	period.append(startSeco)
	period.append(endSeco)
	season.append(period);

	period = [];
	period.append(startChuva)
	period.append(endChuva)
	season.append(period);			

	for year in xrange(startYear, endYear, inc):
		
		for x in season:

			dtStart = str(year)+x[0];
			dtEnd = str(year)+x[1];	

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

				lon = str("%.4f" % longitude);
				lat = str("%.4f" % latitude);				

				filename = "coor_"+lon.replace(".","_")+"_"+lat.replace(".","_")+"_"+spacecraft.lower() + '_' + dataAcquired;
				
				imgResult = img.clip(bufferArea);
				img = imgResult.visualize(bands=landsatBands)

				coordList = bufferArea.coordinates().getInfo();
				region = [coordList[0][0], coordList[0][1], coordList[0][2], coordList[0][3]];
				taskConfig['region'] = [coordList[0][0], coordList[0][1], coordList[0][2], coordList[0][3]]

				task = ee.batch.Export.image.toDrive(image=img, description=filename, folder=folder, region=region, scale=30)
				task.start()

				status = task.status()	
				taskStatus = status['state']

				fileGdriveId=None;
				geofilename = filename
				
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
					os.system("gdalwarp -t_srs EPSG:4326 "+ filename+" "+geofilename+"-geo.tif"+" "+"&>"+" "+"/dev/null")
					nameFile.append(str(geofilename+"-geo"));
					try:
						os.remove(filename);
					except:
						pass

				else:
					pass
			except:
				pass

	return nameFile;

def timeSeriesEE(lon, lat, startYear, endYear):

	date1 = str(int(startYear)-1);
	date2 = str(int(endYear));
	lon = float(lon);
	lat = float(lat);

	pixelResolution = 250

	collectionId = "MODIS/MOD13Q1";
	expression = "b('NDVI')*0.0001";
	
	def calculateIndex(image):
		 return image.expression(expression);

	point = ee.Geometry.Point([lon, lat]);
	timeSeries = ee.ImageCollection(collectionId).filterDate(date1, date2).map(calculateIndex);
	result = timeSeries.getRegion(point,pixelResolution).getInfo();
	csvMatrix = [];

	for line in xrange(0, len(result)):
		if line == 0:
			lista = [];
			lista.append("type")
			lista.append("year")
			lista.append("value")
			csvMatrix.append(lista);
		lista = []
		lista.append("01-MODIS")	
		for column in xrange(0, len(result[line])):
			if line != 0:
				if column == 0:
					string = str(result[line][column]);
					lista.append(string[12:])
				elif column == 4:
					string = str(result[line][column]);
					lista.append(string)
		if line != 0:
			csvMatrix.append(lista);


	lon = str("%.4f" % lon);
	lat = str("%.4f" % lat);
	csvFile = "coor_"+lon.replace(".","_")+"_"+lat.replace(".","_")+"_modis_chart_"+startYear+"_"+endYear
	with open(csvFile+".csv", 'wb') as csvfile:
	    spamwriter = csv.writer(csvfile, delimiter=',');
	    for line in csvMatrix:
	    	spamwriter.writerow(line)

	os.system("Rscript chart.r "+csvFile+" &> /dev/null");
	print(csvFile+".png")
	os.remove(csvFile+".csv")

def parseArguments():
	    
  parser = argparse.ArgumentParser()
  parser.add_argument("lon", help="Longitude", type=str);
  parser.add_argument("lat", help="Latitude", type=str);
  parser.add_argument("startYear", help="Ano inicial", type=str);
  parser.add_argument("endYear", help="Ano final", type=str);
  parser.add_argument("startChuva", help="Inicio da temporada chuvosa", default='-01-01', nargs='?');
  parser.add_argument("endChuva", help="Fim da temporada chuvosa", default='-04-30', nargs='?');
  parser.add_argument("startSeco", help="Inicio da temporada seca", default='-06-01', nargs='?');
  parser.add_argument("endSeco", help="Fim da temporada seca", default='-08-31', nargs='?');
  parser.add_argument("png", help="Fim da temporada seca", default='Y', nargs='?');

  args = parser.parse_args();
  return args

if __name__ == "__main__":
	
	args = parseArguments()

	nameFile = main(args.lon, args.lat, args.startYear, args.endYear, args.startChuva, args.endChuva, args.startSeco, args.endSeco, args.png);	
	
	nameFile = createReferenceImage(args.lon, args.lat, nameFile);
	
	if args.png:
		getPNG(nameFile);
	
	timeSeriesEE(args.lon, args.lat, args.startYear, args.endYear);

 