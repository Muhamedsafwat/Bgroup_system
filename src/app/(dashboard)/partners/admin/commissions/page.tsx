'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/partners/api';
import type { PaginationMeta } from '@/lib/partners/api';
import type { Commission } from '@/lib/partners/types';
import { DataTable } from '@/components/partners/ui/data-table';
import { Badge } from '@/components/partners/ui/badge';
import { Card, CardHeader, CardContent } from '@/components/partners/ui/card';
import { Button } from '@/components/partners/ui/button';
import { EmptyState } from '@/components/partners/ui/empty-state';
import { TableSkeleton } from '@/components/partners/ui/skeleton';
import { StatCard } from '@/components/partners/ui/stat-card';
import { DollarSign, Clock, CheckCircle, Banknote } from 'lucide-react';
import { useLocale } from '@/lib/i18n';

export default function AdminCommissionsPage() {
  const { locale } = useLocale();
  const isAr = locale === 'ar';
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<{ totalAmount: number; totalCommissions: number; byStatus: { status: string; count: number; totalAmount: number }[] } | null>(null);

  const fetchCommissions = () => {
    setLoading(true);
    Promise.all([
      api.get<Commission[]>(`/commissions?page=${page}&perPage=10`),
      api.get<{ totalAmount: number; totalCommissions: number; byStatus: { status: string; count: number; totalAmount: number }[] }>('/commissions/summary'),
    ]).then(([commRes, sumRes]) => {
      setCommissions(commRes.data);
      setPagination(commRes.meta?.pagination ?? null);
      setSummary(sumRes.data);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { fetchCommissions(); }, [page]);

  const updateStatus = async (id: string, status: string) => {
    await api.patch(`/commissions/${id}`, { status });
    fetchCommissions();
  };

  const getStatusAmount = (status: string) => summary?.byStatus.find(s => s.status === status)?.totalAmount ?? 0;
  const getStatusCount = (status: string) => summary?.byStatus.find(s => s.status === status)?.count ?? 0;

  const columns = [
    {
      key: 'partner', label: 'Partner',
      render: (c: Commission) => (
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-violet-50 rounded-full flex items-center justify-center">
            <span className="text-xs font-semibold text-violet-600">{c.partner?.companyName?.charAt(0) || '?'}</span>
          </div>
          <span className="text-sm font-medium text-foreground">{c.partner?.companyName || '—'}</span>
        </div>
      ),
    },
    {
      key: 'deal', label: 'Deal Value',
      render: (c: Commission) => <span className="text-sm text-muted-foreground">${(c.deal?.value || 0).toLocaleString()}</span>,
    },
    {
      key: 'rate', label: 'Rate',
      render: (c: Commission) => <span className="text-sm text-muted-foreground">{c.rate}%</span>,
    },
    {
      key: 'amount', label: 'Commission',
      render: (c: Commission) => <span className="text-sm font-semibold text-foreground">${c.amount.toLocaleString()}</span>,
    },
    { key: 'status', label: 'Status', render: (c: Commission) => <Badge status={c.status} /> },
    {
      key: 'createdAt', label: 'Date',
      render: (c: Commission) => <span className="text-sm text-muted-foreground">{new Date(c.createdAt).toLocaleDateString()}</span>,
    },
    {
      key: 'actions', label: '',
      render: (c: Commission) => {
        if (c.status === 'PENDING') return <Button variant="primary" size="sm" onClick={() => updateStatus(c.id, 'APPROVED')}>Approve</Button>;
        if (c.status === 'APPROVED') return <Button variant="primary" size="sm" icon={Banknote} onClick={() => updateStatus(c.id, 'PAID')}>Mark Paid</Button>;
        return null;
      },
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{isAr ? 'العمولات' : 'Commissions'}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{isAr ? 'تتبع وإدارة دفعات عمولات الشركاء' : 'Track and manage partner commission payouts'}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard title={isAr ? 'إجمالي العمولات' : 'Total Commissions'} value={`$${(summary?.totalAmount ?? 0).toLocaleString()}`} subtitle={isAr ? `${summary?.totalCommissions ?? 0} إجمالًا` : `${summary?.totalCommissions ?? 0} total`} icon={DollarSign} color="blue" />
        <StatCard title={isAr ? 'قيد الانتظار' : 'Pending'} value={`$${getStatusAmount('PENDING').toLocaleString()}`} subtitle={isAr ? `${getStatusCount('PENDING')} قيد الانتظار` : `${getStatusCount('PENDING')} pending`} icon={Clock} color="orange" />
        <StatCard title={isAr ? 'معتمد' : 'Approved'} value={`$${getStatusAmount('APPROVED').toLocaleString()}`} subtitle={isAr ? `${getStatusCount('APPROVED')} معتمد` : `${getStatusCount('APPROVED')} approved`} icon={CheckCircle} color="green" />
        <StatCard title={isAr ? 'مدفوع' : 'Paid'} value={`$${getStatusAmount('PAID').toLocaleString()}`} subtitle={isAr ? `${getStatusCount('PAID')} مدفوع` : `${getStatusCount('PAID')} paid`} icon={Banknote} color="purple" />
      </div>

      <Card>
        {loading ? (
          <TableSkeleton />
        ) : commissions.length === 0 && !pagination ? (
          <EmptyState icon={DollarSign} title="No commissions" description="Commissions are automatically created when deals are won." />
        ) : (
          <DataTable columns={columns} data={commissions} pagination={pagination} onPageChange={setPage} searchable searchPlaceholder="Search commissions..." />
        )}
      </Card>
    </div>
  );
}
