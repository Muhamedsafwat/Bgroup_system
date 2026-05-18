'use client'

import React from 'react'
import { useSession } from 'next-auth/react'
import { PageHeader } from '@/components/hr/shared/PageHeader'
import { Card } from '@/components/hr/ui/card'
import { TaskList } from '@/components/tasks/TaskList'
import { useLocale } from '@/lib/i18n'

/**
 * /hr/employee/tasks — the employee's own task surface.
 *
 * Visually consistent with the rest of /hr/employee/* (PageHeader + Card
 * shell). The heavy lifting is done by <TaskList scope="mine"> which:
 *   - fetches tasks the user is the assignee OR creator of
 *   - shows the "Today / Overdue / Upcoming / Someday / Done" buckets
 *   - opens TaskDrawer for click → which now respects the creator/assignee
 *     permission lattice (Start/End for assignees, full edit for creators,
 *     attachments + comments for both)
 *
 * Why a dedicated page when /tasks already exists? Two reasons:
 *   1. The employee sidebar already lives under /hr/employee/*; jumping to
 *      a top-level /tasks broke the breadcrumb context.
 *   2. Employees were filtering through their own admin-flavoured /tasks
 *      view and getting confused. Same component, scoped + framed.
 */
export default function EmployeeTasksPage() {
  const { locale } = useLocale();
  const isAr = locale === 'ar';
  const { data: session } = useSession()
  const firstName = session?.user?.name?.split(' ')[0]

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Tasks"
        description={
          firstName
            ? `${firstName}, here's everything assigned to you and tasks you've created`
            : 'Everything assigned to you, plus tasks you create for yourself'
        }
        breadcrumbs={[{ label: isAr ? 'مساحتي' : 'My Workspace' }, { label: isAr ? 'المهام' : 'Tasks' }]}
      />

      <Card className="p-4 sm:p-5">
        <TaskList scope="mine" />
      </Card>

      <p className="text-xs text-muted-foreground">
        Tip: tasks <strong>assigned to you</strong> can be Started and Ended from the task
        drawer — you can also add comments and attach files. Tasks you{' '}
        <strong>created yourself</strong> are fully editable.
      </p>
    </div>
  )
}
