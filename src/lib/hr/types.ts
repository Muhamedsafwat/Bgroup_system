// ─── Auth & Users ───────────────────────────────────────────────────────────

export type UserRole =
  | 'super_admin'
  | 'hr_manager'
  | 'team_lead'
  | 'accountant'
  | 'employee'
  | 'ceo'

export interface User {
  id: string
  email: string
  full_name: string
  roles: UserRole[]
  companies: string[]
  avatar: string | null
  employee_id: string | null
  is_active: boolean
}

export interface AuthTokens {
  access: string
  refresh: string
}

export interface LoginCredentials {
  email: string
  password: string
  remember_me?: boolean
}

export interface LoginResponse {
  access: string
  refresh: string
  user: User
}

// ─── Company & Structure ────────────────────────────────────────────────────

export interface Company {
  id: string
  name_en: string
  name_ar: string
  logo: string | null
  is_active: boolean
  employee_count?: number
  monthly_salary_budget?: number
}

export interface Department {
  id: string
  company: number
  company_name?: string
  name_en: string
  name_ar: string
  manager?: number
  manager_name?: string
  employee_count?: number
}

export interface Position {
  id: string
  company: number
  department: number
  title_en: string
  title_ar: string
  level: string
}

// ─── Employee ───────────────────────────────────────────────────────────────

export type EmploymentType = 'full_time' | 'part_time' | 'contract' | 'intern'
export type WorkModel = 'on_site' | 'remote' | 'hybrid'
export type EmployeeStatus = 'active' | 'on_leave' | 'probation' | 'terminated' | 'suspended'
export type EmployeeLevel = 'junior' | 'mid' | 'senior' | 'lead' | 'manager' | 'director' | 'c_level'
export type Currency = 'EGP' | 'QAR' | 'AED'

export interface Employee {
  id: string
  employee_id: string
  user?: number
  user_email?: string
  full_name_en: string
  full_name_ar: string
  photo: string | null
  company: number
  company_name?: string
  department: number
  department_name?: string
  position_en: string
  position_ar?: string
  level: EmployeeLevel
  employment_type: EmploymentType
  work_model: WorkModel
  status: EmployeeStatus
  base_salary: number
  currency: Currency
  contract_start: string
  contract_end: string | null
  probation_end: string | null
  national_id?: string
  date_of_birth?: string | null
  gender?: string
  personal_email?: string
  phone: string
  email: string
  address?: string
  emergency_contact_name?: string
  emergency_contact_phone?: string
  direct_manager?: number | null
  direct_manager_name?: string | null
  direct_manager_employee_id?: string | null
  shift?: number | null
  shift_name?: string | null
  shift_start?: string | null
  shift_end?: string | null
  shift_grace?: number | null
  shift_daily_hours?: number | null
  bank_name?: string
  bank_account?: string
  iban?: string
  team_lead?: number
  team_lead_name?: string
  hire_date: string
  termination_date?: string | null
  notes?: string
  created_at?: string
  updated_at?: string
}

export interface EmployeeSummary {
  id: string
  employee_id: string
  full_name_en: string
  full_name_ar: string
  photo: string | null
  company: number
  company_name: string
  department: number
  department_name: string
  position_en: string
  status: EmployeeStatus
  employment_type: EmploymentType
  base_salary: number
  currency: Currency
}

// ─── Attendance ─────────────────────────────────────────────────────────────

export type AttendanceStatus =
  | 'on_time'
  | 'late'
  | 'absent'
  | 'leave'
  | 'weekend'
  | 'holiday'

export interface AttendanceLog {
  id: string
  employee: number
  employee_name?: string
  employee_id_str?: string
  date: string
  check_in: string | null
  check_out: string | null
  status: AttendanceStatus
  hours_worked: number
  overtime_hours: number
  late_minutes: number
  is_manual: boolean
  notes?: string
  created_at?: string
}

export interface AttendanceSummary {
  date: string
  total_employees: number
  present: number
  late: number
  absent: number
  on_leave: number
  attendance_rate: number
}

// ─── Overtime ───────────────────────────────────────────────────────────────

export type OvertimeType = 'weekday' | 'weekend' | 'public_holiday' | 'night'
export type OvertimeStatus = 'pending' | 'approved' | 'denied' | 'cancelled'

export interface OvertimeRequest {
  id: string
  employee: number
  employee_name?: string
  employee_id_str?: string
  company?: number
  department?: number
  date: string
  overtime_type: OvertimeType
  hours_requested: number
  reason: string
  status: OvertimeStatus
  calculated_amount: number
  approved_by?: number
  approved_by_name?: string
  approved_at?: string
  denial_reason?: string
  created_at?: string
}

// ─── Incidents ──────────────────────────────────────────────────────────────

export type IncidentStatus = 'pending' | 'applied' | 'dismissed'
export type ActionTaken =
  | 'verbal_warning'
  | 'written_warning'
  | 'deduction'
  | 'suspension'
  | 'termination'

export interface ViolationRule {
  id: string
  code: string
  name_en: string
  name_ar: string
  category: number
  category_name?: string
  offense_1_action?: ActionTaken
  offense_1_deduction_pct?: number
  offense_2_action?: ActionTaken
  offense_2_deduction_pct?: number
}

