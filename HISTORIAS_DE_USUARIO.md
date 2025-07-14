# Histórias de Usuário - TVI (Temporal Visual Inspection) - Sistema Aprimorado

## Épico 1: Autenticação e Gestão de Usuários com SSO

### História 1.1: Integração com Keycloak SSO
**Como** administrador do sistema  
**Quero** integrar o sistema com Keycloak para autenticação SSO  
**Para** centralizar o gerenciamento de usuários e facilitar o acesso

**Critérios de Aceitação:**
- Sistema deve autenticar usuários via Keycloak OAuth2/OIDC
- Deve importar automaticamente dados do usuário: nome, email, ID único
- Deve sincronizar roles/grupos do Keycloak com permissões do sistema
- Deve manter sessão sincronizada com token do Keycloak
- Deve implementar refresh token para renovação automática
- Deve permitir logout global (SSO logout)
- Primeira vez que usuário acessa, deve criar perfil local com dados do Keycloak

### História 1.2: Perfil de Usuário Local
**Como** usuário autenticado via SSO  
**Quero** ter um perfil local no sistema  
**Para** gerenciar minhas preferências e campanhas

**Critérios de Aceitação:**
- Sistema deve criar perfil local na primeira autenticação
- Perfil deve incluir: ID Keycloak, nome, email, data de criação
- Deve rastrear: campanhas criadas, campanhas como intérprete, última atividade
- Deve permitir configurar preferências de notificação
- Deve mostrar histórico de atividades do usuário
- Deve permitir upload de avatar/foto do perfil

### História 1.3: Gerenciamento de Permissões
**Como** sistema  
**Quero** gerenciar diferentes níveis de permissão  
**Para** controlar acesso às funcionalidades

**Critérios de Aceitação:**
- Deve ter 4 níveis de permissão:
  - **Super Admin**: acesso total ao sistema
  - **Criador de Campanha**: pode criar e gerenciar suas campanhas
  - **Intérprete**: pode apenas inspecionar pontos atribuídos
  - **Visualizador**: pode apenas ver relatórios públicos
- Criador de campanha tem permissão total sobre suas campanhas
- Intérpretes só acessam campanhas onde foram designados
- Sistema deve validar permissões em todas as operações

## Épico 2: Criação Autônoma de Campanhas

### História 2.1: Interface de Criação de Campanha
**Como** usuário com permissão de criador  
**Quero** criar minhas próprias campanhas através de interface web  
**Para** ter autonomia na configuração de projetos de inspeção

**Critérios de Aceitação:**
- Interface deve ter wizard/stepper com as etapas:
  1. Informações básicas
  2. Configuração temporal
  3. Região de interesse
  4. Cadastro de imagens
  5. Classes de uso do solo
  6. Seleção de intérpretes
  7. Revisão e confirmação
- Deve permitir salvar rascunho em qualquer etapa
- Deve validar cada etapa antes de prosseguir
- Deve mostrar preview da configuração final
- Criador automaticamente se torna administrador da campanha

### História 2.2: Configuração de Informações Básicas
**Como** criador de campanha  
**Quero** definir informações básicas da campanha  
**Para** identificar e descrever o projeto

**Critérios de Aceitação:**
- Campos obrigatórios:
  - Nome da campanha (único no sistema)
  - Descrição detalhada (mínimo 50 caracteres)
  - Objetivo da inspeção
  - Número de intérpretes por ponto (mínimo 2, máximo configurável)
  - Tags/categorias para organização
- Campos opcionais:
  - Instituição/projeto relacionado
  - Links para documentação externa
  - Observações especiais
- Sistema deve gerar ID único automaticamente
- Deve validar unicidade do nome

### História 2.3: Configuração de Período Temporal
**Como** criador de campanha  
**Quero** configurar o período e intervalos temporais  
**Para** definir a grade temporal de inspeção

**Critérios de Aceitação:**
- Deve definir:
  - Data/hora de início (datetime)
  - Data/hora de fim (datetime)
  - Tipo de período: diário, semanal, mensal, semestral, anual, sazonal
- Para período sazonal, deve configurar:
  - Meses da estação seca
  - Meses da estação chuvosa
- Sistema deve calcular e mostrar preview da grade temporal:
  - Total de intervalos gerados
  - Lista de datas/períodos
- Deve validar:
  - Data fim > data início
  - Período mínimo de 1 mês
  - Máximo de intervalos configurável (ex: 500)
- Deve permitir excluir intervalos específicos manualmente

