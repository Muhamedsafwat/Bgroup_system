"use client";

import { useLocale } from "@/lib/i18n";
import { EntityBadge } from "@/components/crm/shared/EntityBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Locale } from "@/lib/i18n";

type LeaderboardEntry = {
  userId: string;
  userName: string;
  entityCode: string;
  entityColor: string;
  openOpps: number;
  weightedPipeline: number;
  wonCount: number;
  wonValue: number;
  target: number;
  attainment: number | null;
};

export function LeaderboardPageClient({
  leaderboard,
  locale,
}: {
  leaderboard: LeaderboardEntry[];
  locale: Locale;
}) {
  const { t } = useLocale();
  const fmt = (n: number) =>
    new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-US").format(n);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t.leaderboard.title}</h1>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>{t.leaderboard.rep}</TableHead>
                <TableHead>{t.forms.entity}</TableHead>
                <TableHead className="text-center">{t.leaderboard.openOpps}</TableHead>
                <TableHead className="text-end">{t.leaderboard.weightedPipeline}</TableHead>
                <TableHead className="text-center">{t.leaderboard.wonCount}</TableHead>
                <TableHead className="text-end">{t.leaderboard.wonValue}</TableHead>
                <TableHead className="text-end">{t.forms.target}</TableHead>
                <TableHead className="text-end">{t.leaderboard.attainment}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leaderboard.map((rep, i) => (
                <TableRow key={rep.userId}>
                  <TableCell className="ltr-nums font-bold text-lg">
                    {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}
                  </TableCell>
                  <TableCell className="font-medium">{rep.userName}</TableCell>
                  <TableCell>
                    <EntityBadge code={rep.entityCode} color={rep.entityColor} />
                  </TableCell>
                  <TableCell className="text-center ltr-nums">{rep.openOpps}</TableCell>
                  <TableCell className="text-end ltr-nums">{fmt(rep.weightedPipeline)}</TableCell>
                  <TableCell className="text-center ltr-nums">{rep.wonCount}</TableCell>
                  <TableCell className="text-end ltr-nums">{fmt(rep.wonValue)}</TableCell>
                  <TableCell className="text-end ltr-nums">{fmt(rep.target)}</TableCell>
                  <TableCell className="text-end">
                    {rep.attainment == null ? (
                      <span className="text-xs text-muted-foreground" title="No monthly target set">
                        —
                      </span>
                    ) : (
                      <div className="flex items-center justify-end gap-2">
                        <Progress value={Math.min(rep.attainment, 100)} className="h-2 w-20" />
                        <span
                          className={`ltr-nums text-sm font-semibold ${
                            rep.attainment >= 100
                              ? "text-green-600"
                              : rep.attainment >= 50
                                ? "text-amber-600"
                                : "text-red-600"
                          }`}
                        >
                          {rep.attainment}%
                        </span>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
