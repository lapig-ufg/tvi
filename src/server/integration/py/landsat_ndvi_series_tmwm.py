# -*- coding: utf-8 -*-
import os
import click
import pandas as pd
from pathlib import Path
from multiprocessing import Pool
from pymongo import MongoClient
from datetime import timedelta, date

client = None
db = None
cp = None
points_table = None
landsat_ndvi_series = None


def get_values(col):
    try:
        ponto = points_table[(points_table['TARGETID'] == int(col.split('_')[1])) & (
                points_table['CARTA_2'] == col.split('_')[0])][['LON', 'LAT']].iloc[0]
        tmp = landsat_ndvi_series[['Date', col]]
        tmp['Date'] = tmp['Date'].apply(to_date)
        tmp['lon'] = float(ponto['LON'])
        tmp['lat'] = float(ponto['LAT'])
        tmp['campaign'] = cp
        tmp['geom'] = {
            "type": "Point",
            "coordinates": [float(ponto['LON']), float(ponto['LAT'])]
        }
        tmp = tmp.rename(
            columns={
                col: 'value',
                "Date": 'date'}).to_dict(
            orient="records")
        db.timeseries.insert_many(tmp)
    except Exception as e:
        print("Error: ", e, tmp)


def to_date(x):
    year, days = x.split('-')
    return date(int(year), 1, 1) + timedelta(days=int(days) - 1)


@click.command()
@click.option("--tb", help="CSV with Mapbiomas points")
@click.option("--ts", help="CSV with Timeseries NDVI TMWM")
@click.option("--cp", help="ID of campaign of TVI")
def main(tb, ts, cp):
    client = MongoClient('172.18.0.6', 27017)
    db = client.tvi
    points_table = pd.read_csv(Path(tb).resolve())
    landsat_ndvi_series = pd.read_csv(Path(ts).resolve())
    cp = cp
    num_cores = int((os.cpu_count() * 2) - 5)
    with Pool(num_cores) as works:
        result = works.map(get_values, landsat_ndvi_series.columns[1:])


if __name__ == '__main__':
    main()
