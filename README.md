# TVI - Temporal Visual Inspection

The increasing number of sensors orbiting the earth is systematically producing larger volumes of data, which can be combined to produce more consistent satellite time series. In this study we present the Brazil Landsat-LikeData Cube, an initiative with the goal of compiling monthly observations, since 2000, compatible with the Landsat 8-OLI grid-cell (i.e. 30m), in order to produce consistent time series of biophysical images for the entire Brazilian territory. Our implementation, in progress and open-source based, combines data from 13 satellites (and different sensors), using automatic approaches to reproject, resample and co-register the images. Considering as pilot area the Landsat scene 223/71, ~2.300 images were downloaded for the entire study period and an automatic Cbers image registration evaluation was conducted. Likewise, approaches regarding cloud/shadow screening and NDVI compositing have been defined. Our results indicates that the ongoing initiative is consistent, feasible, and has the potential to contribute with studies and products related to land cover and land use mapping, carbon estimations, and monitoring of degradation processes in natural and anthropic ecosystem.

[See the conference paper for more info](http://www.cartografia.org.br/cbc/2017/trabalhos/4/378.html)

![alt tag](https://raw.githubusercontent.com/lapig-ufg/tvi/master/docs/admin.png)

## Running:
 1. Start MongoDB
 ```
 mongod
 ```
 2. Start Server
 ```
 ./prod-start.sh
 ```

