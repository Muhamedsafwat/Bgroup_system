'use client'

import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Upload, Download, Trash2, Lock, FileText, Loader2 } from 'lucide-react'
import { PageHeader } from '@/components/hr/shared/PageHeader'
import { ConfirmDialog } from '@/components/hr/shared/ConfirmDialog'
import { Button } from '@/components/hr/ui/button'
import { useToast } from '@/components/hr/ui/toast'
import { useAuth } from '@/contexts/hr/AuthContext'
import api from '@/lib/hr/api'
import { formatDate, getFileSize } from '@/lib/hr/utils'
import { describeError } from "@/lib/zod-errors";

const DOCUMENT_SECTIONS = [
  { type: 'job_description', label: 'Job Description' },
  { type: 'job_offer', label: 'Job Offer' },
  { type: 'employment_contract', label: 'Employment Contract' },
  { type: 'nda', label: 'NDA' },
  { type: 'certificate', label: 'Certificates' },
  { type: 'other', label: 'Other' },
]

interface EmployeeDocument {
  id: number
  filename: string
  document_type: string
  file_size: number
  upload_date: string
  uploaded_by_employee: boolean
  file_url: string
}

export default function MyDocumentsPage() {
  const { user } = useAuth()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [deleteTarget, setDeleteTarget] = useState<EmployeeDocument | null>(null)
  const [uploadingType, setUploadingType] = useState<string | null>(null)
  const [dragOverType, setDragOverType] = useState<string | null>(null)

  // Get employee pk from the linked employee profile
  const { data: profileData, isError: profileError, isLoading: profileLoading } = useQuery<{ data: { id: number } }>({
    queryKey: ['my-employee-profile'],
    queryFn: () => api.get('/employees/my-profile/'),
    retry: 1,
  })
  const employeeId = profileData?.data?.id

  const { data, isLoading } = useQuery<{ data: { results: EmployeeDocument[] } }>({
    queryKey: ['my-documents', employeeId],
    queryFn: () => api.get(`/employees/${employeeId}/documents/`),
    enabled: !!employeeId,
  })
  const documents = data?.data?.results ?? []

  const uploadMutation = useMutation({
    mutationFn: ({ file, documentType }: { file: File; documentType: string }) => {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('document_type', documentType)
      return api.post(`/employees/${employeeId}/documents/`, fd)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-documents'] })
      setUploadingType(null)
      toast({ title: 'Document uploaded' })
    },
    onError: (err: unknown) => {
      setUploadingType(null)
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast({ title: 'Upload failed', variant: 'destructive', description: msg || 'Failed to upload document.' })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (docId: number) =>
      api.delete(`/employees/${employeeId}/documents/${docId}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-documents'] })
      setDeleteTarget(null)
      toast({ title: 'Document deleted' })
    },
    onError: (__err: unknown) => toast({ title: 'Error', variant: 'destructive', description: describeError(__err) || 'Failed to delete document.' }),
  })

  function handleFileInput(docType: string, files: FileList | null) {
    if (!files || files.length === 0 || !employeeId) return
    setUploadingType(docType)
    uploadMutation.mutate({ file: files[0], documentType: docType })
  }

  function triggerFileInput(docType: string) {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = false
    input.onchange = (e) => handleFileInput(docType, (e.target as HTMLInputElement).files)
    input.click()
  }

  async function handleDownload(doc: EmployeeDocument) {
    try {
      const res = await api.get(doc.file_url, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = doc.filename
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast({ title: 'Download failed', variant: 'destructive' })
    }
  }

  function getDocsByType(type: string) {
    return documents.filter((d) => d.document_type === type)
  }

  function getFileIcon(filename: string) {
    const ext = filename.split('.').pop()?.toLowerCase()
    if (['pdf'].includes(ext ?? '')) return '📄'
    if (['doc', 'docx'].includes(ext ?? '')) return '📝'
    if (['xls', 'xlsx'].includes(ext ?? '')) return '📊'
    if (['jpg', 'jpeg', 'png', 'gif'].includes(ext ?? '')) return '🖼️'
    return '📎'
  }

  if (profileLoading) {
    return (
      <div className="flex items-center justify-center p-16 gap-3 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />Loading profile...
      </div>
    )
  }

  if (profileError || !employeeId) {
    return (
      <div className="flex flex-col items-center justify-center p-16 text-center gap-3">
        <FileText className="h-10 w-10 text-muted-foreground/60" />
        <p className="text-muted-foreground font-medium">Employee profile not linked</p>
        <p className="text-muted-foreground text-sm max-w-sm">
          Your user account is not linked to an employee record. Please contact HR to set this up.
        </p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-16 gap-3 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />Loading documents...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Documents"
        description="Upload and manage your employment documents"
        breadcrumbs={[{ label: 'My Documents' }]}
      />

      <div className="space-y-4">
        {DOCUMENT_SECTIONS.map((section) => {
          const sectionDocs = getDocsByType(section.type)
          const isUploadingThis = uploadingType === section.type

          return (
            <div key={section.type} className="bg-card rounded-lg border border-border overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border/60 bg-muted/50">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold text-foreground">{section.label}</h3>
                  {sectionDocs.length > 0 && (
                    <span className="text-xs bg-slate-200 text-muted-foreground px-1.5 py-0.5 rounded-full font-medium">
                      {sectionDocs.length}
                    </span>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 h-7 text-xs"
                  onClick={() => triggerFileInput(section.type)}
                  disabled={isUploadingThis}
                >
                  {isUploadingThis ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Upload className="h-3 w-3" />
                  )}
                  {isUploadingThis ? 'Uploading...' : 'Upload'}
                </Button>
              </div>

              {sectionDocs.length === 0 ? (
                <div
                  className={`p-6 text-center border-2 border-dashed m-3 rounded-lg transition-colors cursor-pointer ${
                    dragOverType === section.type
                      ? 'border-blue-400 bg-blue-50 text-blue-600'
                      : 'border-border text-muted-foreground hover:border-border hover:bg-muted/50'
                  }`}
                  onDragOver={(e) => { e.preventDefault(); setDragOverType(section.type) }}
                  onDragLeave={() => setDragOverType(null)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setDragOverType(null)
                    handleFileInput(section.type, e.dataTransfer.files)
                  }}
                  onClick={() => triggerFileInput(section.type)}
                >
                  <Upload className="h-6 w-6 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Drop a file here or click to upload</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {sectionDocs.map((doc) => (
                    <div key={doc.id} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/50 transition-colors">
                      <span className="text-xl">{getFileIcon(doc.filename)}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{doc.filename}</p>
                        <p className="text-xs text-muted-foreground">
                          {getFileSize(doc.file_size)} · Uploaded {formatDate(doc.upload_date)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="h-7 w-7 text-blue-600 hover:text-blue-800 hover:bg-blue-50"
                          onClick={() => handleDownload(doc)}
                          title="Download"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                        {doc.uploaded_by_employee ? (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50"
                            onClick={() => setDeleteTarget(doc)}
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        ) : (
                          <div className="h-7 w-7 flex items-center justify-center text-muted-foreground/60" title="Uploaded by HR — cannot delete">
                            <Lock className="h-3.5 w-3.5" />
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete Document"
        description={`Delete "${deleteTarget?.filename}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => deleteTarget && deleteMutation.mutateAsync(deleteTarget.id)}
        loading={deleteMutation.isPending}
      />
    </div>
  )
}
