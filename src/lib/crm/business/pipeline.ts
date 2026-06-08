import type { FxRateMap } from "./fx";
import { convertToEGP } from "./fx";
import type { CrmCurrency } from "@/generated/prisma";
import type { CrmOpportunityStage } from "@/types";
import { db } from "@/lib/db";

/**
 * Load FX-to-EGP rates from `CrmFxRate`. Falls back to a sane default
 * seed map so currency math never produces NaN on a fresh install
 * with no rate rows yet.
 */
export async function loadFxRates(): Promise<FxRateMap> {
  const rates = await db.crmFxRate.findMany();
  const map: FxRateMap = { EGP: 1, USD: 48, SAR: 12.8, AED: 13, QAR: 13.2 };
  for (const r of rates) {
    map[r.currency] = Number(r.toEGP);
  }
  return map;
}

/// Stage default win-probabilities used ONLY when no CrmStageConfig
/// row exists for the stage. Kept in sync with the seed.
const STAGE_DEFAULT_PROBABILITY: Record<string, number> = {
  NEW: 5,
  CONTACTED: 10,
  DISCOVERY: 20,
  QUALIFIED: 30,
  TECH_MEETING: 40,
  PROPOSAL_SENT: 50,
  NEGOTIATION: 70,
  VERBAL_YES: 85,
  WON: 100,
  LOST: 0,
  POSTPONED: 0,
};

/**
 * Resolve the win-probability for a stage. Prefers a global config
 * (entityId: null), falls back to any per-entity config, then the
 * hard-coded default. Used by changeStage + bulk set-stage so both
 * paths produce the same probabilityPct / weightedValueEGP math.
 */
export async function getStageProbability(stage: string): Promise<number> {
  const config =
    (await db.crmStageConfig.findFirst({ where: { stage, entityId: null } })) ??
    (await db.crmStageConfig.findFirst({ where: { stage } }));
  return config?.probabilityPct ?? STAGE_DEFAULT_PROBABILITY[stage] ?? 0;
}

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
