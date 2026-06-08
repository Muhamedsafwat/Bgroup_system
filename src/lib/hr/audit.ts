import { db as prisma } from '@/lib/db'

interface AuditLogEntry {
  userId: string
  action: string        // 'create' | 'update' | 'delete' | 'login' | 'logout' | 'lock' | 'finalize' | 'approve' | 'deny'
  entityType: string    // 'employee' | 'user' | 'incident' | 'bonus' | 'payroll' | 'overtime' | 'setting' | 'company' | 'department'
  entityId?: number | string
  changes?: Record<string, { from: unknown; to: unknown }>
  details?: string
  ipAddress?: string
  /// auth User.id of the admin when the action was performed under
  /// impersonation. `userId` records the target's HR identity; this
  /// column captures the admin behind the action. Read from
  /// `session.user.actingAsUserId` by callers (undefined when the
  /// user is acting as themselves).
  actingAdminId?: string
}

/**
 * Creates one or more audit log rows.
 * The schema stores changes as individual rows per field (fieldName/oldValue/newValue).
 * If `changes` is provided, one row is created per changed field.
 * Otherwise a single summary row is created with the `details` message.
 */
export async function createAuditLog(entry: AuditLogEntry) {
  try {
    const base = {
      userId: entry.userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId != null ? String(entry.entityId) : '',
      ipAddress: entry.ipAddress ?? null,
      actingAdminId: entry.actingAdminId ?? null,
      timestamp: new Date(),
    }

    if (entry.changes && Object.keys(entry.changes).length > 0) {
      // One row per changed field
      for (const [field, diff] of Object.entries(entry.changes)) {
        await prisma.hrAuditLog.create({
          data: {
            ...base,
            fieldName: field,
            oldValue: diff.from != null ? String(diff.from) : '',
            newValue: diff.to != null ? String(diff.to) : '',
          },
        })
      }
    } else {
      // Single summary row
      await prisma.hrAuditLog.create({
        data: {
          ...base,
          fieldName: entry.details ? 'summary' : '',
          oldValue: '',
          newValue: entry.details ?? '',
        },
      })
    }
  } catch (error) {
    console.error('Audit log error:', error)
    // Don't throw — audit logging failure should never block the operation
  }
}

export function diffObjects(
  oldObj: Record<string, unknown>,
  newObj: Record<string, unknown>,
  fields: string[]
): Record<string, { from: unknown; to: unknown }> | undefined {
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  for (const field of fields) {
    const oldVal = oldObj[field]
    const newVal = newObj[field]
    if (String(oldVal) !== String(newVal)) {
      changes[field] = { from: oldVal, to: newVal }
    }
  }
  return Object.keys(changes).length > 0 ? changes : undefined
}

export function getClientIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
}
