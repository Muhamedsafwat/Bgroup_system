'use client'

import { describeError } from "@/lib/zod-errors";

import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, ShieldCheck } from 'lucide-react'
import { PageHeader } from '@/components/hr/shared/PageHeader'
import { ConfirmDialog } from '@/components/hr/shared/ConfirmDialog'
import { Button } from '@/components/hr/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/hr/ui/dialog'
import { Input } from '@/components/hr/ui/input'
import { Label } from '@/components/hr/ui/label'
import { Badge } from '@/components/hr/ui/badge'
import { useToast } from '@/components/hr/ui/toast'
import api from '@/lib/hr/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Company {
  id: number
  name_en: string
}

interface LinkedEmployee {
  id: number
  employee_id: string
  name: string
}

interface User {
  id: number
  email: string
  first_name: string
  last_name: string
  full_name: string
  roles: string[]
  companies: number[]
  linked_employee: LinkedEmployee | null
  is_active: boolean
  created_at: string
}

interface Employee {
  id: number
  employee_id: string
  full_name_en: string
}

interface UserFormData {
  email: string
  first_name: string
  last_name: string
  password: string
  role_names: string[]
  company_ids: number[]
  link_employee_id: number | null
  is_active: boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ALL_ROLES = [
  { value: 'super_admin', label: 'Super Admin' },
  { value: 'hr_manager',  label: 'HR Manager' },
  { value: 'team_lead',   label: 'Team Lead' },
  { value: 'accountant',  label: 'Accountant' },
  { value: 'employee',    label: 'Employee' },
  { value: 'ceo',         label: 'CEO' },
]

const ROLE_COLORS: Record<string, string> = {
  super_admin: 'bg-purple-100 text-purple-800',
  hr_manager:  'bg-blue-100 text-blue-800',
  team_lead:   'bg-teal-100 text-teal-800',
  accountant:  'bg-amber-100 text-amber-800',
  employee:    'bg-muted text-foreground',
  ceo:         'bg-rose-100 text-rose-800',
}

const EMPTY_FORM: UserFormData = {
  email: '',
  first_name: '',
  last_name: '',
  password: '',
  role_names: [],
  company_ids: [],
  link_employee_id: null,
  is_active: true,
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function roleLabel(role: string) {
  return ALL_ROLES.find((r) => r.value === role)?.label ?? role
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function UsersSettingsPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editUser, setEditUser] = useState<User | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null)
  const [form, setForm] = useState<UserFormData>(EMPTY_FORM)

