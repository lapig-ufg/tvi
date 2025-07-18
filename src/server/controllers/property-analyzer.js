module.exports = function(app) {
    const PropertyAnalyzer = {};
    const logger = app.services.logger;

    // Analisar propriedades e determinar sua relevância
    PropertyAnalyzer.analyzeProperties = async (pointsCollection, campaignId, numInspec) => {
        try {
            // Buscar amostra de pontos
            const sampleSize = 1000;
            const samplePoints = await pointsCollection
                .find({ campaign: campaignId })
                .limit(sampleSize)
                .toArray();

            if (samplePoints.length === 0) {
                return {
                    relevantProperties: [],
                    categoricalProperties: [],
                    numericProperties: [],
                    temporalProperties: [],
                    geographicProperties: []
                };
            }

            // Coletar todas as propriedades e suas características
            const propertyStats = {};
            
            samplePoints.forEach(point => {
                // Analisar propriedades no nível raiz
                analyzeObjectProperties(point, '', propertyStats, false);
                
                // Analisar propriedades dentro de properties
                if (point.properties && typeof point.properties === 'object') {
                    analyzeObjectProperties(point.properties, 'properties.', propertyStats, true);
                }
            });

            // Calcular métricas de relevância
            const analyzedProperties = [];
            
            for (const [propName, stats] of Object.entries(propertyStats)) {
                const analysis = {
                    name: propName,
                    type: stats.type,
                    coverage: (stats.count / samplePoints.length) * 100,
                    uniqueValues: stats.uniqueValues.size,
                    uniqueRatio: stats.uniqueValues.size / stats.count,
                    examples: Array.from(stats.uniqueValues).slice(0, 5),
                    isCustom: stats.isCustom,
                    dataCategory: categorizeProperty(propName, stats),
                    relevanceScore: 0,
                    visualizationType: null,
                    statistics: {}
                };

                // Calcular estatísticas específicas por tipo
                if (stats.type === 'number') {
                    const values = Array.from(stats.numericValues);
                    analysis.statistics = {
                        min: Math.min(...values),
                        max: Math.max(...values),
                        mean: values.reduce((a, b) => a + b, 0) / values.length,
                        median: calculateMedian(values),
                        stdDev: calculateStdDev(values)
                    };
                }

                // Calcular score de relevância
                analysis.relevanceScore = calculateRelevanceScore(analysis, stats);
                
                // Determinar tipo de visualização apropriado
                analysis.visualizationType = determineVisualizationType(analysis, stats);

                analyzedProperties.push(analysis);
            }

            // Ordenar por relevância
            analyzedProperties.sort((a, b) => b.relevanceScore - a.relevanceScore);

            // Categorizar propriedades
            const categorized = {
                relevantProperties: analyzedProperties.filter(p => p.relevanceScore >= 0.5),
                categoricalProperties: analyzedProperties.filter(p => 
                    p.dataCategory === 'categorical' && p.relevanceScore >= 0.5
                ),
                numericProperties: analyzedProperties.filter(p => 
                    p.dataCategory === 'numeric' && p.relevanceScore >= 0.5
                ),
                temporalProperties: analyzedProperties.filter(p => 
                    p.dataCategory === 'temporal' && p.relevanceScore >= 0.5
                ),
                geographicProperties: analyzedProperties.filter(p => 
                    p.dataCategory === 'geographic' && p.relevanceScore >= 0.5
                ),
                textProperties: analyzedProperties.filter(p => 
                    p.dataCategory === 'text' && p.relevanceScore >= 0.5
                ),
                allProperties: analyzedProperties
            };

            // Gerar recomendações de visualização
            categorized.visualizationRecommendations = generateVisualizationRecommendations(
                categorized, 
                samplePoints.length,
                numInspec
            );

            return categorized;

        } catch (error) {
            await logger.error('Error analyzing properties', {
                module: 'propertyAnalyzer',
                function: 'analyzeProperties',
                metadata: { error: error.message, campaignId }
            });
            throw error;
        }
    };

    // Analisar propriedades de um objeto
    function analyzeObjectProperties(obj, prefix, propertyStats, isCustom) {
        const skipFields = ['_id', 'campaign', 'userName', 'inspection', 'dateImport', 
                           'underInspection', 'index', 'cached', 'enhance_in_cache'];

        Object.entries(obj).forEach(([key, value]) => {
            if (skipFields.includes(key) || key.startsWith('_')) return;
            if (value === null || value === undefined) return;

            const fullKey = prefix + key;
            
            if (!propertyStats[fullKey]) {
                propertyStats[fullKey] = {
                    type: typeof value,
                    count: 0,
                    uniqueValues: new Set(),
                    numericValues: [],
                    isCustom: isCustom,
                    patterns: {
                        isDate: false,
                        isCoordinate: false,
                        isClassification: false,
                        isIdentifier: false,
                        isUrl: false,
                        isEmail: false
                    }
                };
            }

            propertyStats[fullKey].count++;
            
            // Handle arrays - store the array type and sample values
            let actualValue = value;
            let actualType = typeof value;
            
            if (Array.isArray(value)) {
                actualType = 'array';
                if (value.length > 0) {
                    // Check the type of array elements
                    const firstElement = value[0];
                    if (typeof firstElement === 'string') {
                        actualType = 'array-string';
                    } else if (typeof firstElement === 'number') {
                        actualType = 'array-number';
                    }
                    actualValue = value; // Store the whole array for categorical analysis
                }
            }
            
            // Update type if needed
            if (propertyStats[fullKey].type === 'object' && actualType !== 'object') {
                propertyStats[fullKey].type = actualType;
            }
            
            // Coletar valores únicos (limitar para performance)
            if (propertyStats[fullKey].uniqueValues.size < 1000) {
                if (Array.isArray(actualValue)) {
                    // For arrays, store as JSON string to compare uniqueness
                    propertyStats[fullKey].uniqueValues.add(JSON.stringify(actualValue));
                } else {
                    propertyStats[fullKey].uniqueValues.add(actualValue);
                }
            }

            // Para números, coletar valores
            if (typeof value === 'number' && !isNaN(value)) {
                propertyStats[fullKey].numericValues.push(value);
            }

            // Detectar padrões
            detectPatterns(fullKey, value, propertyStats[fullKey].patterns);
        });
    }

    // Detectar padrões nos dados
    function detectPatterns(key, value, patterns) {
        const keyLower = key.toLowerCase();
        
        // Handle array values by checking the first element
        let valueToCheck = value;
        if (Array.isArray(value) && value.length > 0) {
            valueToCheck = value[0];
        }
        
        const valueStr = String(valueToCheck);

        // Padrões de data
        if (keyLower.includes('date') || keyLower.includes('data') || 
            keyLower.includes('time') || keyLower.includes('tempo')) {
            patterns.isDate = true;
        } else if (/^\d{4}-\d{2}-\d{2}/.test(valueStr) || 
                   /^\d{2}\/\d{2}\/\d{4}/.test(valueStr)) {
            patterns.isDate = true;
        }

        // Padrões de coordenadas
        if (keyLower.includes('lat') || keyLower.includes('lon') || 
            keyLower.includes('coord') || keyLower.includes('x') || keyLower.includes('y')) {
            patterns.isCoordinate = true;
        } else if (typeof value === 'number' && value >= -180 && value <= 180) {
            patterns.isCoordinate = true;
        }

        // Padrões de classificação
        if (keyLower.includes('class') || keyLower.includes('tipo') || 
            keyLower.includes('category') || keyLower.includes('group') ||
            keyLower.includes('status') || keyLower.includes('state')) {
            patterns.isClassification = true;
        }

        // Padrões de identificadores
        if (keyLower.includes('id') || keyLower.includes('code') || 
            keyLower.includes('number') || keyLower.includes('ref')) {
            patterns.isIdentifier = true;
        }

        // URLs
        if (/^https?:\/\//.test(valueStr)) {
            patterns.isUrl = true;
        }

        // Emails
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valueStr)) {
            patterns.isEmail = true;
        }
    }

    // Categorizar propriedade
    function categorizeProperty(propName, stats) {
        const keyLower = propName.toLowerCase();
        
        // Check for classification patterns first
        if (stats.patterns.isClassification || 
            keyLower.includes('class') || keyLower.includes('consolidated') ||
            keyLower.includes('type') || keyLower.includes('category')) {
            // If it's an array of strings, it's likely categorical
            if (stats.type === 'array-string') {
                return 'categorical';
            }
        }
        
        // Temporal
        if (stats.patterns.isDate || 
            keyLower.includes('year') || keyLower.includes('ano') ||
            keyLower.includes('month') || keyLower.includes('mes')) {
            return 'temporal';
        }
        
        // Geographic
        if (stats.patterns.isCoordinate ||
            keyLower.includes('municipio') || keyLower.includes('city') ||
            keyLower.includes('estado') || keyLower.includes('state') ||
            keyLower.includes('regiao') || keyLower.includes('region') ||
            keyLower.includes('bairro') || keyLower.includes('distrito')) {
            return 'geographic';
        }
        
        // Numeric
        if (stats.type === 'number') {
            return 'numeric';
        }
        
        // Categorical - including arrays of strings
        if ((stats.type === 'string' || stats.type === 'array-string') && 
            stats.uniqueValues.size < 50 && 
            stats.count > 10 && 
            (stats.uniqueValues.size / stats.count) < 0.3) {
            return 'categorical';
        }
        
        // Text
        return 'text';
    }

    // Calcular score de relevância
    function calculateRelevanceScore(analysis, stats) {
        let score = 0;
        
        // Coverage (0-40 pontos)
        score += (analysis.coverage / 100) * 40;
        
        // Categoria apropriada (0-20 pontos)
        if (['categorical', 'numeric', 'temporal', 'geographic'].includes(analysis.dataCategory)) {
            score += 20;
        }
        
        // Variabilidade apropriada (0-20 pontos)
        if (analysis.dataCategory === 'categorical') {
            // Para categóricos: nem muito poucos nem muitos valores únicos
            if (analysis.uniqueValues >= 2 && analysis.uniqueValues <= 30) {
                score += 20;
            } else if (analysis.uniqueValues > 30 && analysis.uniqueValues <= 100) {
                score += 10;
            }
        } else if (analysis.dataCategory === 'numeric') {
            // Para numéricos: boa variabilidade
            if (stats.statistics && stats.statistics.stdDev > 0) {
                score += 20;
            }
        }
        
        // Padrões detectados (0-20 pontos)
        const patternCount = Object.values(stats.patterns).filter(v => v).length;
        score += Math.min(patternCount * 10, 20);
        
        // Normalizar para 0-1
        return score / 100;
    }

    // Determinar tipo de visualização
    function determineVisualizationType(analysis, stats) {
        switch (analysis.dataCategory) {
            case 'categorical':
                if (analysis.uniqueValues <= 10) {
                    return 'pie_chart';
                } else if (analysis.uniqueValues <= 30) {
                    return 'bar_chart';
                } else {
                    return 'treemap';
                }
                
            case 'numeric':
                if (stats.patterns.isCoordinate) {
                    return 'map';
                } else if (analysis.uniqueValues > 50) {
                    return 'histogram';
                } else {
                    return 'box_plot';
                }
                
            case 'temporal':
                return 'timeline';
                
            case 'geographic':
                if (analysis.uniqueValues <= 50) {
                    return 'choropleth_map';
                } else {
                    return 'heat_map';
                }
                
            default:
                return 'table';
        }
    }

    // Gerar recomendações de visualização
    function generateVisualizationRecommendations(categorized, totalPoints, numInspec) {
        const recommendations = [];
        
        // Recomendar gráfico principal de classificação
        const mainClassification = categorized.categoricalProperties[0];
        if (mainClassification) {
            recommendations.push({
                priority: 1,
                type: 'main_classification',
                property: mainClassification.name,
                visualization: mainClassification.visualizationType,
                title: `Distribuição por ${formatPropertyName(mainClassification.name)}`,
                description: `Principal campo de classificação com ${mainClassification.uniqueValues} categorias`
            });
        }
        
        // Recomendar análise temporal se disponível
        const temporalProp = categorized.temporalProperties[0];
        if (temporalProp) {
            recommendations.push({
                priority: 2,
                type: 'temporal_analysis',
                property: temporalProp.name,
                visualization: 'timeline',
                title: `Análise temporal por ${formatPropertyName(temporalProp.name)}`,
                description: 'Visualização da distribuição temporal dos dados'
            });
        }
        
        // Recomendar análise geográfica adicional
        const geoProps = categorized.geographicProperties.filter(p => 
            !['uf', 'biome', 'county'].includes(p.name)
        );
        if (geoProps.length > 0) {
            recommendations.push({
                priority: 3,
                type: 'geographic_analysis',
                property: geoProps[0].name,
                visualization: geoProps[0].visualizationType,
                title: `Distribuição geográfica por ${formatPropertyName(geoProps[0].name)}`,
                description: 'Análise espacial adicional dos dados'
            });
        }
        
        // Recomendar análise numérica
        const numericProp = categorized.numericProperties[0];
        if (numericProp) {
            recommendations.push({
                priority: 4,
                type: 'numeric_analysis',
                property: numericProp.name,
                visualization: numericProp.visualizationType,
                title: `Análise de ${formatPropertyName(numericProp.name)}`,
                description: `Distribuição numérica com valores entre ${numericProp.statistics.min} e ${numericProp.statistics.max}`
            });
        }
        
        // Análise cruzada se houver múltiplas propriedades categóricas
        if (categorized.categoricalProperties.length >= 2) {
            recommendations.push({
                priority: 5,
                type: 'cross_analysis',
                properties: [
                    categorized.categoricalProperties[0].name,
                    categorized.categoricalProperties[1].name
                ],
                visualization: 'heatmap',
                title: 'Análise cruzada de categorias',
                description: 'Correlação entre diferentes classificações'
            });
        }
        
        return recommendations;
    }

    // Funções auxiliares
    function calculateMedian(values) {
        const sorted = values.slice().sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }

    function calculateStdDev(values) {
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const squaredDiffs = values.map(value => Math.pow(value - mean, 2));
        const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
        return Math.sqrt(avgSquaredDiff);
    }

    function formatPropertyName(propName) {
        // Remove prefixo properties. se existir
        let name = propName.replace('properties.', '');
        
        // Converter snake_case ou camelCase para título
        name = name.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').trim();
        
        // Capitalizar primeira letra
        return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
    }

    return PropertyAnalyzer;
};