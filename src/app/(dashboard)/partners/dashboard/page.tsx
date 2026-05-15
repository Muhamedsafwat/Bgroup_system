'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/partners/api';
import { useAuth } from '@/lib/partners/auth-compat';
import type { Lead, Deal } from '@/lib/partners/types';
import { StatCard } from '@/components/partners/ui/stat-card';
import { Card, CardHeader, CardContent } from '@/components/partners/ui/card';
import { Badge } from '@/components/partners/ui/badge';
import { DashboardSkeleton } from '@/components/partners/ui/skeleton';
import { Users, Handshake, DollarSign, TrendingUp, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { WelcomeBanner, firstNameOf } from '@/components/shared/WelcomeHero';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';

const PIE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'];

export default function DashboardPage() {
  const { user } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [commissionSummary, setCommissionSummary] = useState<{ totalAmount: number; totalCommissions: number; byStatus: { status: string; count: number; totalAmount: number }[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [leadsRes, dealsRes, commRes] = await Promise.all([
          api.get<Lead[]>('/leads?perPage=5'),
          api.get<Deal[]>('/deals?perPage=50'),
          api.get<{ totalAmount: number; totalCommissions: number; byStatus: { status: string; count: number; totalAmount: number }[] }>('/commissions/summary'),
        ]);
        setLeads(leadsRes.data);
        setDeals(dealsRes.data);
        setCommissionSummary(commRes.data);
      } catch {
        // Silent fail on dashboard
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) return <DashboardSkeleton />;

  const totalDeals = deals.length;
  const wonDeals = deals.filter(d => d.status === 'WON').length;
  const totalPipeline = deals.filter(d => d.status === 'PENDING').reduce((sum, d) => sum + d.value, 0);

  const dealStatusData = [
    { name: 'Pending', value: deals.filter(d => d.status === 'PENDING').length },
    { name: 'Won', value: deals.filter(d => d.status === 'WON').length },
    { name: 'Lost', value: deals.filter(d => d.status === 'LOST').length },
  ].filter(d => d.value > 0);

  const monthlyData = deals.reduce((acc, deal) => {
    const month = new Date(deal.createdAt).toLocaleString('default', { month: 'short' });
    const existing = acc.find(m => m.month === month);
    if (existing) {
      existing.value += deal.value;
      existing.count += 1;
    } else {
      acc.push({ month, value: deal.value, count: 1 });
    }
    return acc;
  }, [] as { month: string; value: number; count: number }[]);

  return (
    <div className="space-y-8">
      <WelcomeBanner
        firstName={firstNameOf(user?.name, user?.email)}
        rolePill="Partner"
        pillTone="emerald"
        email={user?.email}
        subtitle="Here’s what’s happening with your business today"
      />

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Leads"
          value={leads.length}
          subtitle="Active prospects"
          icon={Users}
          color="blue"
        />
        <StatCard
          title="Won Deals"
          value={wonDeals}
          subtitle={`of ${totalDeals} total`}
          icon={Handshake}
          color="green"
        />
        <StatCard
          title="Pipeline Value"
          value={`$${totalPipeline.toLocaleString()}`}
          subtitle="Pending deals"
          icon={TrendingUp}
          color="orange"
        />
        <StatCard
          title="Commissions"
          value={`$${(commissionSummary?.totalAmount ?? 0).toLocaleString()}`}
          subtitle={`${commissionSummary?.totalCommissions ?? 0} total`}
          icon={DollarSign}
          color="purple"
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Bar Chart */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <h3 className="text-base font-semibold text-foreground">Deal Value Overview</h3>
          </CardHeader>
          <CardContent>
            {monthlyData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="#9ca3af" />
                  <YAxis tick={{ fontSize: 12 }} stroke="#9ca3af" tickFormatter={(v) => `$${v / 1000}k`} />
                  <Tooltip
                    contentStyle={{ borderRadius: '12px', border: '1px solid #e5e7eb', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)' }}
                    formatter={(value) => [`$${Number(value).toLocaleString()}`, 'Value']}
                  />
                  <Bar dataKey="value" fill="#3b82f6" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[280px] flex items-center justify-center text-muted-foreground text-sm">No deal data yet</div>
            )}
          </CardContent>
        </Card>

        {/* Pie Chart */}
        <Card>
          <CardHeader>
            <h3 className="text-base font-semibold text-foreground">Deal Status</h3>
          </CardHeader>
          <CardContent>
            {dealStatusData.length > 0 ? (
              <div className="flex flex-col items-center">
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={dealStatusData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4} dataKey="value">
                      {dealStatusData.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: '12px', border: '1px solid #e5e7eb' }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex gap-4 mt-2">
                  {dealStatusData.map((d, i) => (
                    <div key={d.name} className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: PIE_COLORS[i] }} />
                      <span className="text-xs text-muted-foreground">{d.name} ({d.value})</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">No data</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Leads */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <h3 className="text-base font-semibold text-foreground">Recent Leads</h3>
            <Link href="/leads" className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
              View all <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-gray-50">
              {leads.slice(0, 5).map((lead) => (
                <Link key={lead.id} href={`/partners/leads/${lead.id}`} className="flex items-center justify-between px-6 py-3.5 hover:bg-muted/30 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-blue-50 rounded-full flex items-center justify-center">
                      <span className="text-sm font-semibold text-blue-600">{lead.name.charAt(0)}</span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{lead.name}</p>
                      <p className="text-xs text-muted-foreground">{lead.company || lead.email || 'No details'}</p>
                    </div>
                  </div>
                  <Badge status={lead.status} />
                </Link>
              ))}
              {leads.length === 0 && (
                <div className="px-6 py-8 text-center text-sm text-muted-foreground">No leads yet</div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Recent Deals */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <h3 className="text-base font-semibold text-foreground">Recent Deals</h3>
            <Link href="/deals" className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
              View all <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-gray-50">
              {deals.slice(0, 5).map((deal) => (
                <Link key={deal.id} href={`/partners/deals/${deal.id}`} className="flex items-center justify-between px-6 py-3.5 hover:bg-muted/30 transition-colors">
                  <div>
                    <p className="text-sm font-medium text-foreground">{deal.client?.name || 'Unknown'}</p>
                    <p className="text-xs text-muted-foreground">{deal.service?.name || 'N/A'}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-foreground">${deal.value.toLocaleString()}</span>
                    <Badge status={deal.status} />
                  </div>
                </Link>
              ))}
              {deals.length === 0 && (
                <div className="px-6 py-8 text-center text-sm text-muted-foreground">No deals yet</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
