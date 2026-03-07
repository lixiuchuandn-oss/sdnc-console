# Platform Licensing & Authorization System Design

## 1. Overview
This document outlines the design for the platform's licensing and authorization system, enabling feature control based on license types (Default, Multi-Cloud, SDN, AISOC). The goal is to dynamically control menu visibility, API access, and resource limits.

## 2. License Model

The license will be a signed JWT containing a payload that defines enabled features and limits.

### 2.1 License Payload Structure
```typescript
interface LicensePayload {
  iss: string;       // Issuer
  sub: string;       // Subject (Customer Name)
  iat: number;       // Issued At
  exp: number;       // Expiration Time
  type: 'trial' | 'standard' | 'enterprise';
  
  // Feature Flags
  features: string[]; 
  // e.g., ['platform.default', 'platform.multi-cloud', 'platform.sdn', 'platform.aisoc']

  // Resource Limits
  limits: {
    maxNodes: number;          // Maximum number of compute nodes
    maxVms: number;            // Maximum number of VMs
    maxCloudAccounts: number;  // Maximum number of cloud accounts (for Multi-Cloud)
  };
}
```

### 2.2 Feature Codes Definition
| Feature Code | Description | Implications |
| :--- | :--- | :--- |
| `platform.default` | Base Platform Authorization | Enabled by default. Includes basic cloud management. |
| `platform.multi-cloud` | Multi-Cloud Authorization | Unlocks Aliyun, Huawei, etc. Unlocks higher `maxCloudAccounts`. |
| `platform.sdn` | SDN Authorization | Unlocks SDN Control Center (SDNCC) platform. |
| `platform.aisoc` | AISOC Authorization | Unlocks AI SOC Center (CNSOC) platform. |
| `sys.tenant-mgmt` | Tenant Management | Controls visibility of Tenant/User management. |
| `sys.rbac-advanced` | Advanced RBAC | Controls visibility of Functional Permissions & Role Management. |

## 3. Authorization Scenarios & Rules

### 3.1 Default Authorization (Base License)
*   **Target User**: Single-cloud / Edge scenarios.
*   **Enabled Features**: `['platform.default']` (Implicitly *excludes* `multi-cloud`, `sdn`, `aisoc`, `tenant-mgmt`, `rbac-advanced`).
*   **Constraints**:
    1.  **Cloud Provider**: Only allows `cloudmap` type resource pools.
    2.  **Resource Console**: Hide `clouds.console` (Cloud Console).
    3.  **Dashboard**: Hide `ops.dashboard` (Overview Dashboard).
        *   *Action*: Move SDN Overview (`sdn-dashboard`) to SDNCC platform structure (see below).
    4.  **Tenant Management**: Hide entire `Tenants` group (`tenants`, `tenants.users`).
    5.  **Permission Management**:
        *   Hide `access.actions` (Functional Permissions).
        *   Hide `access.roles` (Role Management).
        *   *Keep*: `access.users` (User Management) - usage of built-in roles only.

### 3.2 Multi-Cloud Authorization
*   **Target User**: Hybrid cloud scenarios.
*   **Enabled Features**: `['platform.default', 'platform.multi-cloud']`.
*   **Capabilities**:
    *   Unlocks all cloud provider types (Aliyun, AWS, etc.).
    *   **Limit Control**: `limits.maxCloudAccounts` determines how many cloud platforms can be connected.

### 3.3 SDN Authorization
*   **Target User**: Network-intensive scenarios.
*   **Enabled Features**: `['platform.sdn']`.
*   **Capabilities**:
    *   Unlocks `SDNCC` Platform entry in the sidebar.
    *   Includes `sdn-dashboard` (moved from CNMC).

### 3.4 AISOC Authorization
*   **Target User**: Security operation scenarios.
*   **Enabled Features**: `['platform.aisoc']`.
*   **Capabilities**:
    *   Unlocks `CNSOC` Platform entry in the sidebar.

## 4. Implementation Strategy

### 4.1 Backend Implementation
1.  **License Service Update**:
    *   Update `LicensePayload` definition.
    *   Implement `verifyLicense` to expose granular features.
2.  **Cloud Service Guard**:
    *   In `createCloud` / `updateCloud`:
        *   Check `maxCloudAccounts` limit.
        *   If `!hasFeature('platform.multi-cloud')`, enforce `provider === 'cloudmap'`.
3.  **API Middleware**:
    *   Create `RequireLicenseFeature(code)` middleware.
    *   Apply to SDNCC and CNSOC routes.

### 4.2 Frontend Implementation
1.  **License Context**:
    *   Expose `hasFeature(code)` helper.
2.  **Menu Filtering (AdminLayout)**:
    *   Update `visibleCenters` logic to check `platform` feature flags:
        *   `CNMC`: Always visible (Base).
        *   `SDNCC`: Requires `platform.sdn`.
        *   `CNSOC`: Requires `platform.aisoc`.
    *   Update `items` filtering logic to check specific feature flags:
        *   `RouteSpec` items will have an optional `requiredFeature` field.
3.  **Route Refactoring**:
    *   **Move SDN Dashboard**: Change `sdn-dashboard` platform from `CNMC` to `SDNCC`.
    *   **Tag Routes**: Add `requiredFeature` to:
        *   `tenants-list` -> `sys.tenant-mgmt`
        *   `access-actions` -> `sys.rbac-advanced`
        *   `access-roles` -> `sys.rbac-advanced`
        *   `dashboard` -> `platform.dashboard` (if we want to hide it explicitly, or just use a flag).

### 5. Migration Steps
1.  **Refactor Routes**: Update `RouteSpec.ts` to move SDN Dashboard.
2.  **Update License Logic**: Modify `LicenseContext.tsx` and `LicenseService.ts`.
3.  **Apply Guards**: Add checks in `AdminLayout.tsx` and Backend Services.
