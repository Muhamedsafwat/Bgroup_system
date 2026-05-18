'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/partners/api';
import type { PaginationMeta } from '@/lib/partners/api';
import type { Contract } from '@/lib/partners/types';
import { DataTable } from '@/components/partners/ui/data-table';
import { Badge } from '@/components/partners/ui/badge';
import { Card } from '@/components/partners/ui/card';
import { EmptyState } from '@/components/partners/ui/empty-state';
import { TableSkeleton } from '@/components/partners/ui/skeleton';
import { FileText } from 'lucide-react';
import { useLocale } from '@/lib/i18n';

export default function ContractsPage() {
  const { locale } = useLocale();
  const isAr = locale === 'ar';
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<Contract[]>(`/contracts?page=${page}&perPage=10`).then((res) => {
      setContracts(res.data);
      setPagination(res.meta?.pagination ?? null);
    }).finally(() => setLoading(false));
  }, [page]);

  const columns = [
    {
      key: 'deal', label: 'Client',
      render: (c: Contract) => (
        <div>
          <p className="text-sm font-medium text-foreground">{c.deal?.client?.name || '—'}</p>
          <p className="text-xs text-muted-foreground">{c.deal?.service?.name || '—'}</p>
        </div>
      ),
    },
    {
      key: 'value', label: 'Deal Value',
      render: (c: Contract) => <span className="text-sm font-semibold text-foreground">${(c.deal?.value || 0).toLocaleString()}</span>,
    },
    { key: 'status', label: 'Status', render: (c: Contract) => <Badge status={c.status} /> },
    {
      key: 'createdAt', label: 'Requested',
      render: (c: Contract) => <span className="text-sm text-muted-foreground">{new Date(c.createdAt).toLocaleDateString()}</span>,
    },
    {
      key: 'pdf', label: '',
      render: (c: Contract) => c.pdfUrl ? (
        <a href={c.pdfUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:text-blue-700 font-medium">Download</a>
      ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{isAr ? "العقود" : "Contracts"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">View and track your contract requests</p>
      </div>

      <Card>
        {loading ? (
          <TableSkeleton />
        ) : contracts.length === 0 && !pagination ? (
          <EmptyState icon={FileText} title="No contracts yet" description="Contracts will appear here when you request them from won deals." />
        ) : (
          <DataTable columns={columns} data={contracts} pagination={pagination} onPageChange={setPage} searchable searchPlaceholder="Search contracts..." />
        )}
      </Card>
    </div>
  );
}
