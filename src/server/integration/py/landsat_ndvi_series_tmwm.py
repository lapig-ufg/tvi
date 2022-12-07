# -*- coding: utf-8 -*-
import os
import click
import pytz
import pandas as pd
from pathlib import Path
from loguru import logger
from multiprocessing import Pool
from pymongo import MongoClient
from datetime import timedelta, date

client = MongoClient('172.18.0.6', 27017)
tvi = client['tvi-timeseries']

def to_date(x):
    year, days = x.split('-')
    return (datetime(int(year), 1, 1) + timedelta(days=int(days) - 1)) .astimezone(pytz.utc).isoformat()

def get_values(args):    
    points_table, landsat_ndvi_series, cp, col = args
    try:
        ponto = points_table[(points_table['TARGETID'] == int(col.split('_')[1])) & (
                points_table['CARTA_2'] == col.split('_')[0])][['LON', 'LAT']].iloc[0]

        tmp = landsat_ndvi_series[['Date', col]]
        tmp.loc[:, 'Date'] = tmp['Date'].apply(to_date)
        tmp.loc[:, 'lon'] = pd.to_numeric(ponto['LON'])
        tmp.loc[:, 'lat'] = pd.to_numeric(ponto['LAT'])
        tmp.loc[:, 'class'] = ponto['CLASS_2018']
        tmp.loc[:, 'geom'] = tmp.apply(lambda x: {'type': 'Point', 'coordinates':(x.lon,x.lat)},axis=1)

        tmp = tmp.drop(['lon', 'lat'], axis=1)

        tmp = tmp.rename(
            columns={
                col: 'value',
                "Date": 'date'}).to_dict(
            orient="records")
        result = tvi[cp].insert_many(tmp)
        logger.info(f"ADD TS {col} {result}")

        return 1
    except Exception as e:
        logger.exception(e)


@click.command()
@click.option("--tb", help="CSV with Mapbiomas points")
@click.option("--ts", help="CSV with Timeseries NDVI TMWM")
@click.option("--cp", help="ID of campaign of TVI")
def main(tb, ts, cp):   
    try:
        logger.add(
            f'logs/{cp}.log',
            format='[{time} | {level:<6}] {module}.{function}:{line} {message}',
            rotation='500 MB',
        )
        logger.add(
            f'logs/{cp}_error.log',
            format='[{time} | {level:<6}] {module}.{function}:{line} {message}',
            level='WARNING',
            rotation='500 MB',
        )
        points_table = pd.read_csv(Path(tb).resolve(), low_memory=False)
        logger.info(f"load points_table {Path(tb).resolve()}")

        landsat_ndvi_series = pd.read_csv(Path(ts).resolve(), low_memory=False)
        logger.info(f"load landsat_ndvi_series {Path(ts).resolve()}")
                
        with Pool(10) as works:
            works.map(get_values,[(points_table, landsat_ndvi_series, cp, col) for col in landsat_ndvi_series.columns[1:]])

    except Exception as e:
        logger.exception(e)


if __name__ == '__main__':
    main()
