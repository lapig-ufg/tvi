#!/usr/bin/env python3

import argparse
from pyproj import Transformer
from shapely.geometry import Point

def main():
    try:
        parser = argparse.ArgumentParser(
            fromfile_prefix_chars='@',
            description='Create a bbox from point',
            epilog='Enjoy the program! :)'
        )

        parser.add_argument('--lon', type=float, help='Longitude of the point')
        parser.add_argument('--lat', type=float, help='Latitude of the point')
        parser.add_argument('--crs_from', type=str, nargs='?', default='epsg:4326', help="Code of projection default: 'epsg:4326'")
        parser.add_argument('--crs_to', type=str, nargs='?', default='epsg:900913', help="Code of projection default: 'epsg:900913'")
        parser.add_argument('--size', default=4000, nargs='?', type=int, help='Size of the bbox in meters default: 4000')

        # Execute parse_args()
        args = parser.parse_args()

        transformer = Transformer.from_crs(args.crs_from, args.crs_to, always_xy=True)
        x, y = transformer.transform(args.lon, args.lat)
        buffer = Point(x, y).buffer(args.size)
        bbox = buffer.bounds

        print(f"{bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]}")

    except Exception as e:
        print("Error:", e)

if __name__ == "__main__":
    main()