### História 2.4: Upload e Configuração de Região de Interesse
**Como** criador de campanha  
**Quero** fazer upload de arquivos geoespaciais com pontos de inspeção  
**Para** definir onde as inspeções serão realizadas

**Critérios de Aceitação:**
- Deve aceitar formatos:
  - Shapefile (.shp em arquivo .zip com todos componentes)
  - GeoJSON (.geojson ou .json)
  - GeoPackage (.gpkg)
- Deve validar:
  - Arquivo contém geometrias válidas
  - Sistema de coordenadas (aceitar múltiplos, converter para WGS84)
  - Tamanho máximo do arquivo (configurável, padrão 100MB)
- Deve extrair e armazenar:
  - Todas as geometrias (pontos, polígonos)
  - Todas as propriedades/atributos
  - Metadados: nome original, CRS original, número de features
- Interface deve mostrar:
  - Preview no mapa das geometrias carregadas
  - Tabela com propriedades
  - Estatísticas: total de pontos, extensão espacial
- Deve permitir:
  - Selecionar quais propriedades exibir durante inspeção
  - Definir propriedade como identificador único
  - Filtrar pontos por propriedades

### História 2.5: Aleatorização da Ordem de Inspeção
**Como** criador de campanha  
**Quero** aleatorizar a ordem dos pontos de inspeção  
**Para** evitar viés de sequência na interpretação

**Critérios de Aceitação:**
- Deve ter botão "Aleatorizar Ordem"
- Sistema deve:
  - Gerar ordem aleatória para todos os pontos
  - Atribuir índice de ordenação a cada ponto
  - Permitir visualizar ordem no mapa (numeração)
- Deve permitir:
  - Gerar nova aleatorização
  - Manter ordem original
  - Definir semente (seed) para reprodutibilidade
- Ordem deve ser fixa após início das inspeções

## Épico 3: Cadastro e Configuração de Fontes de Imagem

### História 3.1: Cadastro de Imagens do Google Earth Engine
**Como** criador de campanha  
**Quero** configurar coleções de imagens do Earth Engine  
**Para** usar como base visual nas inspeções

**Critérios de Aceitação:**
- Interface deve permitir:
  - Selecionar coleção (dropdown com coleções disponíveis)
  - Definir nome amigável para a fonte
  - Configurar todos os parâmetros da API Python do EE:
    - **Filtros temporais**: dateStart, dateEnd
    - **Filtros espaciais**: bounds, região
    - **Filtros de metadados**: cloudCover, dayOfYear, etc.
    - **Seleção de bandas**: listar e selecionar bandas
    - **Operações**: median, mean, max, min, mosaic, qualityMosaic
    - **Máscaras**: cloudMask, shadowMask, waterMask
- Parâmetros de visualização:
  - **Bandas RGB**: seleção e ordem
  - **Min/Max**: valores para cada banda
  - **Gamma**: correção gamma
  - **Paleta**: para visualizações single-band
  - **Gain/Bias**: ajuste linear
- Deve permitir:
  - Testar configuração com preview
  - Salvar múltiplas configurações por campanha
  - Duplicar configuração existente
  - Importar/exportar configuração JSON

### História 3.2: Processamento Avançado Earth Engine
**Como** criador de campanha  
**Quero** configurar processamentos complexos no Earth Engine  
**Para** criar visualizações customizadas

**Critérios de Aceitação:**
- Deve suportar índices espectrais:
  - NDVI, EVI, SAVI, NDWI, NDBI, etc.
  - Fórmula customizada com bandas
- Deve permitir operações de coleção:
  - Filtros por propriedades de imagem
  - Redutores temporais (percentis, desvio padrão)
  - Composições sazonais
- Deve suportar algoritmos:
  - PCA (Principal Component Analysis)
  - Tasseled Cap
  - Spectral unmixing
- Interface deve:
  - Validar sintaxe de expressões
  - Mostrar preview do resultado
  - Estimar tempo de processamento
  - Salvar snippets reutilizáveis

### História 3.3: Cadastro de Serviços WMS
**Como** criador de campanha  
**Quero** adicionar serviços WMS externos  
**Para** incluir fontes de imagem adicionais

**Critérios de Aceitação:**
- Formulário deve incluir:
  - URL base do serviço WMS
  - Versão WMS (1.1.1, 1.3.0)
  - Camadas (layers) disponíveis
  - Estilos disponíveis
  - Sistema de coordenadas (CRS)
  - Formato de imagem (PNG, JPEG)
  - Transparência (true/false)
- Deve permitir:
  - Testar conexão GetCapabilities
  - Listar camadas automaticamente
  - Configurar parâmetros adicionais
  - Autenticação básica se necessário
