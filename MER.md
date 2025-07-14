# TVI - Modelo Entidade-Relacionamento (MER)

## Índice

1. [Visão Geral do Modelo](#visão-geral-do-modelo)
2. [Esquema de Identidade e Acesso](#esquema-de-identidade-e-acesso)
3. [Esquema de Gestão de Campanhas](#esquema-de-gestão-de-campanhas)
4. [Esquema de Configuração de Imagens](#esquema-de-configuração-de-imagens)
5. [Esquema de Dados Geoespaciais](#esquema-de-dados-geoespaciais)
6. [Esquema de Inspeção](#esquema-de-inspeção)
7. [Esquema de Consolidação](#esquema-de-consolidação)
8. [Esquema de Analytics e Relatórios](#esquema-de-analytics-e-relatórios)
9. [Esquema de Notificações](#esquema-de-notificações)
10. [Esquema de Integração](#esquema-de-integração)
11. [Esquema de Auditoria](#esquema-de-auditoria)
12. [Índices e Otimizações](#índices-e-otimizações)

---

## Visão Geral do Modelo

O modelo de dados do TVI é dividido em schemas separados por domínio, facilitando a manutenção e permitindo diferentes estratégias de persistência. O modelo utiliza PostgreSQL como banco principal com extensão PostGIS para dados espaciais.

### Convenções Utilizadas:
- **PK**: Primary Key
- **FK**: Foreign Key
- **UK**: Unique Key
- **IDX**: Index
- **NN**: Not Null
- **DEFAULT**: Valor padrão
- **CHECK**: Constraint de validação

---

## Esquema de Identidade e Acesso

### Tabela: `auth.users`
```sql
CREATE TABLE auth.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    keycloak_id VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    avatar_url TEXT,
    role VARCHAR(50) NOT NULL CHECK (role IN ('super_admin', 'campaign_creator', 'interpreter', 'viewer')),
    preferences JSONB DEFAULT '{}',
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_email ON auth.users(email);
CREATE INDEX idx_users_keycloak_id ON auth.users(keycloak_id);
CREATE INDEX idx_users_role ON auth.users(role);
CREATE INDEX idx_users_status ON auth.users(status);
```

### Tabela: `auth.sessions`
```sql
CREATE TABLE auth.sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sessions_user_id ON auth.sessions(user_id);
CREATE INDEX idx_sessions_token ON auth.sessions(token);
CREATE INDEX idx_sessions_expires_at ON auth.sessions(expires_at);
```

### Tabela: `auth.permissions`
```sql
CREATE TABLE auth.permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resource VARCHAR(100) NOT NULL,
    action VARCHAR(50) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(resource, action)
);

CREATE INDEX idx_permissions_resource ON auth.permissions(resource);
```

### Tabela: `auth.role_permissions`
```sql
CREATE TABLE auth.role_permissions (
    role VARCHAR(50) NOT NULL,
    permission_id UUID NOT NULL REFERENCES auth.permissions(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (role, permission_id)
);

CREATE INDEX idx_role_permissions_role ON auth.role_permissions(role);
```

---

## Esquema de Gestão de Campanhas

### Tabela: `campaigns.campaigns`
```sql
CREATE TABLE campaigns.campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) UNIQUE NOT NULL,
    description TEXT NOT NULL CHECK (LENGTH(description) >= 50),
    owner_id UUID NOT NULL REFERENCES auth.users(id),
    status VARCHAR(20) NOT NULL DEFAULT 'draft' 
        CHECK (status IN ('draft', 'review', 'active', 'paused', 'finished', 'archived')),
    interpreters_per_point INTEGER NOT NULL CHECK (interpreters_per_point >= 2),
    tags TEXT[] DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP WITH TIME ZONE,
    finished_at TIMESTAMP WITH TIME ZONE,
    archived_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_campaigns_owner_id ON campaigns.campaigns(owner_id);
CREATE INDEX idx_campaigns_status ON campaigns.campaigns(status);
CREATE INDEX idx_campaigns_tags ON campaigns.campaigns USING GIN(tags);
CREATE INDEX idx_campaigns_created_at ON campaigns.campaigns(created_at);
```

### Tabela: `campaigns.temporal_configurations`
```sql
CREATE TABLE campaigns.temporal_configurations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID UNIQUE NOT NULL REFERENCES campaigns.campaigns(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    period_type VARCHAR(20) NOT NULL 
        CHECK (period_type IN ('daily', 'weekly', 'monthly', 'semester', 'annual', 'seasonal')),
    seasonal_config JSONB,
    excluded_periods JSONB DEFAULT '[]',
    generated_grid JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CHECK (end_date > start_date)
);

CREATE INDEX idx_temporal_campaign_id ON campaigns.temporal_configurations(campaign_id);
```

### Tabela: `campaigns.interpreters`
```sql
CREATE TABLE campaigns.interpreters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id),
    campaign_id UUID NOT NULL REFERENCES campaigns.campaigns(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'invited' 
        CHECK (status IN ('invited', 'accepted', 'active', 'paused', 'removed')),
    invited_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    accepted_at TIMESTAMP WITH TIME ZONE,
    removed_at TIMESTAMP WITH TIME ZONE,
    statistics JSONB DEFAULT '{}',
    UNIQUE(user_id, campaign_id)
);

CREATE INDEX idx_interpreters_user_id ON campaigns.interpreters(user_id);
CREATE INDEX idx_interpreters_campaign_id ON campaigns.interpreters(campaign_id);
CREATE INDEX idx_interpreters_status ON campaigns.interpreters(status);
```

### Tabela: `campaigns.land_use_classes`
```sql
CREATE TABLE campaigns.land_use_classes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns.campaigns(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    color VARCHAR(7) NOT NULL CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
    parent_id UUID REFERENCES campaigns.land_use_classes(id),
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(campaign_id, code)
);

CREATE INDEX idx_land_use_campaign_id ON campaigns.land_use_classes(campaign_id);
CREATE INDEX idx_land_use_parent_id ON campaigns.land_use_classes(parent_id);
```

### Tabela: `campaigns.campaign_transitions`
```sql
CREATE TABLE campaigns.campaign_transitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns.campaigns(id) ON DELETE CASCADE,
    from_status VARCHAR(20),
    to_status VARCHAR(20) NOT NULL,
    transitioned_by UUID NOT NULL REFERENCES auth.users(id),
    reason TEXT,
    transitioned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_transitions_campaign_id ON campaigns.campaign_transitions(campaign_id);
CREATE INDEX idx_transitions_transitioned_at ON campaigns.campaign_transitions(transitioned_at);
```

---

## Esquema de Configuração de Imagens

### Tabela: `images.image_sources`
```sql
CREATE TABLE images.image_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns.campaigns(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('earth_engine', 'wms', 'xyz')),
    enabled BOOLEAN DEFAULT true,
    order_index INTEGER NOT NULL DEFAULT 0,
    configuration JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_image_sources_campaign_id ON images.image_sources(campaign_id);
CREATE INDEX idx_image_sources_type ON images.image_sources(type);
CREATE INDEX idx_image_sources_enabled ON images.image_sources(enabled);
```

### Tabela: `images.earth_engine_configs`
```sql
CREATE TABLE images.earth_engine_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    image_source_id UUID UNIQUE NOT NULL REFERENCES images.image_sources(id) ON DELETE CASCADE,
    collection VARCHAR(255) NOT NULL,
    temporal_filter JSONB DEFAULT '{}',
    spatial_filter JSONB DEFAULT '{}',
    metadata_filter JSONB DEFAULT '{}',
    bands TEXT[] NOT NULL,
    reducer VARCHAR(20) CHECK (reducer IN ('median', 'mean', 'max', 'min', 'mosaic', 'qualityMosaic')),
    masks TEXT[] DEFAULT '{}',
    visualization_params JSONB NOT NULL,
    processing_script TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ee_configs_source_id ON images.earth_engine_configs(image_source_id);
CREATE INDEX idx_ee_configs_collection ON images.earth_engine_configs(collection);
```

### Tabela: `images.wms_configs`
```sql
CREATE TABLE images.wms_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    image_source_id UUID UNIQUE NOT NULL REFERENCES images.image_sources(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    version VARCHAR(10) NOT NULL CHECK (version IN ('1.1.1', '1.3.0')),
    layers TEXT[] NOT NULL,
    styles TEXT[],
    crs VARCHAR(50) NOT NULL DEFAULT 'EPSG:4326',
    format VARCHAR(20) NOT NULL DEFAULT 'image/png',
    transparent BOOLEAN DEFAULT true,
    auth_username VARCHAR(255),
    auth_password_encrypted TEXT,
    additional_params JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_wms_configs_source_id ON images.wms_configs(image_source_id);
```

### Tabela: `images.xyz_configs`
```sql
CREATE TABLE images.xyz_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    image_source_id UUID UNIQUE NOT NULL REFERENCES images.image_sources(id) ON DELETE CASCADE,
    url_template TEXT NOT NULL,
    min_zoom INTEGER DEFAULT 0,
    max_zoom INTEGER DEFAULT 20,
    attribution TEXT,
    subdomains TEXT[],
    api_key_encrypted TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_xyz_configs_source_id ON images.xyz_configs(image_source_id);
```

### Tabela: `images.spectral_indices`
```sql
CREATE TABLE images.spectral_indices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    image_source_id UUID NOT NULL REFERENCES images.image_sources(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    formula TEXT NOT NULL,
    bands TEXT[] NOT NULL,
    color_ramp TEXT[],
    value_range NUMRANGE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(image_source_id, name)
);

CREATE INDEX idx_spectral_indices_source_id ON images.spectral_indices(image_source_id);
```

---

## Esquema de Dados Geoespaciais

### Tabela: `spatial.datasets`
```sql
CREATE TABLE spatial.datasets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns.campaigns(id) ON DELETE CASCADE,
    original_filename VARCHAR(255) NOT NULL,
    format VARCHAR(20) NOT NULL CHECK (format IN ('shapefile', 'geojson', 'geopackage')),
    original_crs VARCHAR(50) NOT NULL,
    feature_count INTEGER NOT NULL,
    extent GEOMETRY(Polygon, 4326) NOT NULL,
    uploaded_by UUID NOT NULL REFERENCES auth.users(id),
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP WITH TIME ZONE,
    validation_result JSONB,
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_datasets_campaign_id ON spatial.datasets(campaign_id);
CREATE INDEX idx_datasets_uploaded_by ON spatial.datasets(uploaded_by);
CREATE SPATIAL INDEX idx_datasets_extent ON spatial.datasets USING GIST(extent);
```

### Tabela: `spatial.inspection_points`
```sql
CREATE TABLE spatial.inspection_points (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataset_id UUID NOT NULL REFERENCES spatial.datasets(id) ON DELETE CASCADE,
    campaign_id UUID NOT NULL REFERENCES campaigns.campaigns(id) ON DELETE CASCADE,
    geometry GEOMETRY(Point, 4326) NOT NULL,
    properties JSONB DEFAULT '{}',
    display_properties TEXT[] DEFAULT '{}',
    original_index INTEGER NOT NULL,
    inspection_order INTEGER NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' 
        CHECK (status IN ('pending', 'in_progress', 'completed')),
    under_inspection INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_points_dataset_id ON spatial.inspection_points(dataset_id);
CREATE INDEX idx_points_campaign_id ON spatial.inspection_points(campaign_id);
CREATE INDEX idx_points_status ON spatial.inspection_points(status);
CREATE INDEX idx_points_inspection_order ON spatial.inspection_points(inspection_order);
CREATE SPATIAL INDEX idx_points_geometry ON spatial.inspection_points USING GIST(geometry);
```

### Tabela: `spatial.geometry_validations`
```sql
CREATE TABLE spatial.geometry_validations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataset_id UUID UNIQUE NOT NULL REFERENCES spatial.datasets(id) ON DELETE CASCADE,
    is_valid BOOLEAN NOT NULL,
    errors JSONB DEFAULT '[]',
    warnings JSONB DEFAULT '[]',
    statistics JSONB NOT NULL,
    validated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_validations_dataset_id ON spatial.geometry_validations(dataset_id);
CREATE INDEX idx_validations_is_valid ON spatial.geometry_validations(is_valid);
```

---

## Esquema de Inspeção

### Tabela: `inspection.inspections`
```sql
CREATE TABLE inspection.inspections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    point_id UUID NOT NULL REFERENCES spatial.inspection_points(id),
    interpreter_id UUID NOT NULL REFERENCES auth.users(id),
    campaign_id UUID NOT NULL REFERENCES campaigns.campaigns(id),
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE,
    duration_seconds INTEGER,
    status VARCHAR(20) NOT NULL DEFAULT 'in_progress' 
        CHECK (status IN ('in_progress', 'completed', 'abandoned')),
    quality_metrics JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(point_id, interpreter_id)
);

CREATE INDEX idx_inspections_point_id ON inspection.inspections(point_id);
CREATE INDEX idx_inspections_interpreter_id ON inspection.inspections(interpreter_id);
CREATE INDEX idx_inspections_campaign_id ON inspection.inspections(campaign_id);
CREATE INDEX idx_inspections_status ON inspection.inspections(status);
CREATE INDEX idx_inspections_started_at ON inspection.inspections(started_at);
```

### Tabela: `inspection.temporal_classifications`
```sql
CREATE TABLE inspection.temporal_classifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inspection_id UUID NOT NULL REFERENCES inspection.inspections(id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    period_type VARCHAR(20) NOT NULL,
    land_use_class_id UUID NOT NULL REFERENCES campaigns.land_use_classes(id),
    confidence VARCHAR(10) NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
    is_border_pixel BOOLEAN DEFAULT false,
    observations TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_classifications_inspection_id ON inspection.temporal_classifications(inspection_id);
CREATE INDEX idx_classifications_class_id ON inspection.temporal_classifications(land_use_class_id);
CREATE INDEX idx_classifications_period ON inspection.temporal_classifications(period_start, period_end);
```

### Tabela: `inspection.assignments`
```sql
CREATE TABLE inspection.assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    point_id UUID NOT NULL REFERENCES spatial.inspection_points(id),
    interpreter_id UUID NOT NULL REFERENCES auth.users(id),
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active' 
        CHECK (status IN ('active', 'completed', 'expired')),
    UNIQUE(point_id, interpreter_id, status)
);

CREATE INDEX idx_assignments_point_id ON inspection.assignments(point_id);
CREATE INDEX idx_assignments_interpreter_id ON inspection.assignments(interpreter_id);
CREATE INDEX idx_assignments_status ON inspection.assignments(status);
CREATE INDEX idx_assignments_expires_at ON inspection.assignments(expires_at);
```

### Tabela: `inspection.inspection_metrics`
```sql
CREATE TABLE inspection.inspection_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inspection_id UUID UNIQUE NOT NULL REFERENCES inspection.inspections(id) ON DELETE CASCADE,
    viewed_images INTEGER DEFAULT 0,
    zoom_interactions INTEGER DEFAULT 0,
    pan_interactions INTEGER DEFAULT 0,
    tools_used TEXT[] DEFAULT '{}',
    revisited_periods INTEGER DEFAULT 0,
    total_interactions INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_metrics_inspection_id ON inspection.inspection_metrics(inspection_id);
```

---

## Esquema de Consolidação

### Tabela: `consolidation.consolidations`
```sql
CREATE TABLE consolidation.consolidations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    point_id UUID UNIQUE NOT NULL REFERENCES spatial.inspection_points(id),
    campaign_id UUID NOT NULL REFERENCES campaigns.campaigns(id),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' 
        CHECK (status IN ('pending', 'consolidated', 'conflicted', 'edited')),
    method VARCHAR(20) NOT NULL DEFAULT 'consensus' 
        CHECK (method IN ('consensus', 'manual')),
    consolidated_at TIMESTAMP WITH TIME ZONE,
    consolidated_by UUID REFERENCES auth.users(id),
    edit_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_consolidations_point_id ON consolidation.consolidations(point_id);
CREATE INDEX idx_consolidations_campaign_id ON consolidation.consolidations(campaign_id);
CREATE INDEX idx_consolidations_status ON consolidation.consolidations(status);
```

### Tabela: `consolidation.consolidated_classifications`
```sql
CREATE TABLE consolidation.consolidated_classifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consolidation_id UUID NOT NULL REFERENCES consolidation.consolidations(id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    period_type VARCHAR(20) NOT NULL,
    land_use_class_id UUID NOT NULL REFERENCES campaigns.land_use_classes(id),
    agreement_rate DECIMAL(5,2) NOT NULL CHECK (agreement_rate >= 0 AND agreement_rate <= 100),
    inspection_ids UUID[] NOT NULL,
    edited_by UUID REFERENCES auth.users(id),
    edit_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_consolidated_consolidation_id ON consolidation.consolidated_classifications(consolidation_id);
CREATE INDEX idx_consolidated_class_id ON consolidation.consolidated_classifications(land_use_class_id);
CREATE INDEX idx_consolidated_period ON consolidation.consolidated_classifications(period_start, period_end);
```

### Tabela: `consolidation.agreement_metrics`
```sql
CREATE TABLE consolidation.agreement_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    point_id UUID UNIQUE NOT NULL REFERENCES spatial.inspection_points(id),
    overall_agreement DECIMAL(5,2) NOT NULL,
    kappa_coefficient DECIMAL(5,4),
    per_period_agreement JSONB NOT NULL DEFAULT '[]',
    conflicted_periods JSONB DEFAULT '[]',
    calculated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_agreement_point_id ON consolidation.agreement_metrics(point_id);
CREATE INDEX idx_agreement_overall ON consolidation.agreement_metrics(overall_agreement);
```

---

## Esquema de Analytics e Relatórios

### Tabela: `analytics.dashboards`
```sql
CREATE TABLE analytics.dashboards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns.campaigns(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('campaign', 'interpreter', 'quality')),
    widgets JSONB NOT NULL DEFAULT '[]',
    filters JSONB DEFAULT '{}',
    refresh_interval INTEGER DEFAULT 60,
    created_by UUID NOT NULL REFERENCES auth.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_dashboards_campaign_id ON analytics.dashboards(campaign_id);
CREATE INDEX idx_dashboards_type ON analytics.dashboards(type);
CREATE INDEX idx_dashboards_created_by ON analytics.dashboards(created_by);
```

### Tabela: `analytics.reports`
```sql
CREATE TABLE analytics.reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns.campaigns(id),
    type VARCHAR(50) NOT NULL,
    generated_by UUID NOT NULL REFERENCES auth.users(id),
    generated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    parameters JSONB NOT NULL DEFAULT '{}',
    format VARCHAR(10) NOT NULL CHECK (format IN ('pdf', 'excel', 'csv', 'json')),
    status VARCHAR(20) NOT NULL DEFAULT 'generating' 
        CHECK (status IN ('generating', 'completed', 'failed')),
    file_url TEXT,
    error_message TEXT,
    expires_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_reports_campaign_id ON analytics.reports(campaign_id);
CREATE INDEX idx_reports_generated_by ON analytics.reports(generated_by);
CREATE INDEX idx_reports_status ON analytics.reports(status);
CREATE INDEX idx_reports_generated_at ON analytics.reports(generated_at);
```

### Tabela: `analytics.campaign_statistics`
```sql
CREATE TABLE analytics.campaign_statistics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID UNIQUE NOT NULL REFERENCES campaigns.campaigns(id) ON DELETE CASCADE,
    total_points INTEGER NOT NULL DEFAULT 0,
    completed_points INTEGER NOT NULL DEFAULT 0,
    in_progress_points INTEGER NOT NULL DEFAULT 0,
    average_time_per_point INTEGER,
    overall_agreement DECIMAL(5,2),
    interpreter_stats JSONB DEFAULT '{}',
    temporal_progress JSONB DEFAULT '[]',
    calculated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_statistics_campaign_id ON analytics.campaign_statistics(campaign_id);
CREATE INDEX idx_statistics_calculated_at ON analytics.campaign_statistics(calculated_at);
```

### Tabela: `analytics.quality_metrics`
```sql
CREATE TABLE analytics.quality_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns.campaigns(id) ON DELETE CASCADE,
    metric_date DATE NOT NULL,
    agreement_matrix JSONB,
    kappa_statistic DECIMAL(5,4),
    problematic_points JSONB DEFAULT '[]',
    outlier_inspections JSONB DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(campaign_id, metric_date)
);

CREATE INDEX idx_quality_campaign_id ON analytics.quality_metrics(campaign_id);
CREATE INDEX idx_quality_metric_date ON analytics.quality_metrics(metric_date);
```

---

## Esquema de Notificações

### Tabela: `notifications.notifications`
```sql
CREATE TABLE notifications.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_id UUID NOT NULL REFERENCES auth.users(id),
    type VARCHAR(50) NOT NULL,
    channel VARCHAR(20) NOT NULL CHECK (channel IN ('email', 'in_app', 'webhook', 'sms')),
    subject VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    status VARCHAR(20) NOT NULL DEFAULT 'pending' 
        CHECK (status IN ('pending', 'sent', 'delivered', 'failed')),
    scheduled_for TIMESTAMP WITH TIME ZONE,
    sent_at TIMESTAMP WITH TIME ZONE,
    delivered_at TIMESTAMP WITH TIME ZONE,
    failed_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_notifications_recipient_id ON notifications.notifications(recipient_id);
CREATE INDEX idx_notifications_type ON notifications.notifications(type);
CREATE INDEX idx_notifications_status ON notifications.notifications(status);
CREATE INDEX idx_notifications_scheduled_for ON notifications.notifications(scheduled_for);
CREATE INDEX idx_notifications_created_at ON notifications.notifications(created_at);
```

### Tabela: `notifications.preferences`
```sql
CREATE TABLE notifications.preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    channels JSONB NOT NULL DEFAULT '{"email": true, "in_app": true}',
    types JSONB NOT NULL DEFAULT '{}',
    frequency VARCHAR(20) NOT NULL DEFAULT 'immediate' 
        CHECK (frequency IN ('immediate', 'hourly', 'daily', 'weekly')),
    quiet_hours JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_preferences_user_id ON notifications.preferences(user_id);
```

### Tabela: `notifications.templates`
```sql
CREATE TABLE notifications.templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(50) UNIQUE NOT NULL,
    channel VARCHAR(20) NOT NULL,
    subject_template TEXT NOT NULL,
    body_template TEXT NOT NULL,
    variables TEXT[] NOT NULL DEFAULT '{}',
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_templates_type ON notifications.templates(type);
CREATE INDEX idx_templates_channel ON notifications.templates(channel);
CREATE INDEX idx_templates_active ON notifications.templates(active);
```

---

## Esquema de Integração

### Tabela: `integration.api_clients`
```sql
CREATE TABLE integration.api_clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    api_key VARCHAR(255) UNIQUE NOT NULL,
    api_secret_hash TEXT NOT NULL,
    permissions TEXT[] NOT NULL DEFAULT '{}',
    rate_limit_per_hour INTEGER DEFAULT 1000,
    rate_limit_per_day INTEGER DEFAULT 10000,
    webhook_url TEXT,
    active BOOLEAN DEFAULT true,
    created_by UUID NOT NULL REFERENCES auth.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_api_clients_api_key ON integration.api_clients(api_key);
CREATE INDEX idx_api_clients_active ON integration.api_clients(active);
CREATE INDEX idx_api_clients_created_by ON integration.api_clients(created_by);
```

### Tabela: `integration.integrations`
```sql
CREATE TABLE integration.integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns.campaigns(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL CHECK (type IN ('qgis', 'earth_engine', 'powerbi', 'custom')),
    name VARCHAR(255) NOT NULL,
    configuration JSONB NOT NULL DEFAULT '{}',
    last_sync_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) NOT NULL DEFAULT 'active' 
        CHECK (status IN ('active', 'paused', 'error')),
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_integrations_campaign_id ON integration.integrations(campaign_id);
CREATE INDEX idx_integrations_type ON integration.integrations(type);
CREATE INDEX idx_integrations_status ON integration.integrations(status);
```

### Tabela: `integration.webhook_subscriptions`
```sql
CREATE TABLE integration.webhook_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES integration.api_clients(id) ON DELETE CASCADE,
    events TEXT[] NOT NULL,
    url TEXT NOT NULL,
    secret VARCHAR(255) NOT NULL,
    retry_max_attempts INTEGER DEFAULT 3,
    retry_backoff_multiplier DECIMAL(3,2) DEFAULT 2.0,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_webhooks_client_id ON integration.webhook_subscriptions(client_id);
CREATE INDEX idx_webhooks_events ON integration.webhook_subscriptions USING GIN(events);
CREATE INDEX idx_webhooks_active ON integration.webhook_subscriptions(active);
```

### Tabela: `integration.webhook_deliveries`
```sql
CREATE TABLE integration.webhook_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID NOT NULL REFERENCES integration.webhook_subscriptions(id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    attempt_count INTEGER DEFAULT 1,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' 
        CHECK (status IN ('pending', 'delivered', 'failed')),
    response_status INTEGER,
    response_body TEXT,
    delivered_at TIMESTAMP WITH TIME ZONE,
    next_retry_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_deliveries_subscription_id ON integration.webhook_deliveries(subscription_id);
CREATE INDEX idx_deliveries_status ON integration.webhook_deliveries(status);
CREATE INDEX idx_deliveries_next_retry_at ON integration.webhook_deliveries(next_retry_at);
```

### Tabela: `integration.data_exports`
```sql
CREATE TABLE integration.data_exports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns.campaigns(id),
    requested_by UUID NOT NULL REFERENCES auth.users(id),
    format VARCHAR(20) NOT NULL CHECK (format IN ('shapefile', 'geojson', 'geopackage', 'csv')),
    filters JSONB DEFAULT '{}',
    include_metadata BOOLEAN DEFAULT true,
    status VARCHAR(20) NOT NULL DEFAULT 'queued' 
        CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
    file_url TEXT,
    file_size_bytes BIGINT,
    error_message TEXT,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_exports_campaign_id ON integration.data_exports(campaign_id);
CREATE INDEX idx_exports_requested_by ON integration.data_exports(requested_by);
CREATE INDEX idx_exports_status ON integration.data_exports(status);
CREATE INDEX idx_exports_created_at ON integration.data_exports(created_at);
```

---

## Esquema de Auditoria

### Tabela: `audit.event_log`
```sql
CREATE TABLE audit.event_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(100) NOT NULL,
    aggregate_type VARCHAR(50) NOT NULL,
    aggregate_id UUID NOT NULL,
    user_id UUID NOT NULL,
    payload JSONB NOT NULL,
    metadata JSONB DEFAULT '{}',
    correlation_id UUID,
    causation_id UUID,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_event_log_event_type ON audit.event_log(event_type);
CREATE INDEX idx_event_log_aggregate ON audit.event_log(aggregate_type, aggregate_id);
CREATE INDEX idx_event_log_user_id ON audit.event_log(user_id);
CREATE INDEX idx_event_log_correlation_id ON audit.event_log(correlation_id);
CREATE INDEX idx_event_log_created_at ON audit.event_log(created_at);
```

### Tabela: `audit.activity_log`
```sql
CREATE TABLE audit.activity_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id),
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id UUID NOT NULL,
    details JSONB DEFAULT '{}',
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_activity_user_id ON audit.activity_log(user_id);
CREATE INDEX idx_activity_action ON audit.activity_log(action);
CREATE INDEX idx_activity_resource ON audit.activity_log(resource_type, resource_id);
CREATE INDEX idx_activity_created_at ON audit.activity_log(created_at);
```

---

## Índices e Otimizações

### Índices Compostos Adicionais

```sql
-- Otimização para busca de pontos disponíveis
CREATE INDEX idx_points_available ON spatial.inspection_points(campaign_id, status, inspection_order) 
    WHERE status = 'pending';

-- Otimização para estatísticas de intérprete
CREATE INDEX idx_inspections_interpreter_stats ON inspection.inspections(interpreter_id, campaign_id, status)
    WHERE status = 'completed';

-- Otimização para consolidação pendente
CREATE INDEX idx_points_pending_consolidation ON spatial.inspection_points(campaign_id)
    WHERE status = 'completed' 
    AND NOT EXISTS (SELECT 1 FROM consolidation.consolidations c WHERE c.point_id = id);

-- Otimização para notificações pendentes
CREATE INDEX idx_notifications_pending ON notifications.notifications(scheduled_for, status)
    WHERE status = 'pending' AND scheduled_for IS NOT NULL;
```

### Views Materializadas

```sql
-- View para performance de intérpretes
CREATE MATERIALIZED VIEW analytics.interpreter_performance AS
SELECT 
    i.interpreter_id,
    i.campaign_id,
    COUNT(*) as total_inspections,
    COUNT(*) FILTER (WHERE i.status = 'completed') as completed_inspections,
    AVG(i.duration_seconds) FILTER (WHERE i.status = 'completed') as avg_duration,
    AVG(am.overall_agreement) as avg_agreement
FROM inspection.inspections i
LEFT JOIN consolidation.agreement_metrics am ON am.point_id = i.point_id
GROUP BY i.interpreter_id, i.campaign_id;

CREATE INDEX idx_interpreter_performance ON analytics.interpreter_performance(interpreter_id, campaign_id);

-- View para progresso de campanha
CREATE MATERIALIZED VIEW analytics.campaign_progress AS
SELECT 
    c.id as campaign_id,
    COUNT(DISTINCT p.id) as total_points,
    COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'completed') as completed_points,
    COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'in_progress') as in_progress_points,
    COUNT(DISTINCT i.id) as total_inspections,
    AVG(con.agreement_rate) as avg_agreement_rate
FROM campaigns.campaigns c
LEFT JOIN spatial.inspection_points p ON p.campaign_id = c.id
LEFT JOIN inspection.inspections i ON i.campaign_id = c.id
LEFT JOIN consolidation.consolidations con ON con.campaign_id = c.id
LEFT JOIN consolidation.consolidated_classifications cc ON cc.consolidation_id = con.id
GROUP BY c.id;

CREATE INDEX idx_campaign_progress ON analytics.campaign_progress(campaign_id);
```

### Triggers para Atualização Automática

```sql
-- Trigger para atualizar updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Aplicar trigger em todas as tabelas com updated_at
CREATE TRIGGER update_campaigns_updated_at BEFORE UPDATE ON campaigns.campaigns
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ... (repetir para todas as tabelas com updated_at)

-- Trigger para calcular duração da inspeção
CREATE OR REPLACE FUNCTION calculate_inspection_duration()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.completed_at IS NOT NULL AND NEW.started_at IS NOT NULL THEN
        NEW.duration_seconds = EXTRACT(EPOCH FROM (NEW.completed_at - NEW.started_at));
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER calculate_duration BEFORE UPDATE ON inspection.inspections
    FOR EACH ROW EXECUTE FUNCTION calculate_inspection_duration();
```

### Particionamento de Tabelas

```sql
-- Particionar tabela de logs por mês
CREATE TABLE audit.event_log_partitioned (
    LIKE audit.event_log INCLUDING ALL
) PARTITION BY RANGE (created_at);

-- Criar partições para os próximos 12 meses
CREATE TABLE audit.event_log_2025_01 PARTITION OF audit.event_log_partitioned
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
-- ... (repetir para cada mês)

-- Particionar notificações por status
CREATE TABLE notifications.notifications_partitioned (
    LIKE notifications.notifications INCLUDING ALL
) PARTITION BY LIST (status);

CREATE TABLE notifications.notifications_pending PARTITION OF notifications.notifications_partitioned
    FOR VALUES IN ('pending');
CREATE TABLE notifications.notifications_sent PARTITION OF notifications.notifications_partitioned
    FOR VALUES IN ('sent', 'delivered');
CREATE TABLE notifications.notifications_failed PARTITION OF notifications.notifications_partitioned
    FOR VALUES IN ('failed');
```

### Configurações de Performance

```sql
-- Estatísticas customizadas para colunas JSONB
ALTER TABLE campaigns.campaigns ALTER COLUMN metadata SET STATISTICS 1000;
ALTER TABLE spatial.inspection_points ALTER COLUMN properties SET STATISTICS 1000;

-- Configurar vacuum automático para tabelas de alta escrita
ALTER TABLE inspection.inspections SET (autovacuum_vacuum_scale_factor = 0.01);
ALTER TABLE audit.event_log SET (autovacuum_vacuum_scale_factor = 0.01);

-- Configurar fillfactor para tabelas com muitas atualizações
ALTER TABLE spatial.inspection_points SET (fillfactor = 85);
ALTER TABLE inspection.inspections SET (fillfactor = 85);
```
