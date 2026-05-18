'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/partners/api';
import type { PaginationMeta } from '@/lib/partners/api';
import type { Invoice } from '@/lib/partners/types';
import { DataTable } from '@/components/partners/ui/data-table';
import { Badge } from '@/components/partners/ui/badge';
import { Card } from '@/components/partners/ui/card';
import { EmptyState } from '@/components/partners/ui/empty-state';
import { TableSkeleton } from '@/components/partners/ui/skeleton';
import { Receipt } from 'lucide-react';
import { useLocale } from '@/lib/i18n';

export default function InvoicesPage() {
  const { locale } = useLocale();
  const isAr = locale === 'ar';
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<Invoice[]>(`/invoices?page=${page}&perPage=10`).then((res) => {
      setInvoices(res.data);
      setPagination(res.meta?.pagination ?? null);
    }).finally(() => setLoading(false));
  }, [page]);

  const columns = [
    {
      key: 'deal', label: 'Client',
      render: (i: Invoice) => (
        <div>
          <p className="text-sm font-medium text-foreground">{i.deal?.client?.name || '—'}</p>
          <p className="text-xs text-muted-foreground">{i.deal?.service?.name || '—'}</p>
        </div>
      ),
    },
    {
      key: 'amount', label: 'Amount',
      render: (i: Invoice) => <span className="text-sm font-semibold text-foreground">${i.amount.toLocaleString()}</span>,
    },
    { key: 'status', label: 'Status', render: (i: Invoice) => <Badge status={i.status} /> },
    {
      key: 'createdAt', label: 'Requested',
      render: (i: Invoice) => <span className="text-sm text-muted-foreground">{new Date(i.createdAt).toLocaleDateString()}</span>,
    },
    {
      key: 'pdf', label: '',
      render: (i: Invoice) => i.pdfUrl ? (
        <a href={i.pdfUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:text-blue-700 font-medium">Download</a>
      ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{isAr ? "الفواتير" : "Invoices"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">View and track your invoice requests</p>
      </div>

      <Card>
        {loading ? (
          <TableSkeleton />
        ) : invoices.length === 0 && !pagination ? (
          <EmptyState icon={Receipt} title="No invoices yet" description="Invoices will appear here when you request them from won deals." />
        ) : (
          <DataTable columns={columns} data={invoices} pagination={pagination} onPageChange={setPage} searchable searchPlaceholder="Search invoices..." />
        )}
      </Card>
    </div>
  );
}
