# -*- coding: utf-8 -*-
import os
import ee
from pymongo import MongoClient
from google.oauth2 import service_account

MONGO_URL = os.getenv('MONGO_URL')

# Inicializa o Earth Engine utilizando uma Service Account
def initialize_gee_with_service_account(private_key_file):
    """
    Inicializa o Google Earth Engine usando um arquivo de chave privada de Service Account.
    """
    try:
        service_account_file = private_key_file
        print("Inicializando a service account {}".format(service_account_file))
        credentials = service_account.Credentials.from_service_account_file(
            service_account_file,
            scopes=["https://www.googleapis.com/auth/earthengine.readonly"],
        )
        ee.Initialize(credentials)
        print("GEE inicializado com sucesso.")
    except Exception as e:
        raise Exception(status_code=500, detail="Falha ao inicializar o GEE")



# Conexão com o MongoDB
client = MongoClient(MONGO_URL)
db = client.tvi
param_collection = db["mosaics_update_job"]   # Collection com os parâmetros
campaign_collection = db["campaign"]    # Collection onde a campanha será atualizada/inserida

# Função para determinar o satélite com base nas regras definidas, incluindo L9
def get_satellite(year, rules):
    if "L8" in rules and year >= rules["L8"].get("min_year", 2013):
        return "L8"
    elif "L7" in rules and rules["L7"].get("min_year") <= year <= rules["L7"].get("max_year"):
        return "L7"
    elif "L5" in rules and rules["L5"].get("default", False):
        return "L5"
    return "Unknown"

# Verifica se há documentos com "tipo_job": "mosaic_pantanal"
if param_collection.count_documents({"tipo_job": "mosaic_pantanal"}) == 0:
    raise Exception("Nenhum documento encontrado para 'tipo_job': 'mosaic_pantanal'.")

# Itera sobre todos os documentos que correspondem ao tipo de job
for param in param_collection.find({"tipo_job": "mosaic_pantanal"}):
    # Verifica se o job está ativo
    job_active = param.get("job_active", False)
    if not job_active:
        print("Job não ativo para o documento {}. Pulando.".format(param.get('_id')))
        continue

    # Extrai os parâmetros do documento
    campaign_id    = param.get("campaign_id")
    collection_id  = param.get("collection_id")
    biome          = param.get("biome")
    start_year     = param.get("start_year")
    end_year       = param.get("end_year")
    bands          = param.get("bands")
    gain           = param.get("gain")
    gamma          = param.get("gamma")
    suffixes       = param.get("suffixes", ["DRY", "WET"])
    satellite_rules = param.get("satellite_rules")

    initialize_gee_with_service_account(param.get("ee_key_path"))

    # Dicionário para armazenar as URLs customizadas
    customURLs = {}

    # Itera pelos anos definidos
    for year in range(start_year, end_year + 1):
        # Cria o filtro na coleção do Earth Engine conforme os
        mosaic = ee.ImageCollection(collection_id).filterMetadata('biome', 'equals', biome).filterMetadata('year', 'equals', year)

        # Define os parâmetros de visualização
        map_params = {
            'bands': bands,
            'gain': gain,
            'gamma': gamma
        }

        # Executa a função getMap e recupera a URL formatada
        map_dict = mosaic.getMapId(map_params)
        url = map_dict['tile_fetcher'].url_format

        # Determina o satélite para o ano
        satellite = get_satellite(year, satellite_rules)

        url = url.replace("{z}", "${z}").replace("{x}", "${x}").replace("{y}", "${y}")

        # Para cada sufixo (por exemplo, DRY e WET), cria a chave e armazena a URL
        for suffix in suffixes:
            key = "{}_{}_{}".format(satellite, year, suffix)
            customURLs[key] = url

    # Atualiza (ou insere) o documento na collection "campaign" usando o campaign_id
    campaign_collection.update_one(
        {"_id": campaign_id},
        {"$set": {"customURLs": customURLs}},
        upsert=True
    )
