'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/partners/api';
import type { PaginationMeta } from '@/lib/partners/api';
import type { Partner } from '@/lib/partners/types';
import { DataTable } from '@/components/partners/ui/data-table';
import { Badge } from '@/components/partners/ui/badge';
import { Card } from '@/components/partners/ui/card';
import { Button } from '@/components/partners/ui/button';
import { Modal } from '@/components/partners/ui/modal';
import { Input } from '@/components/partners/ui/input';
import { EmptyState } from '@/components/partners/ui/empty-state';
import { TableSkeleton } from '@/components/partners/ui/skeleton';
import { StatCard } from '@/components/partners/ui/stat-card';
import { Users, UserPlus, UserCheck, UserX } from 'lucide-react';
import { useLocale } from '@/lib/i18n';

export default function AdminPartnersPage() {
  const { locale } = useLocale();
  const isAr = locale === 'ar';
  const [partners, setPartners] = useState<Partner[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', companyName: '', contactPhone: '', commissionRate: '10' });

  const fetchPartners = () => {
    setLoading(true);
    api.get<Partner[]>(`/partners?page=${page}&perPage=10`).then((res) => {
      setPartners(res.data);
      setPagination(res.meta?.pagination ?? null);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { fetchPartners(); }, [page]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      await api.post('/partners', {
        name: form.name,
        email: form.email,
        password: form.password,
        companyName: form.companyName,
        contactPhone: form.contactPhone || undefined,
        commissionRate: parseFloat(form.commissionRate),
      });
      setShowCreate(false);
      setForm({ name: '', email: '', password: '', companyName: '', contactPhone: '', commissionRate: '10' });
      fetchPartners();
    } catch {
      // handle error
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (partner: Partner) => {
    await api.patch(`/partners/${partner.id}`, { isActive: !partner.isActive });
    fetchPartners();
  };

  const activeCount = partners.filter(p => p.isActive).length;
  const inactiveCount = partners.filter(p => !p.isActive).length;

  const columns = [
    {
      key: 'company', label: 'Partner',
      render: (p: Partner) => (
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-violet-500 rounded-full flex items-center justify-center shrink-0">
            <span className="text-white text-sm font-semibold">{p.companyName.charAt(0)}</span>
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">{p.companyName}</p>
            <p className="text-xs text-muted-foreground">{p.user?.name} &middot; {p.user?.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'phone', label: 'Phone',
      render: (p: Partner) => <span className="text-sm text-muted-foreground">{p.contactPhone || '—'}</span>,
    },
    {
      key: 'commission', label: 'Commission Rate',
      render: (p: Partner) => <span className="text-sm font-semibold text-foreground">{p.commissionRate}%</span>,
    },
    {
      key: 'status', label: 'Status',
      render: (p: Partner) => <Badge status={p.isActive ? 'APPROVED' : 'REJECTED'} />,
    },
    {
      key: 'created', label: 'Joined',
      render: (p: Partner) => <span className="text-sm text-muted-foreground">{new Date(p.createdAt).toLocaleDateString()}</span>,
    },
    {
      key: 'actions', label: '',
      render: (p: Partner) => (
        <Button variant="ghost" size="sm" onClick={() => toggleActive(p)}>
          {p.isActive ? 'Deactivate' : 'Activate'}
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{isAr ? 'الشركاء' : 'Partners'}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{isAr ? 'إدارة حسابات الشركاء ونسب العمولات' : 'Manage partner accounts and commission rates'}</p>
        </div>
        <Button icon={UserPlus} onClick={() => setShowCreate(true)}>{isAr ? 'إضافة شريك' : 'Add Partner'}</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard title={isAr ? 'إجمالي الشركاء' : 'Total Partners'} value={partners.length} icon={Users} color="blue" />
        <StatCard title={isAr ? 'نشط' : 'Active'} value={activeCount} icon={UserCheck} color="green" />
        <StatCard title={isAr ? 'غير نشط' : 'Inactive'} value={inactiveCount} icon={UserX} color="orange" />
      </div>

      <Card>
        {loading ? (
          <TableSkeleton />
        ) : partners.length === 0 && !pagination ? (
          <EmptyState icon={Users} title="No partners yet" description="Add your first partner to get started." action={{ label: 'Add Partner', onClick: () => setShowCreate(true) }} />
        ) : (
          <DataTable columns={columns} data={partners} pagination={pagination} onPageChange={setPage} searchable searchPlaceholder="Search partners..." />
        )}
      </Card>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Add New Partner" size="lg">
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Full Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <Input label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </div>
          <Input label="Password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Company Name" value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} required />
            <Input label="Phone" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} />
          </div>
          <Input label="Commission Rate (%)" type="number" value={form.commissionRate} onChange={(e) => setForm({ ...form, commissionRate: e.target.value })} required />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button type="submit" loading={creating}>Create Partner</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
