'use client';
import { useState } from 'react';
import { useAuth } from '@/lib/partners/auth-compat';
import { api } from '@/lib/partners/api';
import { Card, CardHeader, CardContent } from '@/components/partners/ui/card';
import { Button } from '@/components/partners/ui/button';
import { Input } from '@/components/partners/ui/input';
import { Badge } from '@/components/partners/ui/badge';
import { Modal } from '@/components/partners/ui/modal';
import { Skeleton } from '@/components/partners/ui/skeleton';
import { Pencil, User, Building2, Shield } from 'lucide-react';
import { useLocale } from '@/lib/i18n';

export default function SettingsPage() {
  const { locale } = useLocale()
  const isAr = locale === 'ar'
  const { user, loading } = useAuth();
  const [showEditModal, setShowEditModal] = useState(false);
  const [formData, setFormData] = useState({ name: '', email: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const openEditModal = () => {
    if (user) {
      setFormData({ name: user.name, email: user.email });
    }
    setShowEditModal(true);
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api.patch('/auth/profile', formData);
      setShowEditModal(false);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{isAr ? 'الإعدادات' : 'Settings'}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage your account and preferences</p>
        </div>
        <Button variant="secondary" icon={Pencil} onClick={openEditModal}>Edit Profile</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">Personal Information</h3>
            </div>
          </CardHeader>
          <CardContent>
            <dl className="space-y-4">
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Full Name</dt>
                <dd className="mt-1 text-sm text-foreground">{user?.name}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Email Address</dt>
                <dd className="mt-1 text-sm text-foreground">{user?.email}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{isAr ? 'الدور' : 'Role'}</dt>
                <dd className="mt-1"><Badge status={user?.role || 'PARTNER'} /></dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        {(user?.companyName || user?.commissionRate !== undefined) && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold text-foreground">Partner Details</h3>
              </div>
            </CardHeader>
            <CardContent>
              <dl className="space-y-4">
                {user?.companyName && (
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Company Name</dt>
                    <dd className="mt-1 text-sm text-foreground">{user.companyName}</dd>
                  </div>
                )}
                {user?.commissionRate !== undefined && (
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Commission Rate</dt>
                    <dd className="mt-1 text-sm text-foreground font-semibold">{user.commissionRate}%</dd>
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">Security</h3>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">To change your password or update security settings, please contact your administrator.</p>
          </CardContent>
        </Card>
      </div>

      <Modal open={showEditModal} onClose={() => setShowEditModal(false)} title={isAr ? 'تعديل الملف الشخصي' : 'Edit Profile'}>
        <form onSubmit={handleUpdate} className="space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>}
          <Input label="Full Name" value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} required placeholder="Your name" />
          <Input label="Email Address" type="email" value={formData.email} onChange={(e) => setFormData({...formData, email: e.target.value})} required placeholder="email@example.com" />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={() => setShowEditModal(false)}>Cancel</Button>
            <Button type="submit" loading={submitting}>Save Changes</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