- Deve validar:
  - URL acessível
  - Camadas existem
  - CRS suportado

### História 3.4: Cadastro de Tiles XYZ
**Como** criador de campanha  
**Quero** adicionar serviços de tiles XYZ  
**Para** usar mapas base rápidos

**Critérios de Aceitação:**
- Deve configurar:
  - Template de URL com {x}, {y}, {z}
  - Níveis de zoom mínimo e máximo
  - Atribuição/créditos
  - Subdomínios (se aplicável)
- Templates pré-configurados para:
  - OpenStreetMap
  - Google Maps (com API key)
  - Bing Maps (com API key)
  - Mapbox (com token)
  - ESRI basemaps
- Deve permitir:
  - Testar tile específico
  - Preview em diferentes zooms
  - Cache local de tiles

### História 3.5: Gerenciamento de Múltiplas Fontes
**Como** criador de campanha  
**Quero** gerenciar múltiplas fontes de imagem  
**Para** comparar diferentes visualizações

**Critérios de Aceitação:**
- Deve permitir:
  - Adicionar ilimitadas fontes
  - Ordenar fontes (ordem de exibição)
  - Ativar/desativar fontes
  - Definir fonte padrão
  - Agrupar fontes por categoria
- Para cada fonte:
  - Nome descritivo
  - Tipo (GEE, WMS, XYZ)
  - Período de disponibilidade
  - Resolução espacial
  - Descrição/notas
- Interface deve mostrar:
  - Lista de todas as fontes
  - Status de cada fonte
  - Preview lado a lado

## Épico 4: Seleção e Gestão de Intérpretes

### História 4.1: Seleção de Intérpretes para Campanha
**Como** administrador de campanha  
**Quero** selecionar usuários como intérpretes  
**Para** definir quem realizará as inspeções

**Critérios de Aceitação:**
- Interface deve mostrar:
  - Lista de todos usuários disponíveis
  - Busca por nome/email
  - Filtros por experiência/qualificação
- Para cada usuário mostrar:
  - Nome e email
  - Número de campanhas participadas
  - Taxa média de concordância histórica
  - Disponibilidade atual
- Seleção deve:
  - Respeitar limite configurado de intérpretes
  - Permitir selecionar/remover em lote
  - Enviar convite por email aos selecionados
- Intérpretes devem aceitar convite para confirmar

### História 4.2: Dashboard do Intérprete
**Como** intérprete selecionado  
**Quero** ver minhas campanhas ativas  
**Para** gerenciar meu trabalho

**Critérios de Aceitação:**
- Dashboard deve mostrar:
  - Lista de campanhas onde sou intérprete
  - Status de cada campanha (ativa, pausada, finalizada)
  - Meu progresso em cada campanha
  - Prazo estimado
  - Próximas ações requeridas
- Para cada campanha:
  - Total de pontos atribuídos
  - Pontos completados
  - Tempo médio por ponto
  - Taxa de concordância
- Deve permitir:
  - Acessar campanha diretamente
  - Ver instruções específicas
  - Reportar problemas

### História 4.3: Gestão de Intérpretes pelo Administrador
**Como** administrador de campanha  
**Quero** gerenciar intérpretes durante a campanha  
**Para** garantir qualidade e progresso

**Critérios de Aceitação:**
- Deve permitir:
  - Adicionar novos intérpretes após início
  - Remover intérpretes (com reatribuição de pontos)
  - Pausar intérprete temporariamente
  - Enviar mensagens aos intérpretes
- Dashboard deve mostrar:
  - Performance de cada intérprete
  - Tempo online/offline
  - Velocidade de inspeção
  - Taxa de concordância
  - Pontos problemáticos
- Alertas automáticos para:
  - Intérprete inativo há X dias
  - Taxa de concordância baixa
  - Velocidade anormal

## Épico 5: Processo de Inspeção Aprimorado

### História 5.1: Interface de Inspeção Modernizada
**Como** intérprete  
**Quero** uma interface intuitiva de inspeção  
**Para** trabalhar eficientemente

**Critérios de Aceitação:**
- Layout deve incluir:
  - Visualizador de mapas principal
  - Timeline temporal interativa
  - Painel de classificação
  - Informações do ponto
  - Ferramentas de análise
- Funcionalidades do mapa:
  - Zoom suave com scroll
  - Pan com drag
  - Medição de distâncias
  - Desenho de anotações
  - Screenshot da área
