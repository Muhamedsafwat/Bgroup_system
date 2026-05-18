'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/partners/api';
import type { PaginationMeta } from '@/lib/partners/api';
import type { Invoice } from '@/lib/partners/types';
import { DataTable } from '@/components/partners/ui/data-table';
import { Badge } from '@/components/partners/ui/badge';
import { Card } from '@/components/partners/ui/card';
import { Button } from '@/components/partners/ui/button';
import { Modal } from '@/components/partners/ui/modal';
import { EmptyState } from '@/components/partners/ui/empty-state';
import { TableSkeleton } from '@/components/partners/ui/skeleton';
import { Textarea } from '@/components/partners/ui/input';
import { Receipt, Check, X } from 'lucide-react';
import { useLocale } from '@/lib/i18n';

export default function AdminInvoicesPage() {
  const { locale } = useLocale();
  const isAr = locale === 'ar';
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [reviewModal, setReviewModal] = useState<{ invoice: Invoice; action: 'APPROVED' | 'REJECTED' } | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchInvoices = () => {
    setLoading(true);
    api.get<Invoice[]>(`/invoices?page=${page}&perPage=10`).then((res) => {
      setInvoices(res.data);
      setPagination(res.meta?.pagination ?? null);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { fetchInvoices(); }, [page]);

  const handleReview = async () => {
    if (!reviewModal) return;
    setSubmitting(true);
    try {
      await api.patch(`/invoices/${reviewModal.invoice.id}/review`, {
        status: reviewModal.action,
        rejectionReason: reviewModal.action === 'REJECTED' ? rejectionReason : undefined,
      });
      setReviewModal(null);
      setRejectionReason('');
      fetchInvoices();
    } catch {
      // handle error
    } finally {
      setSubmitting(false);
    }
  };

  const columns = [
    {
      key: 'deal', label: 'Client / Service',
      render: (inv: Invoice) => (
        <div>
          <p className="text-sm font-medium text-foreground">{inv.deal?.client?.name || '—'}</p>
          <p className="text-xs text-muted-foreground">{inv.deal?.service?.name || '—'}</p>
        </div>
      ),
    },
    {
      key: 'amount', label: 'Amount',
      render: (inv: Invoice) => <span className="text-sm font-semibold text-foreground">${inv.amount.toLocaleString()}</span>,
    },
    { key: 'status', label: 'Status', render: (inv: Invoice) => <Badge status={inv.status} /> },
    {
      key: 'createdAt', label: 'Requested',
      render: (inv: Invoice) => <span className="text-sm text-muted-foreground">{new Date(inv.createdAt).toLocaleDateString()}</span>,
    },
    {
      key: 'actions', label: '',
      render: (inv: Invoice) => inv.status === 'REQUESTED' ? (
        <div className="flex items-center gap-2">
          <Button variant="primary" size="sm" icon={Check} onClick={() => setReviewModal({ invoice: inv, action: 'APPROVED' })}>Approve</Button>
          <Button variant="danger" size="sm" icon={X} onClick={() => setReviewModal({ invoice: inv, action: 'REJECTED' })}>Reject</Button>
        </div>
      ) : inv.pdfUrl ? (
        <a href={inv.pdfUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:text-blue-700 font-medium">Download</a>
      ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{isAr ? "الفواتير" : "Invoices"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Review and manage partner invoice requests</p>
      </div>

      <Card>
        {loading ? (
          <TableSkeleton />
        ) : invoices.length === 0 && !pagination ? (
          <EmptyState icon={Receipt} title="No invoices" description="Invoice requests from partners will appear here." />
        ) : (
          <DataTable columns={columns} data={invoices} pagination={pagination} onPageChange={setPage} searchable searchPlaceholder="Search invoices..." />
        )}
      </Card>

      <Modal open={!!reviewModal} onClose={() => { setReviewModal(null); setRejectionReason(''); }} title={reviewModal?.action === 'APPROVED' ? 'Approve Invoice' : 'Reject Invoice'}>
        <div className="space-y-4">
          {reviewModal && (
            <div className="p-4 bg-muted/50 rounded-xl">
              <p className="text-sm text-muted-foreground">Client: <span className="font-medium text-foreground">{reviewModal.invoice.deal?.client?.name}</span></p>
              <p className="text-sm text-muted-foreground">Amount: <span className="font-medium text-foreground">${reviewModal.invoice.amount.toLocaleString()}</span></p>
            </div>
          )}
          {reviewModal?.action === 'REJECTED' && (
            <Textarea label="Rejection Reason" value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} placeholder="Explain why this invoice is being rejected..." required />
          )}
          {reviewModal?.action === 'APPROVED' && (
            <p className="text-sm text-muted-foreground">Are you sure you want to approve this invoice?</p>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => { setReviewModal(null); setRejectionReason(''); }}>Cancel</Button>
            <Button variant={reviewModal?.action === 'APPROVED' ? 'primary' : 'danger'} loading={submitting} onClick={handleReview}>
              {reviewModal?.action === 'APPROVED' ? 'Approve' : 'Reject'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
