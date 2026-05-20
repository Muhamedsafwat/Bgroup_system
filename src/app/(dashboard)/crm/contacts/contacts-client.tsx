"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useLocale } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/crm/shared/EmptyState";
import { ChevronLeft, ChevronRight, Search, User, Plus } from "lucide-react";

/// Unified row shape — see getContacts in actions.ts. `source` decides
/// whether scopeHref points at a company page or an opportunity page.
type ContactsData = {
  contacts: Array<{
    id: string;
    source: "directory" | "opportunity";
    fullName: string;
    role: string | null;
    email: string | null;
    phone: string | null;
    isPrimary: boolean;
    scopeId: string;
    scopeLabel: string;
    scopeHref: string;
  }>;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export function ContactsClient({
  data,
  initialSearch,
  currentPage,
}: {
  data: ContactsData;
  initialSearch: string;
  currentPage: number;
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const [search, setSearch] = useState(initialSearch);
  const [isPending, startTransition] = useTransition();

  function handleSearch(value: string) {
    setSearch(value);
    startTransition(() => {
      const params = new URLSearchParams();
      if (value) params.set("search", value);
      params.set("page", "1");
      router.push(`/crm/contacts?${params.toString()}`);
    });
  }

  function handlePageChange(page: number) {
    startTransition(() => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      params.set("page", page.toString());
      router.push(`/crm/contacts?${params.toString()}`);
    });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t.nav.contacts}</h1>
        <Link href="/crm/contacts/new">
          <Button>
            <Plus className="h-4 w-4 me-2" />
            {t.forms.createNew}
          </Button>
        </Link>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={t.common.search}
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          className="ps-10"
        />
      </div>

      {/* Table */}
      {data.contacts.length === 0 ? (
        <EmptyState
          icon={<User className="h-8 w-8 text-muted-foreground" />}
          title={t.common.noResults}
          action={
            <Link href="/crm/contacts/new">
              <Button variant="outline">{t.forms.createNew}</Button>
            </Link>
          }
        />
      ) : (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.forms.contactName}</TableHead>
                  <TableHead>{t.forms.companyName}</TableHead>
                  <TableHead>{t.forms.contactRole}</TableHead>
                  <TableHead>{t.common.email}</TableHead>
                  <TableHead>{t.common.phone}</TableHead>
                  <TableHead>{t.forms.isPrimary}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.contacts.map((contact) => (
                  <TableRow key={contact.id}>
                    <TableCell>
                      {/* Directory rows have a contact-detail page; opp
                          rows don't (they live on the opportunity), so
                          the cell is just plain text for those. */}
                      {contact.source === "directory" ? (
                        <Link
                          href={`/crm/contacts/${contact.id}`}
                          className="font-medium hover:underline"
                        >
                          {contact.fullName}
                        </Link>
                      ) : (
                        <span className="font-medium">{contact.fullName}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={contact.scopeHref}
                        className="text-primary hover:underline"
                      >
                        {contact.scopeLabel}
                      </Link>
                      {contact.source === "opportunity" && (
                        <Badge variant="outline" className="ms-2 text-[10px]">
                          {locale === "ar" ? "فرصة" : "Opportunity"}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {contact.role ?? "—"}
                    </TableCell>
                    <TableCell>
                      {contact.email ? (
                        <a
                          href={`mailto:${contact.email}`}
                          className="text-primary hover:underline text-sm"
                        >
                          {contact.email}
                        </a>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="ltr-nums" dir="ltr">
                      {contact.phone ?? "—"}
                    </TableCell>
                    <TableCell>
                      {contact.isPrimary && (
                        <Badge variant="default">{t.forms.isPrimary}</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {data.totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                <span className="ltr-nums">
                  {(currentPage - 1) * data.pageSize + 1}–
                  {Math.min(currentPage * data.pageSize, data.total)}
                </span>
                {" / "}
                <span className="ltr-nums">{data.total}</span>
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage <= 1 || isPending}
                  onClick={() => handlePageChange(currentPage - 1)}
                >
                  <ChevronRight className="h-4 w-4 rtl:rotate-0 ltr:hidden" />
                  <ChevronLeft className="h-4 w-4 ltr:rotate-0 rtl:hidden" />
                  {t.common.previous}
                </Button>
                <span className="text-sm ltr-nums">
                  {currentPage} / {data.totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage >= data.totalPages || isPending}
                  onClick={() => handlePageChange(currentPage + 1)}
                >
                  {t.common.next}
                  <ChevronLeft className="h-4 w-4 rtl:rotate-0 ltr:hidden" />
                  <ChevronRight className="h-4 w-4 ltr:rotate-0 rtl:hidden" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
