'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/partners/api';
import type { PaginationMeta } from '@/lib/partners/api';
import type { Lead } from '@/lib/partners/types';
import { DataTable } from '@/components/partners/ui/data-table';
import { Badge } from '@/components/partners/ui/badge';
import { Button } from '@/components/partners/ui/button';
import { Input, Textarea } from '@/components/partners/ui/input';
import { Modal } from '@/components/partners/ui/modal';
import { Card } from '@/components/partners/ui/card';
import { EmptyState } from '@/components/partners/ui/empty-state';
import { TableSkeleton } from '@/components/partners/ui/skeleton';
import { Plus, Users } from 'lucide-react';
import { useLocale } from '@/lib/i18n';
import Link from 'next/link';

export default function LeadsPage() {
  const { locale } = useLocale();
  const isAr = locale === 'ar';
  const [leads, setLeads] = useState<Lead[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({ name: '', email: '', phone: '', company: '', notes: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const fetchLeads = async (p: number) => {
    try {
      const res = await api.get<Lead[]>(`/leads?page=${p}&perPage=10`);
      setLeads(res.data);
      setPagination(res.meta?.pagination ?? null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLeads(page); }, [page]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api.post('/leads', formData);
      setShowModal(false);
      setFormData({ name: '', email: '', phone: '', company: '', notes: '' });
      fetchLeads(page);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create lead');
    } finally {
      setSubmitting(false);
    }
  };

  const columns = [
    {
      key: 'name', label: 'Name',
      render: (lead: Lead) => (
        <Link href={`/partners/leads/${lead.id}`} className="flex items-center gap-3 group">
          <div className="w-8 h-8 bg-blue-50 rounded-full flex items-center justify-center shrink-0">
            <span className="text-sm font-semibold text-blue-600">{lead.name.charAt(0)}</span>
          </div>
          <div>
            <p className="text-sm font-medium text-foreground group-hover:text-blue-600 transition-colors">{lead.name}</p>
            {lead.email && <p className="text-xs text-muted-foreground">{lead.email}</p>}
          </div>
        </Link>
      ),
    },
    { key: 'company', label: 'Company', render: (lead: Lead) => <span className="text-sm text-muted-foreground">{lead.company || '—'}</span> },
    { key: 'phone', label: 'Phone', render: (lead: Lead) => <span className="text-sm text-muted-foreground">{lead.phone || '—'}</span> },
    { key: 'status', label: 'Status', render: (lead: Lead) => <Badge status={lead.status} /> },
    { key: 'createdAt', label: 'Created', render: (lead: Lead) => <span className="text-sm text-muted-foreground">{new Date(lead.createdAt).toLocaleDateString()}</span> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{isAr ? "العملاء المحتملون" : "Leads"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage and track your prospects</p>
        </div>
        <Button icon={Plus} onClick={() => setShowModal(true)}>New Lead</Button>
      </div>

      <Card>
        {loading ? (
          <TableSkeleton />
        ) : leads.length === 0 && !pagination ? (
          <EmptyState icon={Users} title="No leads yet" description="Start by adding your first lead to begin tracking prospects." action={{ label: 'Add Lead', onClick: () => setShowModal(true) }} />
        ) : (
          <DataTable columns={columns} data={leads} pagination={pagination} onPageChange={setPage} searchable searchPlaceholder="Search leads..." />
        )}
      </Card>

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Create New Lead">
        <form onSubmit={handleCreate} className="space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>}
          <div className="grid grid-cols-2 gap-4">
            <Input label="Name" value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} required placeholder="Lead name" />
            <Input label="Email" type="email" value={formData.email} onChange={(e) => setFormData({...formData, email: e.target.value})} placeholder="email@example.com" />
            <Input label="Phone" value={formData.phone} onChange={(e) => setFormData({...formData, phone: e.target.value})} placeholder="+1 (555) 000-0000" />
            <Input label="Company" value={formData.company} onChange={(e) => setFormData({...formData, company: e.target.value})} placeholder="Company name" />
          </div>
          <Textarea label="Notes" value={formData.notes} onChange={(e) => setFormData({...formData, notes: e.target.value})} placeholder="Any additional notes..." rows={3} />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button type="submit" loading={submitting}>Create Lead</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