export interface Incident {
  id: string
  employee: number
  employee_name?: string
  employee_id_str?: string
  company?: number
  department?: number
  is_bonus?: boolean
  violation_rule: number
  violation_rule_name?: string
  incident_date: string
  offense_number: number
  action_taken: ActionTaken
  deduction_amount: number
  status: IncidentStatus
  comments: string
  reported_by?: number
  reported_by_name?: string
  resolved_at?: string
  created_at?: string
}

// ─── Bonuses ────────────────────────────────────────────────────────────────

export type BonusStatus = 'pending' | 'applied' | 'dismissed'

export interface BonusRule {
  id: string
  name_en: string
  name_ar: string
  calculation_type: 'fixed' | 'percentage'
  default_amount: number
  percentage_of_salary?: number
}

export interface Bonus {
  id: string
  employee: number
  employee_name?: string
  employee_id_str?: string
  company?: number
  bonus_rule: number
  bonus_rule_name?: string
  bonus_date: string
  bonus_amount: number
  status: BonusStatus
  reason?: string
  approved_by?: number
  approved_by_name?: string
  created_at?: string
}

// ─── Payroll ─────────────────────────────────────────────────────────────────

export type SalaryStatus = 'open' | 'locked' | 'finalized' | 'paid'

export interface MonthlySalary {
  id: string
  employee: number
  employee_name?: string
  employee_id_str?: string
  company?: number
  company_name?: string
  department?: number
  department_name?: string
  month: number
  year: number
  base_salary: number
  overtime_amount: number
  overtime_hours: number
  total_bonuses: number
  total_deductions: number
  net_salary: number
  status: SalaryStatus
  status_display?: string
  work_days: number
  absent_days: number
  late_count: number
  locked_at?: string
  locked_by?: number
  finalized_at?: string
  notes?: string
  created_at?: string
  updated_at?: string
}

export interface PayrollSummary {
  id?: number
  month: number
  year: number
  company?: number
  company_name?: string
  total_employees: number
  total_base_salary: number
  total_overtime: number
  total_bonuses: number
  total_deductions: number
  total_net_salary: number
  status: 'draft' | 'calculated' | 'locked' | 'paid'
  period_status?: string
  period_id?: number
  needs_calculation?: boolean
}

// ─── Notifications ───────────────────────────────────────────────────────────

export type NotificationType =
  | 'overtime_pending'
  | 'overtime_approved'
  | 'overtime_denied'
  | 'incident_created'
  | 'bonus_approved'
  | 'salary_locked'
  | 'contract_expiry'
  | 'probation_end'
  | 'late_warning'
  | 'ot_cap_warning'
  | 'system'

export interface Notification {
  id: string
  recipient: number
  type: NotificationType
  title: string
  message: string
  is_read: boolean
  related_object_id?: number
  related_object_type?: string
  created_at: string
}

// ─── Dashboard Metrics ───────────────────────────────────────────────────────

export interface DashboardMetrics {
  total_employees: number
  active_employees: number
  attendance_rate: number
  pending_overtime: number
  /** audit v12 LOW (LOW-9) ultra — full DB count of pending incidents */
  pending_incidents: number
  monthly_salary_budget: number
  incidents_this_month: number
  bonuses_this_month: number
  employees_on_leave: number
  employees_on_probation: number
  contracts_expiring_soon: number
}

export interface AttendanceWidget {
  date: string
  present: number
  late: number
  absent: number
  on_leave: number
  total: number
  late_employees: EmployeeSummary[]
  absent_employees: EmployeeSummary[]
}

export interface DepartmentSalary {
  department_name: string
  base_salary: number
  overtime: number
  bonuses: number
  deductions: number
  net_salary: number
}

export interface MonthlyTrend {
  month: string
  total_salary: number
  overtime: number
  bonuses: number
  deductions: number
}

export interface AlertItem {
  type: 'contract_expiry' | 'probation_end' | 'ot_cap' | 'late_warning' | '3_lates'
  severity: 'warning' | 'danger' | 'info'
  employee_id: string
  employee_name: string
  message: string
  due_date?: string
}

// ─── Filters & Pagination ────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}

export interface FilterParams {
  company?: number
  department?: number
  status?: string
  employment_type?: string
  date_from?: string
  date_to?: string
  month?: number
  year?: number
  search?: string
  page?: number
  page_size?: number
  ordering?: string
}

// ─── Form Types ──────────────────────────────────────────────────────────────

export interface EmployeeFormData {
  full_name_en: string
  full_name_ar: string
  national_id: string
  phone: string
  email: string
  company: number
  department: number
  position_en: string
  position_ar: string
  level: EmployeeLevel
  employment_type: EmploymentType
  work_model: WorkModel
  base_salary: number
  currency: Currency
  contract_start: string
  contract_end?: string
  probation_end?: string
  bank_name?: string
  bank_account?: string
  address?: string
  emergency_contact_name?: string
  emergency_contact_phone?: string
  team_lead?: number
  notes?: string
}

export interface OvertimeRequestFormData {
  employee: number
  date: string
  overtime_type: OvertimeType
  hours_requested: number
  reason: string
}

export interface IncidentFormData {
  employee: number
  violation_rule: number
  incident_date: string
  action_taken: ActionTaken
  deduction_amount: number
  comments: string
}

export interface BonusFormData {
  employee: number
  bonus_rule: number
  bonus_date: string
  bonus_amount: number
  reason?: string
}
