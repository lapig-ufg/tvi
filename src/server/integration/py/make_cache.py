import math
import requests

def deg2num(lat_deg, lon_deg, zoom):
	lat_rad = math.radians(lat_deg)
	n = 2.0 ** zoom
	xtile = int((lon_deg + 180.0) / 360.0 * n)
	ytile = int((1.0 - math.log(math.tan(lat_rad) + (1 / math.cos(lat_rad))) / math.pi) / 2.0 * n)
	return (xtile, ytile)

lat = -15.1209;
lon = -49.4203;
zoom = 13;
host = "localhost:5000";

PERIODS = ['DRY','WET']
SATELLITES = [ 'L8', 'L7', 'L5' ]

xtile, ytile = deg2num(lat, lon, zoom);

for year in range(2000,2016):
	for satellite in SATELLITES:

		if (satellite == 'L8' and year < 2013) or (satellite == 'L5' and year > 2011):
			continue;

		for period in PERIODS:
			for x in range((xtile-1),(xtile+1)):
				for y in range((ytile-1),(ytile+1)):
					url = "http://"+host+"/map/"+satellite+"_"+str(year)+"_"+period+"/13/"+str(x)+"/"+str(y);
					print(url);
					requests.get(url)