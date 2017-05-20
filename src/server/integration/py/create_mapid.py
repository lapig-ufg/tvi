#!/usr/bin/python

from sys import argv
import time 

import oauth2client
from oauth2client import client
from oauth2client import tools
import argparse
import numpy as np
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

errorlog = open("./../../log/download.log", 'w')

EE_ACCOUNT = '163878256934-uorqnep89dmauei9tv8s5cmhcro4s0p9@developer.gserviceaccount.com'
EE_PRIVATE_KEY_FILE = 'lapig-ee-09144f43f3b5.pem'
EE_CREDENTIALS = ee.ServiceAccountCredentials(EE_ACCOUNT, EE_PRIVATE_KEY_FILE)

ee.Initialize(EE_CREDENTIALS)

L8_BANDS = 'B5,B6,B4'
L8_COLLECTION = ee.ImageCollection("LANDSAT/LC8_L1T_TOA")
L8_START = datetime.datetime.strptime('2013-01-01', '%Y-%m-%d').date()

L7_BANDS = 'B4,B5,B3'
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

def parseArguments():
			
	parser = argparse.ArgumentParser()
 
	parser.add_argument("id", help="id do ponto", type=str);
	parser.add_argument("lon", help="Longitude", type=str);
	parser.add_argument("lat", help="Latitude", type=str);
	parser.add_argument("startYear", help="Ano inicial", type=str);
	parser.add_argument("endYear", help="Ano final", type=str);
	parser.add_argument("startChuva", help="Inicio da temporada chuvosa", default='-01-01', nargs='?');
	parser.add_argument("endChuva", help="Fim da temporada chuvosa", default='-05-31', nargs='?');
	parser.add_argument("startSeco", help="Inicio da temporada seca", default='-06-01', nargs='?');
	parser.add_argument("endSeco", help="Fim da temporada seca", default='-08-31', nargs='?');
	parser.add_argument("png", help="Fim da temporada seca", default='Y', nargs='?');

	args = parser.parse_args();
	return args

def getImageFromLandsat(dtStart, dtEnd, path, row, year):
	imgResult = 0;
	#dtStart = str(year)+'-01-01';
	dtStartObj = datetime.datetime.strptime(str(year)+'-01-01', '%Y-%m-%d').date()

	while True:
		try:
			if dtStartObj >= L8_START:
				landsatBands = L8_BANDS;
				imgResult = L8_COLLECTION.filterDate(dtStart,dtEnd).filterMetadata('WRS_PATH', 'equals', int(path)).filterMetadata('WRS_ROW', 'equals', int(row)).sort('CLOUD_COVER', True).first();
			elif dtStartObj >= L7_START:
				landsatBands = L7_BANDS;
				imgResult = L7_COLLECTION.filterDate(dtStart,dtEnd).filterMetadata('WRS_PATH', 'equals', int(path)).filterMetadata('WRS_ROW', 'equals', int(row)).sort('CLOUD_COVER', True).first();
			elif dtStartObj >= L5_START:
				landsatBands = L7_BANDS;
				imgResult = L5_COLLECTION.filterDate(dtStart,dtEnd).filterMetadata('WRS_PATH', 'equals', int(path)).filterMetadata('WRS_ROW', 'equals', int(row)).sort('CLOUD_COVER', True).first();
				if imgResult.getInfo() == None:
					imgResult = L7_COLLECTION.filterDate(dtStart,dtEnd).filterMetadata('WRS_PATH', 'equals', int(path)).filterMetadata('WRS_ROW', 'equals', int(row)).sort('CLOUD_COVER', True).first();
			break;
		except Exception as e:
			#errorlog.write("\n"+str(e))
			print(e)
			time.sleep(60);


	dataAcquiredd = '';
	spacecraft = '';
	while True:
		try:
			img = ee.Image(imgResult);
			if img.getInfo() != None: 
				dataAcquiredd = img.get('DATE_ACQUIRED').getInfo();
				spacecraft = img.get('SPACECRAFT_ID').getInfo();
			break;
		except Exception as e:
			#errorlog.write("\n"+str(e))
			print(e)
			time.sleep(1);

	return landsatBands, dataAcquiredd, spacecraft, img;

