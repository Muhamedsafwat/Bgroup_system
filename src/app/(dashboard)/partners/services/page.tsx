'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/partners/api';
import type { PaginationMeta } from '@/lib/partners/api';
import type { Service } from '@/lib/partners/types';
import { DataTable } from '@/components/partners/ui/data-table';
import { Badge } from '@/components/partners/ui/badge';
import { Button } from '@/components/partners/ui/button';
import { Input, Textarea } from '@/components/partners/ui/input';
import { Modal } from '@/components/partners/ui/modal';
import { Card } from '@/components/partners/ui/card';
import { EmptyState } from '@/components/partners/ui/empty-state';
import { TableSkeleton } from '@/components/partners/ui/skeleton';
import { Plus, Package } from 'lucide-react';
import { useLocale } from '@/lib/i18n';
import { useAuth } from '@/lib/partners/auth-compat';

export default function ServicesPage() {
  const { locale } = useLocale();
  const isAr = locale === 'ar';
  const { user } = useAuth();
  const [services, setServices] = useState<Service[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({ name: '', description: '', basePrice: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const fetchServices = async (p: number) => {
    try {
      const res = await api.get<Service[]>(`/services?page=${p}&perPage=10`);
      setServices(res.data);
      setPagination(res.meta?.pagination ?? null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchServices(page); }, [page]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api.post('/services', { ...formData, basePrice: parseFloat(formData.basePrice) });
      setShowModal(false);
      setFormData({ name: '', description: '', basePrice: '' });
      fetchServices(page);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create service');
    } finally {
      setSubmitting(false);
    }
  };

  const columns = [
    {
      key: 'name', label: 'Service',
      render: (s: Service) => (
        <div>
          <p className="text-sm font-medium text-foreground">{s.name}</p>
          {s.description && <p className="text-xs text-muted-foreground line-clamp-1">{s.description}</p>}
        </div>
      ),
    },
    {
      key: 'basePrice', label: 'Base Price',
      render: (s: Service) => <span className="text-sm font-semibold text-foreground">${s.basePrice.toLocaleString()}</span>,
    },
    {
      key: 'isActive', label: 'Status',
      render: (s: Service) => <Badge status={s.isActive ? 'ACTIVE' : 'INACTIVE'} />,
    },
    {
      key: 'createdAt', label: 'Created',
      render: (s: Service) => <span className="text-sm text-muted-foreground">{new Date(s.createdAt).toLocaleDateString()}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{isAr ? "الخدمات" : "Services"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Browse available services and pricing</p>
        </div>
        {user?.role === 'ADMIN' && (
          <Button icon={Plus} onClick={() => setShowModal(true)}>New Service</Button>
        )}
      </div>

      <Card>
        {loading ? (
          <TableSkeleton />
        ) : services.length === 0 && !pagination ? (
          <EmptyState
            icon={Package}
            title="No services yet"
            description="Services will be listed here once they are created."
            action={user?.role === 'ADMIN' ? { label: 'Add Service', onClick: () => setShowModal(true) } : undefined}
          />
        ) : (
          <DataTable columns={columns} data={services} pagination={pagination} onPageChange={setPage} searchable searchPlaceholder="Search services..." />
        )}
      </Card>

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Create New Service">
        <form onSubmit={handleCreate} className="space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>}
          <Input label="Name" value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} required placeholder="Service name" />
          <Textarea label="Description" value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})} placeholder="Describe the service..." rows={3} />
          <Input label="Base Price" type="number" step="0.01" min="0" value={formData.basePrice} onChange={(e) => setFormData({...formData, basePrice: e.target.value})} required placeholder="0.00" />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button type="submit" loading={submitting}>Create Service</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
