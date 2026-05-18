'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/partners/api';
import type { PaginationMeta } from '@/lib/partners/api';
import type { Deal, Client, Service } from '@/lib/partners/types';
import { DataTable } from '@/components/partners/ui/data-table';
import { Badge } from '@/components/partners/ui/badge';
import { Button } from '@/components/partners/ui/button';
import { Input, Textarea } from '@/components/partners/ui/input';
import { Modal } from '@/components/partners/ui/modal';
import { Card } from '@/components/partners/ui/card';
import { EmptyState } from '@/components/partners/ui/empty-state';
import { TableSkeleton } from '@/components/partners/ui/skeleton';
import { Plus, HandCoins, List, Kanban as KanbanIcon } from 'lucide-react';
import { useLocale } from '@/lib/i18n';
import Link from 'next/link';
import { DealKanban } from '@/components/partners/deals/DealKanban';

export default function DealsPage() {
  const { locale } = useLocale();
  const isAr = locale === 'ar';
  const [deals, setDeals] = useState<Deal[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [formData, setFormData] = useState({ clientId: '', serviceId: '', value: '', notes: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [view, setView] = useState<'table' | 'kanban'>('table');

  const fetchDeals = async (p: number) => {
    try {
      // Pull a larger page in kanban view so all stages have cards visible.
      const perPage = view === 'kanban' ? 100 : 10;
      const res = await api.get<Deal[]>(`/deals?page=${p}&perPage=${perPage}`);
      setDeals(res.data);
      setPagination(res.meta?.pagination ?? null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchDeals(page); }, [page, view]);

  const openModal = async () => {
    const [c, s] = await Promise.all([
      api.get<Client[]>('/clients?perPage=100'),
      api.get<Service[]>('/services?perPage=100'),
    ]);
    setClients(c.data);
    setServices(s.data);
    setShowModal(true);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api.post('/deals', { ...formData, value: parseFloat(formData.value) });
      setShowModal(false);
      setFormData({ clientId: '', serviceId: '', value: '', notes: '' });
      fetchDeals(page);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create deal');
    } finally {
      setSubmitting(false);
    }
  };

  const columns = [
    {
      key: 'client', label: 'Client',
      render: (d: Deal) => (
        <Link href={`/partners/deals/${d.id}`} className="group">
          <p className="text-sm font-medium text-foreground group-hover:text-blue-600 transition-colors">{d.client?.name || '—'}</p>
          <p className="text-xs text-muted-foreground">{d.service?.name || '—'}</p>
        </Link>
      ),
    },
    {
      key: 'value', label: 'Value',
      render: (d: Deal) => <span className="text-sm font-semibold text-foreground">${d.value.toLocaleString()}</span>,
    },
    { key: 'status', label: 'Status', render: (d: Deal) => <Badge status={d.status} /> },
    { key: 'createdAt', label: 'Created', render: (d: Deal) => <span className="text-sm text-muted-foreground">{new Date(d.createdAt).toLocaleDateString()}</span> },
    {
      key: 'actions', label: '',
      render: (d: Deal) => (
        <Link href={`/partners/deals/${d.id}`} className="text-sm text-blue-600 hover:text-blue-700 font-medium">View</Link>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{isAr ? "الصفقات" : "Deals"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Track and manage your deals pipeline</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border rounded-lg">
            <Button
              variant={view === 'table' ? 'primary' : 'secondary'}
              icon={List}
              onClick={() => setView('table')}
              className="rounded-e-none"
            >
              <span className="sr-only">Table view</span>
            </Button>
            <Button
              variant={view === 'kanban' ? 'primary' : 'secondary'}
              icon={KanbanIcon}
              onClick={() => setView('kanban')}
              className="rounded-s-none"
            >
              <span className="sr-only">Kanban view</span>
            </Button>
          </div>
          <Button icon={Plus} onClick={openModal}>New Deal</Button>
        </div>
      </div>

      <Card>
        {loading ? (
          <TableSkeleton />
        ) : deals.length === 0 && !pagination ? (
          <EmptyState icon={HandCoins} title="No deals yet" description="Create your first deal to start tracking your pipeline." action={{ label: 'Create Deal', onClick: openModal }} />
        ) : view === 'kanban' ? (
          <DealKanban deals={deals} onChange={() => fetchDeals(page)} />
        ) : (
          <DataTable columns={columns} data={deals} pagination={pagination} onPageChange={setPage} searchable searchPlaceholder="Search deals..." />
        )}
      </Card>

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Create New Deal">
        <form onSubmit={handleCreate} className="space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Client</label>
              <select value={formData.clientId} onChange={(e) => setFormData({...formData, clientId: e.target.value})} required className="block w-full px-3 py-2 border border-border rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
                <option value="">Select client...</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Service</label>
              <select value={formData.serviceId} onChange={(e) => setFormData({...formData, serviceId: e.target.value})} required className="block w-full px-3 py-2 border border-border rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
                <option value="">Select service...</option>
                {services.map(s => <option key={s.id} value={s.id}>{s.name} (${s.basePrice})</option>)}
              </select>
            </div>
          </div>
          <Input label="Deal Value" type="number" step="0.01" min="0" value={formData.value} onChange={(e) => setFormData({...formData, value: e.target.value})} required placeholder="0.00" />
          <Textarea label="Notes" value={formData.notes} onChange={(e) => setFormData({...formData, notes: e.target.value})} placeholder="Any additional notes..." rows={3} />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button type="submit" loading={submitting}>Create Deal</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
