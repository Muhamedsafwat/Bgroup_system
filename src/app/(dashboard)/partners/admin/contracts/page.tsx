'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/partners/api';
import type { PaginationMeta } from '@/lib/partners/api';
import type { Contract } from '@/lib/partners/types';
import { DataTable } from '@/components/partners/ui/data-table';
import { Badge } from '@/components/partners/ui/badge';
import { Card } from '@/components/partners/ui/card';
import { Button } from '@/components/partners/ui/button';
import { Modal } from '@/components/partners/ui/modal';
import { EmptyState } from '@/components/partners/ui/empty-state';
import { TableSkeleton } from '@/components/partners/ui/skeleton';
import { Textarea } from '@/components/partners/ui/input';
import { FileText, Check, X } from 'lucide-react';
import { useLocale } from '@/lib/i18n';

export default function AdminContractsPage() {
  const { locale } = useLocale();
  const isAr = locale === 'ar';
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [reviewModal, setReviewModal] = useState<{ contract: Contract; action: 'APPROVED' | 'REJECTED' } | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchContracts = () => {
    setLoading(true);
    api.get<Contract[]>(`/contracts?page=${page}&perPage=10`).then((res) => {
      setContracts(res.data);
      setPagination(res.meta?.pagination ?? null);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { fetchContracts(); }, [page]);

  const handleReview = async () => {
    if (!reviewModal) return;
    setSubmitting(true);
    try {
      await api.patch(`/contracts/${reviewModal.contract.id}/review`, {
        status: reviewModal.action,
        rejectionReason: reviewModal.action === 'REJECTED' ? rejectionReason : undefined,
      });
      setReviewModal(null);
      setRejectionReason('');
      fetchContracts();
    } catch {
      // handle error
    } finally {
      setSubmitting(false);
    }
  };

  const columns = [
    {
      key: 'deal', label: 'Client / Service',
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
      key: 'actions', label: '',
      render: (c: Contract) => c.status === 'REQUESTED' ? (
        <div className="flex items-center gap-2">
          <Button variant="primary" size="sm" icon={Check} onClick={() => setReviewModal({ contract: c, action: 'APPROVED' })}>Approve</Button>
          <Button variant="danger" size="sm" icon={X} onClick={() => setReviewModal({ contract: c, action: 'REJECTED' })}>Reject</Button>
        </div>
      ) : c.pdfUrl ? (
        <a href={c.pdfUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:text-blue-700 font-medium">Download</a>
      ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{isAr ? "العقود" : "Contracts"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Review and manage partner contract requests</p>
      </div>

      <Card>
        {loading ? (
          <TableSkeleton />
        ) : contracts.length === 0 && !pagination ? (
          <EmptyState icon={FileText} title="No contracts" description="Contract requests from partners will appear here." />
        ) : (
          <DataTable columns={columns} data={contracts} pagination={pagination} onPageChange={setPage} searchable searchPlaceholder="Search contracts..." />
        )}
      </Card>

      <Modal open={!!reviewModal} onClose={() => { setReviewModal(null); setRejectionReason(''); }} title={reviewModal?.action === 'APPROVED' ? 'Approve Contract' : 'Reject Contract'}>
        <div className="space-y-4">
          {reviewModal && (
            <div className="p-4 bg-muted/50 rounded-xl">
              <p className="text-sm text-muted-foreground">Client: <span className="font-medium text-foreground">{reviewModal.contract.deal?.client?.name}</span></p>
              <p className="text-sm text-muted-foreground">Value: <span className="font-medium text-foreground">${(reviewModal.contract.deal?.value || 0).toLocaleString()}</span></p>
            </div>
          )}
          {reviewModal?.action === 'REJECTED' && (
            <Textarea label="Rejection Reason" value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} placeholder="Explain why this contract is being rejected..." required />
          )}
          {reviewModal?.action === 'APPROVED' && (
            <p className="text-sm text-muted-foreground">Are you sure you want to approve this contract?</p>
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
