# ADEGAFOOD — ARQUITETURA DO SISTEMA (FASE 2)

## 1. Visão Geral da Arquitetura

O **AdegaFood** é uma plataforma SaaS multitenant projetada sob o princípio de **Zero-Trust** e isolamento absoluto de dados entre estabelecimentos comerciais. A plataforma garante que cada loja possua seu próprio aplicativo digital, canal de venda direto e relacionamento exclusivo com seus clientes, sem dependência ou taxas predatórias de marketplaces.

```
+-------------------------------------------------------------------------+
|                              CAMADA CLIENTE                             |
|  +---------------------------+       +-------------------------------+  |
|  |  Painel do Estabelecimento|       |      App do Cliente (PWA)     |  |
|  |       (15 Módulos)        |       |    (/app/:slug do Tenant)     |  |
|  +-------------+-------------+       +---------------+---------------+  |
+----------------|-------------------------------------|------------------+
                 |                                     |
                 v                                     v
+-------------------------------------------------------------------------+
|                       CAMADA DE SERVIÇOS & NEGÓCIO                      |
|  productService  |  categoryService  |  offerService  |  themeService   |
|  orderService    |  customerService  |  tenantService |  authService    |
+-------------------------------------------------------------------------+
                                     |
                                     v
+-------------------------------------------------------------------------+
|                     MOTOR DE SEGURANÇA ZERO-TRUST                       |
|  - validateTenantAccess: Garante que tenant_id da sessão == recurso     |
|  - validatePermission: Matriz RBAC estrita por cargo (CEO -> CUSTOMER)  |
|  - Trilha Forense: Auditoria imutável com diff (previous vs new)        |
+-------------------------------------------------------------------------+
                                     |
                                     v
+-------------------------------------------------------------------------+
|                  BANCO DE DADOS & REGRAS RLS (DATASTORE)                |
|  - Persistência desacoplada com chave versionada (adegafood_saas_db_v2) |
|  - Índices multitenant por tenant_id em todas as coleções               |
+-------------------------------------------------------------------------+
```

## 2. Princípios de Segurança e Anti-Hacker

1. **Prevenção contra Invasão IDOR (Insecure Direct Object References)**:
   - Toda consulta no backend recebe um `SecurityContext` validado (contendo `userId`, `userRole` e `tenantId`).
   - Se um usuário autenticado do `tenant-adega-01` tentar ler, atualizar ou excluir registros do `tenant-burger-02`, o método `validateTenantAccess` rejeita a operação com `AccessDeniedSecurityException` e registra o incidente no log de auditoria com alerta forense.

2. **Hierarquia de Papéis (RBAC)**:
   - `CEO` / `SUPER_ADMIN`: Acesso global HQ, monitoramento de métricas agregadas e suporte em modo auditoria.
   - `OWNER`: Controle total das operações, produtos, tema, equipe e financeiro de seu respectivo tenant.
   - `MANAGER`: Gestão operacional diária de pedidos, produtos e clientes.
   - `OPERATOR` / `CASHIER`: Acesso restrito a conferência de pedidos, PDV e estoque.
   - `DELIVERY_MANAGER` / `DRIVER`: Despacho e rotas de entrega.
   - `CUSTOMER`: Apenas leitura do cardápio público e criação de seus próprios pedidos.

3. **Isolamento de Domínio e URLs Amigáveis**:
   - Cada tenant tem seu slug público: `/app/:slug`.
   - As consultas públicas filtram somente registros com `isActive: true`, sem expor custos (`cost`), margens ou dados internos de outros lojistas.