  // ─── Queries ────────────────────────────────────────────────────────────────

  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/auth/users/'),
  })
  const users: User[] = usersData?.data?.results ?? usersData?.data ?? []

  const { data: companiesData } = useQuery({
    queryKey: ['companies'],
    queryFn: () => api.get('/companies/'),
  })
  const companies: Company[] = (companiesData?.data as any)?.results ?? companiesData?.data ?? []

  const { data: employeesData } = useQuery({
    queryKey: ['employees-minimal'],
    queryFn: () => api.get('/employees/?page_size=500'),
  })
  const employees: Employee[] = employeesData?.data?.results ?? employeesData?.data ?? []

  // ─── Mutations ──────────────────────────────────────────────────────────────

  const createUser = useMutation({
    mutationFn: (data: UserFormData) => api.post('/auth/users/', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setDialogOpen(false)
      toast({ title: 'User created successfully' })
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.email?.[0]
        ?? err?.response?.data?.detail
        ?? 'Failed to create user.'
      toast({ title: 'Error', variant: 'destructive', description: msg })
    },
  })

  const updateUser = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<UserFormData> }) =>
      api.patch(`/auth/users/${id}/`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setDialogOpen(false)
      toast({ title: 'User updated successfully' })
    },
    onError: (__err: unknown) => toast({ title: 'Error', variant: 'destructive', description: describeError(__err) || 'Failed to update user.' }),
  })

  const deleteUser = useMutation({
    mutationFn: (id: number) => api.delete(`/auth/users/${id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setDeleteTarget(null)
      toast({ title: 'User deleted' })
    },
    onError: (__err: unknown) => toast({ title: 'Error', variant: 'destructive', description: describeError(__err) || 'Failed to delete user.' }),
  })

  // ─── Dialog Helpers ─────────────────────────────────────────────────────────

  function openAdd() {
    setEditUser(null)
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }

  function openEdit(user: User) {
    setEditUser(user)
    setForm({
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      password: '',
      role_names: [...user.roles],
      company_ids: [...user.companies],
      link_employee_id: user.linked_employee?.id ?? null,
      is_active: user.is_active,
    })
    setDialogOpen(true)
  }

  function toggleRole(role: string) {
    setForm((f) => ({
      ...f,
      role_names: f.role_names.includes(role)
        ? f.role_names.filter((r) => r !== role)
        : [...f.role_names, role],
    }))
  }

  function toggleCompany(id: number) {
    setForm((f) => ({
      ...f,
      company_ids: f.company_ids.includes(id)
        ? f.company_ids.filter((c) => c !== id)
        : [...f.company_ids, id],
    }))
  }

  function handleSubmit() {
    if (editUser) {
      const payload: Partial<UserFormData> = {
        first_name: form.first_name,
        last_name: form.last_name,
        role_names: form.role_names,
        company_ids: form.company_ids,
        link_employee_id: form.link_employee_id,
        is_active: form.is_active,
      }
      if (form.password) payload.password = form.password
      updateUser.mutate({ id: editUser.id, data: payload })
    } else {
      createUser.mutate(form)
    }
  }

  const isBusy = createUser.isPending || updateUser.isPending
  const canSubmit = editUser
    ? true
    : !!(form.email && form.password && form.first_name && form.last_name)

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <PageHeader
        title="User Management"
        description="Create and manage system users, roles, and company access"
        breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Users' }]}
        actions={
          <Button onClick={openAdd} className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white">
            <Plus className="h-4 w-4" />
            Add User
          </Button>
        }
      />

      <div className="bg-card rounded-lg border border-border overflow-hidden">
        {usersLoading ? (
          <div className="p-12 text-center text-muted-foreground text-sm">Loading users...</div>
        ) : users.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground text-sm">No users found.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground uppercase text-xs tracking-wide">
                  Name / Email
                </th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground uppercase text-xs tracking-wide">
                  Roles
                </th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground uppercase text-xs tracking-wide">
                  Companies
                </th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground uppercase text-xs tracking-wide">
                  Linked Employee
                </th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground uppercase text-xs tracking-wide">
                  Status
                </th>
                <th className="px-4 py-3 text-right font-semibold text-muted-foreground uppercase text-xs tracking-wide">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((user) => {
                const companyNames = user.companies
                  .map((id) => companies.find((c) => c.id === id)?.name_en ?? `#${id}`)
                  .join(', ')

                return (
                  <tr key={user.id} className="hover:bg-muted/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{user.full_name}</div>
                      <div className="text-xs text-muted-foreground">{user.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {user.roles.length === 0 ? (
                          <span className="text-xs text-muted-foreground">No roles</span>
                        ) : (
                          user.roles.map((role) => (
                            <span
                              key={role}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[role] ?? 'bg-muted text-foreground'}`}
                            >
                              <ShieldCheck className="h-3 w-3" />
                              {roleLabel(role)}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {companyNames || <span className="text-muted-foreground">None</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {user.linked_employee ? (
                        <span className="font-medium text-foreground">
                          {user.linked_employee.employee_id}{' '}
                          <span className="text-muted-foreground font-normal">— {user.linked_employee.name}</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Not linked</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          user.is_active
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {user.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="h-7 w-7"
                          onClick={() => openEdit(user)}
                          title="Edit user"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-50"
                          onClick={() => setDeleteTarget(user)}
                          title="Delete user"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editUser ? 'Edit User' : 'Add User'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Email — read-only when editing */}
            <div className="space-y-1.5">
              <Label>Email *</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="user@example.com"
                disabled={!!editUser}
              />
            </div>

            {/* Name row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>First Name *</Label>
                <Input
                  value={form.first_name}
                  onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))}
                  placeholder="First name"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Last Name *</Label>
                <Input
                  value={form.last_name}
                  onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))}
                  placeholder="Last name"
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <Label>{editUser ? 'New Password (leave blank to keep current)' : 'Password *'}</Label>
              <Input
                type="password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                placeholder={editUser ? 'Leave blank to keep current' : 'Min 8 characters'}
                autoComplete="new-password"
              />
            </div>

            {/* Roles */}
            <div className="space-y-2">
              <Label>Roles</Label>
              <div className="flex flex-wrap gap-2">
                {ALL_ROLES.map((role) => {
                  const active = form.role_names.includes(role.value)
                  return (
                    <button
                      key={role.value}
                      type="button"
                      onClick={() => toggleRole(role.value)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                        active
                          ? `${ROLE_COLORS[role.value] ?? 'bg-slate-200 text-foreground'} border-transparent ring-2 ring-offset-1 ring-blue-400`
                          : 'bg-card text-muted-foreground border-border hover:border-border'
                      }`}
                    >
                      <ShieldCheck className="h-3 w-3" />
                      {role.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Companies */}
            {companies.length > 0 && (
              <div className="space-y-2">
                <Label>Company Access</Label>
                <div className="flex flex-wrap gap-2">
                  {companies.map((company) => {
                    const active = form.company_ids.includes(company.id)
                    return (
                      <button
                        key={company.id}
                        type="button"
                        onClick={() => toggleCompany(company.id)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                          active
                            ? 'bg-blue-600 text-white border-transparent ring-2 ring-offset-1 ring-blue-400'
                            : 'bg-card text-muted-foreground border-border hover:border-border'
                        }`}
                      >
                        {company.name_en}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Link to Employee (edit only) */}
            {editUser && (
              <div className="space-y-1.5">
                <Label>Link to Employee</Label>
                <select
                  className="h-9 w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-blue-400"
                  value={form.link_employee_id ?? ''}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      link_employee_id: e.target.value ? Number(e.target.value) : null,
                    }))
                  }
                >
                  <option value="">— Not linked —</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.employee_id} — {emp.full_name_en}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">Links this user account to an employee record for attendance, payroll, and self-service.</p>
              </div>
            )}

            {/* Active toggle (edit only) */}
            {editUser && (
              <div className="flex items-center gap-3">
                <Label className="cursor-pointer flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                    className="h-4 w-4 rounded border-border text-blue-600 focus:ring-blue-500"
                  />
                  Account Active
                </Label>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!canSubmit || isBusy}
              loading={isBusy}
            >
              {editUser ? 'Save Changes' : 'Create User'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete User"
        description={`Permanently delete "${deleteTarget?.full_name}" (${deleteTarget?.email})? This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => deleteTarget && deleteUser.mutateAsync(deleteTarget.id)}
        loading={deleteUser.isPending}
      />
    </div>
  )
}
