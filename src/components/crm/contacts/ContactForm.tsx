"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { useLocale } from "@/lib/i18n";
import {
  createContactSchema,
  type CreateContactInput,
} from "@/lib/crm/validations/contact";
import { createContactAction, updateContactAction } from "@/app/(dashboard)/crm/contacts/form-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

type ContactFormProps = {
  companyId?: string;
  initialData?: {
    id: string;
    companyId: string;
    fullName: string;
    role: string | null;
    email: string | null;
    phone: string | null;
    whatsapp: string | null;
    isPrimary: boolean;
    linkedIn: string | null;
    notes: string | null;
  };
};

export function ContactForm({ companyId, initialData }: ContactFormProps) {
  const { t } = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const isEdit = !!initialData;

  const resolvedCompanyId = initialData?.companyId ?? companyId ?? "";

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<CreateContactInput>({
    resolver: zodResolver(createContactSchema),
    defaultValues: {
      companyId: resolvedCompanyId,
      fullName: initialData?.fullName ?? "",
      role: initialData?.role ?? "",
      email: initialData?.email ?? "",
      phone: initialData?.phone ?? "",
      whatsapp: initialData?.whatsapp ?? "",
      isPrimary: initialData?.isPrimary ?? false,
      linkedIn: initialData?.linkedIn ?? "",
      notes: initialData?.notes ?? "",
    },
  });

  const isPrimary = watch("isPrimary");

  function onSubmit(data: CreateContactInput) {
    startTransition(async () => {
      try {
        if (isEdit && initialData) {
          const { companyId: _, ...updateData } = data;
          await updateContactAction(initialData.id, updateData);
          toast.success(t.activityLog.updated);
          router.push(`/crm/contacts/${initialData.id}`);
        } else {
          const contact = await createContactAction(data);
          toast.success(t.activityLog.created);
          router.push(`/crm/contacts/${contact.id}`);
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Something went wrong"
        );
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {isEdit
            ? `${t.common.edit} - ${initialData.fullName}`
            : t.forms.createNew}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Hidden company ID */}
          <input type="hidden" {...register("companyId")} />

          {/* Full Name */}
          <div className="space-y-2">
            <Label htmlFor="fullName">
              {t.forms.contactName} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="fullName"
              {...register("fullName")}
              placeholder={t.forms.contactName}
            />
            {errors.fullName && (
              <p className="text-sm text-destructive">{errors.fullName.message}</p>
            )}
          </div>

          {/* CrmRole */}
          <div className="space-y-2">
            <Label htmlFor="role">{t.forms.contactRole}</Label>
            <Input
              id="role"
              {...register("role")}
              placeholder={t.forms.contactRole}
            />
          </div>

          {/* Email & Phone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t.common.email}</Label>
              <Input
                id="email"
                {...register("email")}
                dir="ltr"
                type="email"
                placeholder="email@example.com"
              />
              {errors.email && (
                <p className="text-sm text-destructive">{errors.email.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">{t.common.phone}</Label>
              <Input
                id="phone"
                {...register("phone")}
                dir="ltr"
                type="tel"
                placeholder="+20..."
              />
            </div>
          </div>

          {/* WhatsApp & LinkedIn */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="whatsapp">{t.forms.whatsapp}</Label>
              <Input
                id="whatsapp"
                {...register("whatsapp")}
                dir="ltr"
                type="tel"
                placeholder="+20..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="linkedIn">{t.forms.linkedin}</Label>
              <Input
                id="linkedIn"
                {...register("linkedIn")}
                dir="ltr"
                placeholder="https://linkedin.com/in/..."
              />
            </div>
          </div>

          {/* Is Primary */}
          <div className="flex items-center gap-3">
            <Checkbox
              id="isPrimary"
              checked={isPrimary}
              onCheckedChange={(checked) =>
                setValue("isPrimary", checked === true, { shouldValidate: true })
              }
            />
            <Label htmlFor="isPrimary" className="cursor-pointer">
              {t.forms.isPrimary}
            </Label>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">{t.common.notes}</Label>
            <Textarea
              id="notes"
              {...register("notes")}
              rows={4}
              placeholder={t.common.notes}
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-4 border-t">
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
              {isEdit ? t.common.save : t.common.create}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.back()}
              disabled={isPending}
            >
              {t.common.cancel}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
