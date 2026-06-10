import { db as prisma } from '@/lib/db'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { cookies } from 'next/headers'
import jwt from 'jsonwebtoken'

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET || process.env.NEXTAUTH_SECRET
  if (!secret) {
    if (process.env.NODE_ENV === 'test') {
      return 'test-secret-do-not-use-in-production'
    }
    throw new Error('JWT_SECRET or NEXTAUTH_SECRET environment variable is not set. Cannot sign tokens.')
  }
  return secret
}

const SESSION_TIMEOUT_MS = 8 * 60 * 60 * 1000 // 8 hours

export interface AuthUser {
  id: string
  email: string
  username: string
  firstName: string
  lastName: string
  phone: string
  avatar: string | null
  isActive: boolean
  isSuperuser: boolean
  roles: string[]
  companies: string[]
  // audit v12 MEDIUM (MED-52) followup: when an admin impersonates
  // another user, this holds the real admin's user id so HR routes
  // can stamp `actingAdminId` on audit rows. NextAuth populates this
  // from session.user.actingAs.realUserId during impersonation; for
  // direct sign-in callers it is undefined.
  actingAsUserId?: string
}

// ─── Django Password Verification ──────────────────────────

export async function verifyDjangoPassword(
  password: string,
  encoded: string
): Promise<boolean> {
  // Django format: algorithm$iterations$salt$hash
  // e.g. pbkdf2_sha256$720000$salt$base64hash
  const parts = encoded.split('$')
  if (parts.length !== 4) return false

  const [algorithm, iterationsStr, salt, storedHash] = parts
  const iterations = parseInt(iterationsStr, 10)

  if (algorithm !== 'pbkdf2_sha256') return false

  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, iterations, 32, 'sha256', (err, derivedKey) => {
      if (err) return reject(err)
      const computedHash = derivedKey.toString('base64')
      const expected = Buffer.from(storedHash, 'utf8')
      const actual = Buffer.from(computedHash, 'utf8')
      if (expected.length !== actual.length) {
        resolve(false)
      } else {
        resolve(crypto.timingSafeEqual(expected, actual))
      }
    })
  })
}

// ─── Bcrypt Password ───────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export async function verifyBcryptPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

// ─── Verify Password (handles both Django and bcrypt) ──────

export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  if (storedHash.startsWith('pbkdf2_sha256$')) {
    return verifyDjangoPassword(password, storedHash)
  }
  if (storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$')) {
    return verifyBcryptPassword(password, storedHash)
  }
  return false
}

// ─── JWT Token Generation ──────────────────────────────────

export function generateAccessToken(userId: string): string {
  return jwt.sign(
    { userId, type: 'access', sessionStart: Date.now() },
    getJwtSecret(),
    { expiresIn: '1h' }
  )
}

export function generateRefreshToken(userId: string): string {
  return jwt.sign(
    { userId, type: 'refresh', sessionStart: Date.now() },
    getJwtSecret(),
    { expiresIn: '30d' }
  )
}

export function verifyToken(token: string): { userId: string; type: string; sessionStart?: number } | null {
  try {
    const payload = jwt.verify(token, getJwtSecret()) as {
      userId: string
      type: string
      sessionStart?: number
    }

    // Enforce 8-hour session timeout if sessionStart is present
    if (payload.sessionStart && Date.now() - payload.sessionStart > SESSION_TIMEOUT_MS) {
      return null
    }

    return payload
  } catch {
    return null
  }
}

// ─── Get Current User from Request ─────────────────────────
//
// Resolution order:
//   1. Legacy HR JWT (Authorization header or bghr_access cookie)
//   2. NextAuth session (unified super-app auth)
//
// The NextAuth fallback lets HR API routes accept callers that signed in via
// the unified login flow (which does not set the legacy HR cookie).

export async function getCurrentUser(request?: Request): Promise<AuthUser | null> {
  // 1. Legacy HR JWT
  let token: string | undefined
  if (request) {
    const authHeader = request.headers.get('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7)
    }
    if (!token) {
      const cookieHeader = request.headers.get('cookie') || ''
      const match = cookieHeader.match(/bghr_access=([^;]+)/)
      if (match) token = match[1]
    }
  } else {
    const cookieStore = await cookies()
    token = cookieStore.get('bghr_access')?.value
  }

  if (token) {
    const payload = verifyToken(token)
    if (payload && payload.type === 'access') {
      const user = await getUserById(payload.userId)
      if (user) return user
    }
  }

  // 2. NextAuth session fallback
  try {
    const { auth } = await import('@/lib/auth')
    const session = await auth()
    if (session?.user?.id && session.user.modules?.includes('hr')) {
      const user = await getUserById(session.user.id)
      if (!user) return null
      // audit v12 MEDIUM (MED-52) followup: when the NextAuth session
      // is in impersonation mode, surface the real admin's user id so
      // downstream HR routes can record `actingAdminId` on audits.
      // session.user.actingAs holds the IMPERSONATED user info; the
      // real admin user id lives on actingAs.realUserId. Mirror it
      // onto the returned AuthUser.
      const actingAs = session.user.actingAs as { realUserId?: string } | undefined
      if (actingAs?.realUserId) {
        return { ...user, actingAsUserId: actingAs.realUserId }
      }
      return user
    }
  } catch {
    // auth() can throw if called outside request scope — ignore and fall through.
  }

  return null
}

// ─── Fetch User with Roles ─────────────────────────────────

export async function getUserById(id: string): Promise<AuthUser | null> {
  const profile = await prisma.hrUserProfile.findUnique({
    where: { userId: id },
    include: {
      user: true,
      roles: { include: { role: true } },
      companies: true,
    },
  })

  if (!profile || !profile.isActive) return null

  return {
    id: profile.userId,
    email: profile.user.email ?? '',
    username: profile.username,
    firstName: profile.firstName,
    lastName: profile.lastName,
    phone: profile.phone,
    avatar: profile.avatar,
    isActive: profile.isActive,
    isSuperuser: profile.isSuperuser,
    roles: profile.roles.map((ur) => ur.role.name),
    companies: profile.companies.map((uc) => uc.companyId),
  }
}

// ─── Require Auth Helper ───────────────────────────────────

export async function requireAuth(request: Request): Promise<AuthUser> {
  const user = await getCurrentUser(request)
  if (!user) {
    throw new Response(JSON.stringify({ detail: 'Authentication credentials were not provided.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return user
}