def downloadLandsatFromEE(Id, longitude, latitude, startYear, endYear, startChuva, endChuva, startSeco, endSeco, png):
	longitude = float(longitude)
	latitude = float(latitude)
	startYear = int(startYear)
	endYear = int(endYear)
	imageFiles = []

	inc = 1
	bufferR = 5000
	folder='quicklook'
	taskConfig = { "scale": 30, "maxPixels": 1.0E13, "driveFolder": 'quicklook' }

	while True:
		try:		
			point = ee.Geometry.Point(longitude,latitude);
			bufferArea = point.buffer(bufferR).bounds();
			scene = ee.FeatureCollection(LANDSAT_GRID) \
					.filterBounds(point) \
					.first()					
			scene.getInfo();
			break;
		except Exception as e:
			#errorlog.write("\n"+str(e))
			print(e)
			time.sleep(15);

	if(scene.getInfo() != None): 

		while True:
			try:
				tile = scene.get('TILE_T').getInfo();
				break;
			except Exception as e:
				print(e);
				time.sleep(15);

		path = tile[1:4]
		row = tile[4:7]
				 
		season = [
			{
				"start": startSeco, 
				"end": endSeco, 
				"type": "seco"
			}, 
			{
				"start": startChuva, 
				"end": endChuva, 
				"type": "chuvoso"
			}
		];

		for year in xrange(startYear, endYear, inc):
			
			for x in season:	

				dtStart = str(year)+x['start'];
				dtEnd = str(year)+x['end'];

				landsatBands, dataAcquired, spacecraft, img = getImageFromLandsat(dtStart, dtEnd, path, row, year);
				
				if spacecraft != '':
					try:					

						lon = str("%.4f" % longitude);
						lat = str("%.4f" % latitude);				

						filename = Id+"_"+dataAcquired+"_"+spacecraft.lower() + '_' + x['type'];

						idDict = {};

						imgResult = img.clip(bufferArea);
						img = imgResult;

						print(landsatBands)
						mapId = img.getMapId({ "bands": landsatBands, "min":"0,0,0", "max":"0.7,0.6,0.6", "gamma": "1.3,0.9,1.3" });

						for i in mapId:
							
							if(i == u'token'):
								idDict["token"] = str(mapId.get(i));
							elif (i == u'mapid'):
								idDict["mapid"] = str(mapId.get(i));
						
						print(idDict);
						
					except:
						traceback.print_exc();
						pass;

	return imageFiles;

def createCenterPointImages(lon, lat, imageFiles):	

	tempFiles = [];

	for imageFile in imageFiles:

		GDALDataSet = gdal.Open(imageFile+".tif");

		rasterBand = GDALDataSet.GetRasterBand(2);

		gt = GDALDataSet.GetGeoTransform()
		
		cols = rasterBand.XSize
		rows = rasterBand.YSize

		newRasterPattern =  imageFile + "-ref";
		newRaster = newRasterPattern + ".tif";

		tempFiles.append(newRasterPattern);

		driver = gdal.GetDriverByName('GTiff');

		outRaster = driver.Create(newRaster, cols, rows, 3, gdal.GDT_Byte)
		outRaster.SetGeoTransform((gt[0], gt[1], gt[2], gt[3], gt[4], gt[5]))

		for i in xrange(1,4):

			rasterBand = GDALDataSet.GetRasterBand(i);
			outband = outRaster.GetRasterBand(i)

			px = int(rows/2)
			py = int(cols/2)

			intval = rasterBand.ReadAsArray()

			for x in xrange(px-2, px+3):
				for y in xrange(py-2, py+3):
					if(x == px-2) or (x == px+2) or (y == py-2) or (y == py+2):
						intval[x][y] = 255;
					elif(x == px and y == py):
						intval[x][y] = 0;
				
			outband.WriteArray(intval)
			outRasterSRS = osr.SpatialReference()
			outRasterSRS.ImportFromEPSG(4326)
			outRaster.SetProjection(outRasterSRS.ExportToWkt())	

			outband.FlushCache()

	return imageFiles + tempFiles;

def convertPng(imageFiles):
	for imageFile in imageFiles:	
		os.system("gdal_translate -of png " +imageFile+".tif"+" "+imageFile+".png"+" "+"&>"+" "+"/dev/null");
		os.system("convert " +imageFile+".png -channel RGB -contrast-stretch 2x2% " +imageFile+".png");
		print(imageFile+".png");
		os.remove(imageFile+".tif");
		os.remove(imageFile+".png.aux.xml");

def generateModisChart(lon, lat, startYear, endYear, imageFiles):

	date1 = str(int(startYear)-3);
	date2 = endYear+'-12-31';
	lon = float(lon);
	lat = float(lat);

	if date1 < 2000:
		date1 = 2000;

	pixelResolution = 250

	collectionId = "MODIS/MOD13Q1";
	expression = "b('NDVI')*0.0001";
	
	def calculateIndex(image):
		 return image.expression(expression);


	while True:
		try:		
			point = ee.Geometry.Point([lon, lat]);
			timeSeries = ee.ImageCollection(collectionId).filterDate(date1, date2).map(calculateIndex);
			result = timeSeries.getRegion(point,pixelResolution).getInfo();
			break;
		except Exception as e:
			#errorlog.write("\n"+str(e))
			print(e)
			time.sleep(15);
	
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

	imgDates = [];

	for imageFile in imageFiles:
		if 'geo-ref' in imageFile:
			imgDates.append(imageFile.split('_')[1])

	imgDatesStr = " ".join(imgDates);
	os.system("Rscript chart.r "+csvFile+" "+imgDatesStr+" &> /dev/null");
	print(csvFile+".png")
	os.remove(csvFile+".csv")

if __name__ == "__main__":
	
	args = parseArguments()
	imageFiles = downloadLandsatFromEE(args.id, args.lon, args.lat, args.startYear, args.endYear, args.startChuva, args.endChuva, args.startSeco, args.endSeco, args.png);	
	imageFiles = createCenterPointImages(args.lon, args.lat, imageFiles);
	
	if args.png:
		convertPng(imageFiles);
	
	generateModisChart(args.lon, args.lat, args.startYear, args.endYear, imageFiles);

