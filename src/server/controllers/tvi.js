module.exports = function(app) {

	var TVI = {};

	TVI.test = function(request, response) {
		var data = [{
			ponto: 1,
			imagem: [{
				data: 2000,
				file: '/home/jose/Documentos/Github/tvi/src/client/assets/teste.jpg',
			},
			{
				data: 2001,
				file: '/home/jose/Documentos/Github/tvi/src/client/assets/teste.jpg',
			},
			{
				data: 2002,
				file: '/home/jose/Documentos/Github/tvi/src/client/assets/teste.jpg',
			},
			{
				data: 2003,
				file: '/home/jose/Documentos/Github/tvi/src/client/assets/teste.jpg',
			}]
		},{
			ponto: 2,
			imagem: [{
				data: 2000,
				file: '/home/jose/Documentos/Github/tvi/src/client/assets/teste.jpg',
			},
			{
				data: 2001,
				file: '/home/jose/Documentos/Github/tvi/src/client/assets/teste.jpg',
			},
			{
				data: 2002,
				file: '/home/jose/Documentos/Github/tvi/src/client/assets/teste.jpg',
			},
			{
				data: 2003,
				file: '/home/jose/Documentos/Github/tvi/src/client/assets/teste.jpg',
			}]
		}]

		response.send(data);
		response.end();
	};

	return TVI;

}