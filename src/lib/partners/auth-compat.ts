"use client";

import { useSession, signOut } from "next-auth/react";
import type { PartnerUser, PartnerRole } from "./types";

/**
 * Compatibility layer: maps NextAuth useSession to the Partners Portal's useAuth interface.
 */
export function useAuth() {
  const { data: session, status } = useSession();
  const loading = status === "loading";

  let user: PartnerUser | null = null;
  if (session?.user) {
    // A user is a partners ADMIN only when they have the partners
    // module AND no partnerId (matches isPlatformAdmin / server-side
    // gates). The previous check treated *any* user lacking partnerId
    // as ADMIN — a CRM- or HR-only user was rendered as Partners
    // Admin in client-side UI affordances, even though the proxy
    // blocked them from /partners/* server-side.
    const hasPartnersModule = session.user.modules?.includes("partners") ?? false;
    const isAdmin = hasPartnersModule && !session.user.partnerId;
    user = {
      id: session.user.id,
      email: session.user.email!,
      name: session.user.name!,
      role: (isAdmin ? "ADMIN" : "PARTNER") as PartnerRole,
      partnerId: session.user.partnerId,
    };
  }

  const logout = async () => {
    await signOut({ redirectTo: "/login" });
  };

  return { user, loading, logout };
}