- Timeline deve:
  - Mostrar todos os períodos configurados
  - Permitir navegação rápida
  - Indicar períodos já classificados
  - Sincronizar com mapa

### História 5.2: Visualização de Propriedades dos Pontos
**Como** intérprete  
**Quero** ver as propriedades dos pontos durante inspeção  
**Para** ter contexto adicional na classificação

**Critérios de Aceitação:**
- Painel deve mostrar:
  - Todas propriedades configuradas pelo admin
  - Coordenadas do ponto
  - Identificador único
  - Metadados da geometria
- Propriedades devem ser:
  - Apresentadas em formato legível
  - Agrupadas por categoria (se configurado)
  - Pesquisáveis/filtráveis
  - Exportáveis
- Deve permitir:
  - Expandir/colapsar grupos
  - Copiar valores
  - Ver em tela cheia

### História 5.3: Comparação Multi-temporal
**Como** intérprete  
**Quero** comparar múltiplos períodos simultaneamente  
**Para** identificar mudanças com precisão

**Critérios de Aceitação:**
- Deve oferecer modos de visualização:
  - Lado a lado (2-4 períodos)
  - Swipe (deslizante)
  - Sobreposição com transparência
  - Animação temporal
- Sincronização entre visualizações:
  - Zoom sincronizado
  - Pan sincronizado
  - Cursor sincronizado
- Ferramentas de análise:
  - Diferença entre períodos
  - Destacar mudanças
  - Medir áreas alteradas

### História 5.4: Classificação Temporal Avançada
**Como** intérprete  
**Quero** classificar mudanças temporais detalhadamente  
**Para** documentar transições de uso do solo

**Critérios de Aceitação:**
- Sistema deve permitir:
  - Definir classe para cada período
  - Marcar período exato de mudança
  - Adicionar sub-classificações
  - Indicar certeza (alta, média, baixa)
- Para cada mudança:
  - Classe anterior
  - Classe posterior
  - Período/data da mudança
  - Tipo de transição
  - Observações
- Validações:
  - Pelo menos período inicial e final
  - Transições lógicas
  - Completude temporal

## Épico 6: Monitoramento e Relatórios Avançados

### História 6.1: Dashboard em Tempo Real
**Como** administrador de campanha  
**Quero** monitorar progresso em tempo real  
**Para** tomar decisões rápidas

**Critérios de Aceitação:**
- Dashboard deve atualizar automaticamente:
  - Número de intérpretes online
  - Pontos sendo inspecionados
  - Taxa de conclusão por hora
  - Estimativa de término
- Gráficos interativos:
  - Progresso temporal
  - Distribuição por intérprete
  - Heatmap de atividade
  - Taxa de concordância evolutiva
- Filtros dinâmicos:
  - Por período
  - Por intérprete
  - Por região
  - Por classe

### História 6.2: Relatórios Customizáveis
**Como** administrador de campanha  
**Quero** gerar relatórios customizados  
**Para** atender diferentes necessidades

**Critérios de Aceitação:**
- Templates de relatório:
  - Resumo executivo
  - Detalhamento técnico
  - Relatório por intérprete
  - Análise de qualidade
- Personalização:
  - Selecionar seções
  - Escolher métricas
  - Definir período
  - Adicionar logo/cabeçalho
- Formatos de exportação:
  - PDF com gráficos
  - Excel com dados brutos
  - CSV para análise
  - JSON para integração
- Agendamento:
  - Relatórios automáticos
  - Frequência configurável
  - Envio por email

### História 6.3: Analytics Avançados
**Como** administrador de campanha  
**Quero** análises estatísticas profundas  
**Para** entender padrões e melhorar processos

**Critérios de Aceitação:**
- Análises disponíveis:
  - Matriz de confusão entre intérpretes
  - Análise de concordância Kappa
  - Clusters de discordância
  - Padrões temporais de trabalho
  - Correlação com propriedades
- Machine Learning:
  - Predição de tempo necessário
  - Identificação de outliers
  - Sugestões de melhoria
  - Detecção de padrões
- Visualizações:
  - Mapas de calor
  - Gráficos 3D
  - Animações temporais
  - Dashboards interativos

## Épico 7: Gestão do Ciclo de Vida da Campanha

### História 7.1: Estados da Campanha
**Como** administrador de campanha  
**Quero** controlar o ciclo de vida da campanha  
**Para** gerenciar diferentes fases do projeto

**Critérios de Aceitação:**
- Estados disponíveis:
  - **Rascunho**: em configuração
  - **Revisão**: aguardando aprovação
  - **Ativa**: inspeções em andamento
  - **Pausada**: temporariamente suspensa
  - **Finalizada**: inspeções completas
  - **Arquivada**: dados preservados
