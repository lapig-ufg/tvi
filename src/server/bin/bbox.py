#!/usr/bin/env python3
"""
Gera um BBOX (minX,minY,maxX,maxY) a partir de um ponto, aplicando
buffer em metros com projeção UTM adequada à coordenada.

Suporta:
  • WMS 1.1.0  (SRS=..., ordem lon,lat)
  • WMS 1.3.0  (CRS=EPSG:4326, ordem lat,lon)
"""

import argparse
from pyproj import Transformer, CRS
from shapely.geometry import Point

# ----------------------------------------------------------------------
# Utilidades
# ----------------------------------------------------------------------

def get_utm_crs(lat: float, lon: float) -> str:
    """Retorna o EPSG da zona UTM correspondente ao ponto."""
    zone = int((lon + 180) / 6) + 1
    return f"EPSG:{32600 + zone if lat >= 0 else 32700 + zone}"

def parse_args():
    p = argparse.ArgumentParser(
        description="Cria BBOX com buffer métrico (UTM dinâmico).",
        epilog="Ex.: bbox.py --lon -48.9 --lat -7.6 --size 4000"
    )
    p.add_argument("--lon", type=float, required=True, help="Longitude (graus)")
    p.add_argument("--lat", type=float, required=True, help="Latitude (graus)")
    p.add_argument("--size", type=float, default=4000, help="Raio do buffer em metros")
    p.add_argument("--crs_to", default="EPSG:900913", help="CRS de saída (ex.: EPSG:4326, EPSG:900913)")
    p.add_argument("--wms_version", choices=["1.1.0", "1.3.0"], default="1.1.0",
                   help="Versão WMS alvo (default 1.1.0)")
    p.add_argument("--round", type=int, default=6, help="Casas decimais na saída")
    p.add_argument("--pretty", action="store_true", help="Exibe bbox rotulado")
    return p.parse_args()

def format_bbox(bounds, wms_ver, crs_to, digits, pretty):
    minx, miny, maxx, maxy = bounds

    # Inverte ordem para WMS 1.3.0 + EPSG:4326 (lat,lon)
    if wms_ver == "1.3.0" and crs_to.upper() == "EPSG:4326":
        bounds = (miny, minx, maxy, maxx)

    fmt = f"{{:.{digits}f}}"
    coords = [fmt.format(v) for v in bounds]

    if pretty:
        lbl = ["minX", "minY", "maxX", "maxY"]
        if wms_ver == "1.3.0" and crs_to.upper() == "EPSG:4326":
            lbl = ["minLat", "minLon", "maxLat", "maxLon"]
        return "\n".join(f"{l}: {c}" for l, c in zip(lbl, coords))
    return ",".join(coords)

# ----------------------------------------------------------------------
# Execução principal
# ----------------------------------------------------------------------

def main():
    a = parse_args()
    try:
        # 1) Define CRS métrico UTM dinâmico
        utm_crs = get_utm_crs(a.lat, a.lon)

        # 2) Ponto -> UTM
        to_utm = Transformer.from_crs("EPSG:4326", utm_crs, always_xy=True)
        ux, uy = to_utm.transform(a.lon, a.lat)

        # 3) Buffer e bounds em metros
        minx, miny, maxx, maxy = Point(ux, uy).buffer(a.size).bounds

        # 4) Converte bounds p/ crs_to, se necessário
        if a.crs_to.upper() != utm_crs:
            to_out = Transformer.from_crs(utm_crs, a.crs_to, always_xy=True)
            minx, miny = to_out.transform(minx, miny)
            maxx, maxy = to_out.transform(maxx, maxy)

        # 5) Imprime resultado
        print(format_bbox((minx, miny, maxx, maxy), a.wms_version,
                          a.crs_to, a.round, a.pretty))

    except Exception as e:
        print("Erro:", e)

if __name__ == "__main__":
    main()
