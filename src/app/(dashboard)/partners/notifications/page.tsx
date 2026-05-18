'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/partners/api';
import type { PartnerNotification as Notification } from '@/lib/partners/types';
import { Card } from '@/components/partners/ui/card';
import { Button } from '@/components/partners/ui/button';
import { EmptyState } from '@/components/partners/ui/empty-state';
import { Skeleton } from '@/components/partners/ui/skeleton';
import { Bell, CheckCheck, Check } from 'lucide-react';
import { useLocale } from '@/lib/i18n';
import clsx from 'clsx';

export default function NotificationsPage() {
  const { locale } = useLocale()
  const isAr = locale === 'ar'
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNotifications = async () => {
    try {
      const res = await api.get<Notification[]>('/notifications?perPage=50');
      setNotifications(res.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchNotifications(); }, []);

  const markAsRead = async (id: string) => {
    await api.patch(`/notifications/${id}/read`, {});
    fetchNotifications();
  };

  const markAllRead = async () => {
    await api.patch('/notifications/read-all', {});
    fetchNotifications();
  };

  const unreadCount = notifications.filter(n => !n.isRead).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{isAr ? 'الإشعارات' : 'Notifications'}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {unreadCount > 0 ? `You have ${unreadCount} unread notification${unreadCount > 1 ? 's' : ''}` : 'You\'re all caught up'}
          </p>
        </div>
        {unreadCount > 0 && (
          <Button variant="secondary" icon={CheckCheck} onClick={markAllRead}>Mark All Read</Button>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <Card>
          <EmptyState icon={Bell} title={isAr ? 'لا توجد إشعارات' : 'No notifications'} description={isAr ? 'سترى الإشعارات هنا عند وجود تحديثات لعملائك أو صفقاتك أو عمولاتك.' : "You'll see notifications here when there are updates to your leads, deals, or commissions."} />
        </Card>
      ) : (
        <div className="space-y-3">
          {notifications.map((n) => (
            <Card key={n.id}>
              <div className={clsx(
                'flex items-start justify-between p-4',
                !n.isRead && 'bg-blue-50/50'
              )}>
                <div className="flex items-start gap-3">
                  <div className={clsx(
                    'w-2.5 h-2.5 rounded-full mt-1.5 shrink-0',
                    n.isRead ? 'bg-gray-200' : 'bg-blue-500'
                  )} />
                  <div>
                    <p className={clsx(
                      'text-sm',
                      n.isRead ? 'text-foreground' : 'text-foreground font-semibold'
                    )}>{n.title}</p>
                    <p className="text-sm text-muted-foreground mt-0.5">{n.message}</p>
                    <p className="text-xs text-muted-foreground mt-1.5">{new Date(n.createdAt).toLocaleString()}</p>
                  </div>
                </div>
                {!n.isRead && (
                  <Button variant="secondary" size="sm" icon={Check} onClick={() => markAsRead(n.id)}>Read</Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