- Transições permitidas:
  - Rascunho → Revisão → Ativa
  - Ativa ↔ Pausada
  - Ativa → Finalizada → Arquivada
- Cada transição deve:
  - Validar pré-condições
  - Notificar interessados
  - Registrar em log
  - Permitir comentário

### História 7.2: Clonagem de Campanhas
**Como** criador de campanha  
**Quero** clonar campanhas existentes  
**Para** reaproveitar configurações

**Critérios de Aceitação:**
- Deve permitir clonar:
  - Configurações completas
  - Apenas estrutura (sem dados)
  - Seletivamente componentes
- Ao clonar deve:
  - Gerar novo ID
  - Resetar intérpretes
  - Limpar inspeções
  - Manter referência à original
- Opções de clonagem:
  - Mesma região ou nova
  - Mesmo período ou novo
  - Mesmas fontes ou revisar
  - Mesmas classes ou editar

### História 7.3: Arquivamento e Backup
**Como** administrador de campanha  
**Quero** arquivar campanhas finalizadas  
**Para** liberar recursos mantendo dados

**Critérios de Aceitação:**
- Processo de arquivamento:
  - Validar 100% inspeções completas
  - Gerar backup completo
  - Comprimir dados
  - Mover para storage frio
- Dados arquivados incluem:
  - Todas configurações
  - Todas inspeções
  - Logs de atividade
  - Arquivos uploaded
- Deve permitir:
  - Restaurar campanha
  - Consultar dados básicos
  - Exportar resultados
  - Manter por tempo configurado

## Épico 8: Integrações e API

### História 8.1: API REST para Integração
**Como** desenvolvedor externo  
**Quero** acessar dados via API  
**Para** integrar com outros sistemas

**Critérios de Aceitação:**
- Endpoints disponíveis:
  - Listar campanhas
  - Detalhes de campanha
  - Resultados de inspeção
  - Estatísticas
  - Webhook de eventos
- Autenticação:
  - OAuth2 via Keycloak
  - API Keys por aplicação
  - Rate limiting
  - Logs de acesso
- Documentação:
  - OpenAPI/Swagger
  - Exemplos de código
  - SDKs principais linguagens
  - Postman collection

### História 8.2: Notificações e Alertas
**Como** participante de campanha  
**Quero** receber notificações relevantes  
**Para** me manter informado

**Critérios de Aceitação:**
- Canais de notificação:
  - Email
  - Sistema (in-app)
  - Webhook
  - SMS (opcional)
- Tipos de notificação:
  - Convite para campanha
  - Campanha iniciada/pausada
  - Meta atingida
  - Problemas detectados
  - Relatórios prontos
- Configuração:
  - Por tipo de evento
  - Por canal
  - Frequência (imediato, resumo)
  - Horário preferencial

### História 8.3: Integração com Ferramentas de Análise
**Como** administrador de campanha  
**Quero** exportar para ferramentas especializadas  
**Para** análises avançadas

**Critérios de Aceitação:**
- Integrações diretas:
  - Google Earth Engine
  - QGIS (via WFS/WMS)
  - R (pacote dedicado)
  - Python (biblioteca)
  - PowerBI/Tableau
- Formatos de exportação:
  - GeoPackage com resultados
  - Shapefile com atributos
  - GeoJSON estruturado
  - COG (Cloud Optimized GeoTIFF)
- Deve incluir:
  - Metadados completos
  - Proveniência dos dados
  - Esquema documentado
  - Validação de integridade

## Notas de Implementação Técnica

### Arquitetura do Sistema:
1. **Frontend**: React/Next.js com Material-UI
2. **Backend**: Node.js/Express com TypeScript
3. **Banco de Dados**: PostgreSQL com PostGIS + MongoDB para dados não estruturados
4. **Cache**: Redis para sessões e cache de imagens
5. **Queue**: RabbitMQ para processamento assíncrono
6. **Storage**: S3-compatible para arquivos
7. **Autenticação**: Keycloak SSO

### Segurança:
- Todas comunicações via HTTPS
- Criptografia de dados sensíveis
- Audit log completo
- Backup automático diário
- Disaster recovery plan

### Performance:
- Lazy loading de imagens
- Paginação de resultados
- Cache multi-nível
- CDN para assets estáticos
- Compressão de dados

### Escalabilidade:
- Microserviços para componentes críticos
- Auto-scaling horizontal
- Load balancing
- Sharding de banco de dados
- Processamento distribuído
