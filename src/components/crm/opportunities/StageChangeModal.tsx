"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/i18n";
import { stageLabel } from "@/lib/crm/stage-labels";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { changeStage, getLossReasons } from "@/app/(dashboard)/crm/opportunities/actions";
import {
  canTransition,
  getTransitionRequirements,
} from "@/lib/crm/business/stage-transitions";
import { toast } from "sonner";
import type { CrmOpportunityStage } from "@/types";
import type { Locale } from "@/lib/i18n";

export function StageChangeModal({
  open,
  onOpenChange,
  opportunityId,
  currentStage,
  locale,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  opportunityId: string;
  currentStage: string;
  locale: Locale;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const [selectedStage, setSelectedStage] = useState<string>("");
  const [lossReasonId, setLossReasonId] = useState<string>("");
  const [lostToCompetitor, setLostToCompetitor] = useState("");
  const [proposalUrl, setProposalUrl] = useState("");
  const [depositAmount, setDepositAmount] = useState<number>(0);
  const [depositDate, setDepositDate] = useState("");
  const [contractUrl, setContractUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [lossReasons, setLossReasons] = useState<Array<{ id: string; labelEn: string; labelAr: string }>>([]);
  // Pull the admin-curated stage list. The kanban already uses this; the rep
  // stage dropdown used to use the hardcoded ACTIVE_STAGES + TERMINAL_STAGES,
  // which meant a rep could pick a stage that admin had disabled and the opp
  // would vanish from the pipeline (no column matched).
  const [stagesFromConfig, setStagesFromConfig] = useState<Array<{ stage: string; labelEn: string; labelAr: string }>>([]);

  useEffect(() => {
    if (open) {
      getLossReasons().then(setLossReasons);
      fetch("/api/crm/stages")
        .then((r) => (r.ok ? r.json() : { stages: [] }))
        .then((d) => setStagesFromConfig(d.stages ?? []))
        .catch(() => setStagesFromConfig([]));
    }
  }, [open]);

  // Available stages = admin-curated active stages, filtered by the
  // transition matrix from the current stage. Both gates apply.
  const availableStages = stagesFromConfig
    .map((s) => s.stage as CrmOpportunityStage)
    .filter((s) => canTransition(currentStage as CrmOpportunityStage, s).allowed);

  const requirements = selectedStage
    ? getTransitionRequirements(selectedStage as CrmOpportunityStage)
    : null;

  const transition = selectedStage
    ? canTransition(currentStage as CrmOpportunityStage, selectedStage as CrmOpportunityStage)
    : null;

  async function handleSubmit() {
    if (!selectedStage) return;

    if (requirements?.lossReasonRequired && !lossReasonId) {
      toast.error(t.forms.lossReasonRequired);
      return;
    }

    setLoading(true);
    try {
      const result = await changeStage(opportunityId, {
        toStage: selectedStage as CrmOpportunityStage,
        lossReasonId: lossReasonId || undefined,
        lostToCompetitor: lostToCompetitor || undefined,
        proposalUrl: proposalUrl || undefined,
        depositAmount: depositAmount || undefined,
        depositDate: depositDate || undefined,
        contractUrl: contractUrl || undefined,
      });

      if (result.warning) {
        toast.warning(result.warning);
      } else {
        toast.success(locale === "ar" ? "تم تغيير المرحلة" : "Stage changed");
      }
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to change stage");
    }
    setLoading(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t.forms.selectStage}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Stage selector */}
          <div>
            <Label>{locale === "ar" ? "المرحلة الجديدة" : "New Stage"}</Label>
            <Select value={selectedStage} onValueChange={(v) => setSelectedStage(v ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder={t.forms.selectStage} />
              </SelectTrigger>
              <SelectContent>
                {availableStages.map((stage) => {
                  const cfg = stagesFromConfig.find((s) => s.stage === stage);
                  const label = cfg
                    ? (locale === "ar" ? cfg.labelAr : cfg.labelEn)
                    : ((t.stages as Record<string, string>)[stage] ?? stageLabel(stage));
                  return (
                    <SelectItem key={stage} value={stage}>{label}</SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Warning */}
          {transition?.warning && (
            <div className="bg-amber-50 text-amber-800 text-sm p-3 rounded-lg">
              {transition.warning}
            </div>
          )}

          {/* LOST fields */}
          {requirements?.lossReasonRequired && (
            <>
              <div>
                <Label>{t.forms.lossReason} *</Label>
                <Select value={lossReasonId} onValueChange={(v) => setLossReasonId(v ?? "")}>
                  <SelectTrigger>
                    <SelectValue placeholder={t.forms.lossReason} />
                  </SelectTrigger>
                  <SelectContent>
                    {lossReasons.map((lr) => (
                      <SelectItem key={lr.id} value={lr.id}>
                        {locale === "ar" ? lr.labelAr : lr.labelEn}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t.forms.lostToCompetitor}</Label>
                <Input
                  value={lostToCompetitor}
                  onChange={(e) => setLostToCompetitor(e.target.value)}
                />
              </div>
            </>
          )}

          {/* WON fields */}
          {requirements?.depositRequired && (
            <>
              <div className="bg-amber-50 text-amber-800 text-sm p-3 rounded-lg">
                {t.forms.depositWarning}
              </div>
              <div>
                <Label>{t.forms.depositAmount}</Label>
                <Input
                  type="number"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(Number(e.target.value))}
                  className="ltr-nums"
                  dir="ltr"
                />
              </div>
              <div>
                <Label>{t.forms.depositDate}</Label>
                <Input
                  type="date"
                  value={depositDate}
                  onChange={(e) => setDepositDate(e.target.value)}
                  className="ltr-nums"
                  dir="ltr"
                />
              </div>
              <div>
                <Label>{t.forms.contractUrl}</Label>
                <Input
                  value={contractUrl}
                  onChange={(e) => setContractUrl(e.target.value)}
                  dir="ltr"
                />
              </div>
            </>
          )}

          {/* PROPOSAL_SENT fields */}
          {requirements?.proposalUrlRequired && (
            <div>
              <Label>{t.forms.proposalUrl}</Label>
              <Input
                value={proposalUrl}
                onChange={(e) => setProposalUrl(e.target.value)}
                dir="ltr"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t.common.cancel}
          </Button>
          <Button onClick={handleSubmit} disabled={!selectedStage || loading}>
            {loading ? t.common.loading : t.common.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
