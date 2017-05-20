import os;

directory = os.listdir('/home/jose/Documentos/Github/tvi/src/server/integration/py');

png = []

for file in directory:
	if file[-3:] == 'png':
		print file