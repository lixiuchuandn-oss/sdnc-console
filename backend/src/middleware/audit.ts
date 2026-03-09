import { Request, Response, NextFunction } from 'express';
import { logOperation } from '../utils/audit';

export const auditMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Only log state-changing methods
  if (req.method === 'GET' || req.method === 'OPTIONS' || req.method === 'HEAD') {
    return next();
  }

  // Use on('finish') to log after the response is sent, ensuring we capture the final status
  // and that req.user is populated by auth middleware if applicable
  res.on('finish', () => {
    // Skip if it's a 404 (route not found) usually not worth auditing as an "operation"
    // unless it's a security scan attempt. For now, let's keep it.
    
    const success = res.statusCode >= 200 && res.statusCode < 400;
    
    // Sanitize request body
    const details = {
      path: req.path,
      method: req.method,
      query: req.query,
      body: { ...req.body },
    };

    // Remove sensitive fields
    if (details.body.password) details.body.password = '***';
    if (details.body.token) details.body.token = '***';
    if (details.body.confirmPassword) details.body.confirmPassword = '***';
    if (details.body.newPassword) details.body.newPassword = '***';
    
    // Construct action name
    // e.g., POST /api/vms -> CREATE VM (heuristic)
    let action = `${req.method} ${req.path}`;
    
    // Try to determine resource type/id
    // This is heuristic and might need refinement
    let resourceType = 'UNKNOWN';
    let resourceId: string | undefined = undefined;

    // Advanced Resolution for VM Operations
    const path = req.path;
    const method = req.method;

    // 1. Harvester VM Lifecycle Actions (Start, Stop, Reboot, etc.)
    // Pattern: /api/clouds/:cloudId/resources/ecs/:instanceId/:action
    const vmActionRegex = /\/api\/clouds\/[^\/]+\/resources\/ecs\/([^\/]+)\/(start|stop|reboot|softreboot|pause|unpause|migrate|restore)/;
    const vmActionMatch = path.match(vmActionRegex);
    if (vmActionMatch && method === 'POST') {
      action = `${vmActionMatch[2].toUpperCase()}_VM`;
      resourceType = 'VM';
      resourceId = vmActionMatch[1];
    } 
    // 2. VM Volume Attach/Detach
    else if (path.match(/\/api\/clouds\/[^\/]+\/resources\/ecs\/([^\/]+)\/volumes\/(attach|detach)/) && method === 'POST') {
      const match = path.match(/\/api\/clouds\/[^\/]+\/resources\/ecs\/([^\/]+)\/volumes\/(attach|detach)/)!;
      action = `${match[2].toUpperCase()}_VOLUME_VM`;
      resourceType = 'VM';
      resourceId = match[1];
    }
    // 3. VM Migration Abort
    else if (path.match(/\/api\/clouds\/[^\/]+\/resources\/ecs\/([^\/]+)\/migrate\/abort/) && method === 'POST') {
      const match = path.match(/\/api\/clouds\/[^\/]+\/resources\/ecs\/([^\/]+)\/migrate\/abort/)!;
      action = 'ABORT_MIGRATION_VM';
      resourceType = 'VM';
      resourceId = match[1];
    }
    // 4. VM CRUD (Create, Update, Delete)
    else if (path.match(/\/api\/clouds\/[^\/]+\/resources\/ecs\/([^\/]+)$/)) {
      const match = path.match(/\/api\/clouds\/[^\/]+\/resources\/ecs\/([^\/]+)$/)!;
      resourceType = 'VM';
      resourceId = match[1];
      if (method === 'DELETE') action = 'DELETE_VM';
      else if (method === 'PUT') action = 'UPDATE_VM';
    }
    else if (path.match(/\/api\/clouds\/[^\/]+\/resources\/ecs$/) && method === 'POST') {
      action = 'CREATE_VM';
      resourceType = 'VM';
    }
    // 5. Default Heuristic for other resources
    else {
      // Example: /api/vms/:id
      // parts: ['', 'api', 'vms', '123']
      const parts = req.path.split('/').filter(p => p);
      
      if (parts.length > 0) {
         const lastPart = parts[parts.length - 1];
         // Check if last part looks like a UUID or ID (simple check: length > 10 or numeric)
         // This is a rough guess.
         const isId = lastPart.length > 20 || /^\d+$/.test(lastPart);
         
         if (isId) {
             resourceId = lastPart;
             // The part before ID is likely the resource type
             if (parts.length > 1) {
                 resourceType = parts[parts.length - 2].toUpperCase();
             }
         } else {
             resourceType = lastPart.toUpperCase();
         }
      }
      
      // Normalize resource type (remove 'API' if present)
      if (resourceType === 'API' && parts.length > 1) {
          resourceType = parts[1].toUpperCase();
      }
    }

    logOperation(
      req,
      action,
      JSON.stringify(details),
      success,
      resourceType,
      resourceId
    );
  });

  next();
};
