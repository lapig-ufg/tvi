# -*- coding: utf-8 -*-
import os
import click
import pandas as pd
from pathlib import Path
from loguru import logger
from multiprocessing import Pool
from pymongo import MongoClient
from datetime import timedelta, date

@click.command()
@click.option("--tb", help="CSV with Mapbiomas points")
@click.option("--ts", help="CSV with Timeseries NDVI TMWM")
@click.option("--cp", help="ID of campaign of TVI")
def main(tb, ts, cp):
    client = MongoClient('172.18.0.6', 27017)
    db = client.tvi
    
    def get_values(col):
        try:
            points_table = pd.read_pickle("./tb.pkl")  
            landsat_ndvi_series = pd.read_pickle("./ts.pkl")  
            ponto = points_table[(points_table['TARGETID'] == int(col.split('_')[1])) & (
                    points_table['CARTA_2'] == col.split('_')[0])][['LON', 'LAT']].iloc[0]

            tmp = landsat_ndvi_series[['Date', col]]
            tmp['Date'] = tmp['Date'].apply(to_date)
            tmp['lon'] = float(ponto['LON'])
            tmp['lat'] = float(ponto['LAT'])

            # tmp['campaign'] = cp
            # tmp['geom'] = {
            #     "type": "Point",
            #     "coordinates": [lon, lat]
            # }

            tmp = tmp.rename(
                columns={
                    col: 'value',
                    "Date": 'date'}).to_dict(
                orient="records")
            rows = []
            for item in tmp:
               
                item['date'] = item['date'].isoformat()
                item['index'] = 'ndvi-tmwm'
                item['campaign'] = cp
                rows.append(item)
            return db.timeseries.insert_many(rows)
        except Exception as e:
            logger.exception(e)


    def to_date(x):
        year, days = x.split('-')
        return date(int(year), 1, 1) + timedelta(days=int(days) - 1)

    try:
        points_table = pd.read_csv(Path(tb).resolve(), low_memory=False)
        landsat_ndvi_series = pd.read_csv(Path(ts).resolve(), low_memory=False)
        cp = cp

        points_table.to_pickle("./tb.pkl") 
        landsat_ndvi_series.to_pickle("./ts.pkl")

        with Pool(10) as works:
            result = works.map(get_values,landsat_ndvi_series.columns[1:])

    except Exception as e:
        logger.exception(e)


if __name__ == '__main__':
    main()
