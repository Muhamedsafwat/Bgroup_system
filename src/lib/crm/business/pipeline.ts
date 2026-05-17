import type { FxRateMap } from "./fx";
import { convertToEGP } from "./fx";
import type { CrmCurrency } from "@/generated/prisma";
import type { CrmOpportunityStage } from "@/types";

export function computeWeightedValue(
  estimatedValueEGP: number,
  probabilityPct: number
): number {
  return Math.round((estimatedValueEGP * probabilityPct) / 100 * 100) / 100;
}

export function recomputeOpportunityFinancials(
  estimatedValue: number,
  currency: CrmCurrency,
  probabilityPct: number,
  fxRates: FxRateMap
): {
  estimatedValueEGP: number;
  weightedValueEGP: number;
} {
  const estimatedValueEGP = convertToEGP(estimatedValue, currency, fxRates);
  const weightedValueEGP = computeWeightedValue(estimatedValueEGP, probabilityPct);
  return { estimatedValueEGP, weightedValueEGP };
}

export type PipelineStageSummary = {
  stage: CrmOpportunityStage;
  count: number;
  totalValue: number;
  weightedValue: number;
  percentage: number;
};

export function getPipelineSummary(
  opportunities: Array<{
    stage: CrmOpportunityStage;
    estimatedValueEGP: number;
    weightedValueEGP: number;
  }>
): PipelineStageSummary[] {
  const stageMap = new Map<
    CrmOpportunityStage,
    { count: number; totalValue: number; weightedValue: number }
  >();

  for (const opp of opportunities) {
    const existing = stageMap.get(opp.stage) || {
      count: 0,
      totalValue: 0,
      weightedValue: 0,
    };
    existing.count += 1;
    existing.totalValue += Number(opp.estimatedValueEGP);
    existing.weightedValue += Number(opp.weightedValueEGP);
    stageMap.set(opp.stage, existing);
  }

  const totalWeighted = Array.from(stageMap.values()).reduce(
    (sum, s) => sum + s.weightedValue,
    0
  );

  return Array.from(stageMap.entries()).map(([stage, data]) => ({
    stage,
    count: data.count,
    totalValue: Math.round(data.totalValue),
    weightedValue: Math.round(data.weightedValue),
    percentage: totalWeighted > 0
      ? Math.round((data.weightedValue / totalWeighted) * 100)
      : 0,
  }));
}
